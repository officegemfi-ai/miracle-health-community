-- Miracle Health community: access and abuse tests (pgTAP)
-- Each test signs in as a different person and tries something they should or
-- shouldn't be able to do. Run with `supabase test db`, or locally with
-- scripts/test_local.sh. Everything rolls back at the end.

begin;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'no_plan') then
    create extension if not exists pgtap with schema extensions;
  end if;
end $$;
set local search_path = public, extensions, tests;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Test helpers (live only inside this transaction)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;
create table tests.ids (name text primary key, id uuid not null);
grant all on tests.ids to anon, authenticated, service_role;

create function tests.remember(p_name text, p_id uuid) returns uuid
language sql as $$ insert into tests.ids values (p_name, p_id) on conflict (name) do update set id = excluded.id returning id $$;

create function tests.id(p_name text) returns uuid
language sql stable as $$ select id from tests.ids where name = p_name $$;

create function tests.auth_user(p_name text, p_confirmed boolean default true) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, phone, phone_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values (v, 'authenticated', 'authenticated',
          '1555' || lpad((abs(hashtext(p_name)) % 10000000)::text, 7, '0'),
          case when p_confirmed then now() end, now(), now(), '{}', '{}');
  return tests.remember(p_name, v);
end $$;

create function tests.member(
  p_name text, p_role public.member_role default 'member', p_trusted boolean default false,
  p_age interval default interval '30 days', p_status public.member_status default 'active'
) returns uuid
language plpgsql as $$
declare v uuid := tests.auth_user(p_name);
begin
  insert into public.profiles (id, handle, role, status, suspended_until, trusted,
                               adult_confirmed_at, rules_version, created_at, health_data_consent_at)
  values (v, p_name, p_role, p_status,
          case when p_status = 'suspended' then now() + interval '3 days' end,
          p_trusted, now(), '2026-10-21', now() - p_age, now());
  return v;
end $$;

create function tests.as_user(p_name text) returns void
language plpgsql as $$
declare v uuid := tests.id(p_name);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
end $$;

create function tests.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

create function tests.as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;

create function tests.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Cast of characters
select tests.member('alice', 'member', true, interval '60 days');     -- trusted founding member
select tests.member('bob');                                            -- member, 30 days in
select tests.member('carol');
select tests.member('dave');
select tests.member('dan', 'member', false, interval '1 day');        -- brand new
select tests.member('mia', 'moderator', false, interval '90 days');
select tests.member('ada', 'admin', false, interval '120 days');
select tests.member('ben', 'member', false, interval '30 days', 'banned');
select tests.member('sam', 'member', false, interval '30 days', 'suspended');
select tests.auth_user('nora');                -- signed in, phone confirmed, no profile yet
select tests.auth_user('olga', false);         -- signed in, phone NOT confirmed
select tests.auth_user('pete');                -- will sign up with a one-use code
select tests.auth_user('quinn');               -- tries the same code
select tests.auth_user('ria');                 -- joins without an invite
select tests.auth_user('sol');                 -- joins without an invite (no code at all)
insert into public.invites (code, trusted, max_uses) values ('FOUNDER01', true, 5), ('ONEUSE001', false, 1);
insert into public.invites (code, max_uses, expires_at) values ('EXPIRED01', 5, now() - interval '1 day');

-- ===========================================================================
-- 1. Signing up
-- ===========================================================================
select tests.as_user('olga');
select throws_ok($$ select public.complete_signup('olga_x', 'FOUNDER01', true, '2026-10-21', true) $$,
  'P0001', 'Confirm your phone number first.', 'An unconfirmed phone can''t sign up');

select tests.as_user('nora');
select throws_ok($$ select public.complete_signup('nora_n', 'FOUNDER01', false, '2026-10-21', true) $$,
  'P0001', 'Miracle Health is for adults 18 and over.', 'Sign-up needs the 18+ confirmation');
select throws_ok($$ select public.complete_signup('nora_n', 'FOUNDER01', true, '2026-10-21', false) $$,
  'P0001', 'To join, agree to how what you post about your health is collected and shown.', 'Sign-up needs consent to collect health information');
select throws_ok($$ select public.complete_signup('nora_n', 'NOPE12345', true, '2026-10-21', true) $$,
  'P0001', 'That invite code isn''t valid.', 'A wrong invite code is refused');
select throws_ok($$ select public.complete_signup('nora_n', 'EXPIRED01', true, '2026-10-21', true) $$,
  'P0001', 'That invite code isn''t valid.', 'An expired invite code is refused');
select throws_ok($$ select public.complete_signup('no', 'FOUNDER01', true, '2026-10-21', true) $$,
  'P0001', 'Handles are 3 to 20 letters, numbers or underscores.', 'Handles are checked');
select throws_ok($$ select public.complete_signup('ALICE', 'FOUNDER01', true, '2026-10-21', true) $$,
  'P0001', 'That handle is taken.', 'Handles are unique regardless of case');
select throws_ok($$ select public.complete_signup('nora_n', 'FOUNDER01', true, '2025-01-01', true) $$,
  'P0001', 'The rules changed. Read them again, then sign up.', 'Sign-up needs the current rules version');
select lives_ok($$ select public.complete_signup('nora_n', 'founder01', true, '2026-10-21', true) $$,
  'A confirmed phone with a valid invite signs up');
select is((select handle from public.me()), 'nora_n', 'The new member sees their own profile');
select is((select trusted from public.me()), true, 'A founder invite makes a trusted member');
select throws_ok($$ select public.complete_signup('nora_again', 'FOUNDER01', true, '2026-10-21', true) $$,
  'P0001', 'You''re already signed up.', 'Nobody signs up twice');

select tests.as_user('pete');
select lives_ok($$ select public.complete_signup('pete_p', 'ONEUSE001', true, '2026-10-21', true) $$, 'A one-use code works once');
select tests.as_user('quinn');
select throws_ok($$ select public.complete_signup('quinn_q', 'ONEUSE001', true, '2026-10-21', true) $$,
  'P0001', 'That invite code isn''t valid.', 'A one-use code can''t be used twice');
select is((select new_member from public.me()), null::boolean, 'Without a profile there is no member record');

-- Sign-up is open: no invite needed, and a member without one starts untrusted
select tests.as_user('ria');
select lives_ok($$ select public.complete_signup('ria_r', '', true, '2026-10-21', true) $$,
  'Sign-up is open: an empty invite code is fine');
select is((select trusted from public.me()), false, 'Without an invite, a new member starts untrusted (first-week limits apply)');
select tests.as_user('sol');
select lives_ok($$ select public.complete_signup('sol_s', null, true, '2026-10-21', true) $$,
  'Sign-up is open: no invite code at all is fine');
select tests.as_owner();
select is((select count(*) from public.profiles where handle in ('ria_r', 'sol_s') and invite_code is null), 2::bigint,
  'Members who joined without an invite have no invite recorded');
select is((select uses from public.invites where code = 'ONEUSE001'), 1, 'Joining without an invite uses up nobody''s invite');

-- ===========================================================================
-- 2. People who aren't members see nothing
-- ===========================================================================
select tests.as_owner();
insert into public.posts (author_id, compound_id, kind, title, body)
values (tests.id('carol'), 'bpc157', 'experience', 'Seed post by carol', 'Visible to members only.');

select tests.as_anon();
select throws_ok($$ select count(*) from public.posts $$, '42501', null, 'Signed-out visitors can''t read posts');
select throws_ok($$ select count(*) from public.profiles $$, '42501', null, 'Signed-out visitors can''t read profiles');
select throws_ok($$ select count(*) from public.feed $$, '42501', null, 'Signed-out visitors can''t read the feed');
select throws_ok($$ select public.complete_signup('anon_x', 'FOUNDER01', true, '2026-10-21', true) $$, '42501', null,
  'Signed-out visitors can''t call sign-up');

select tests.as_user('quinn');
select is((select count(*) from public.posts), 0::bigint, 'Signed in without a profile: no posts visible');
select throws_ok($$ insert into public.posts (compound_id, kind, title, body) values ('bpc157', 'question', 'Hello there', 'Hi') $$,
  '42501', 'Finish signing up first.', 'Signed in without a profile: can''t post');

select tests.as_user('ben');
select is((select count(*) from public.posts), 0::bigint, 'A banned member sees nothing');
select is((select count(*) from public.profiles), 0::bigint, 'A banned member sees no profiles');

-- ===========================================================================
-- 3. Posting, and the fields members can never set
-- ===========================================================================
select tests.as_user('bob');
with p as (
  insert into public.posts (compound_id, kind, title, body)
  values ('bpc157', 'experience', 'Week 3 on BPC-157 for my knee', 'Stairs are easier than before I started.')
  returning id
) select tests.remember('bob_post', id) from p;
select is((select author_id from public.posts where id = tests.id('bob_post')), tests.id('bob'), 'A post belongs to whoever wrote it');
select is((select status::text from public.posts where id = tests.id('bob_post')), 'visible', 'A clean post is visible at once');

select throws_ok($$ insert into public.posts (author_id, compound_id, kind, title, body)
                    values (tests.id('alice'), 'bpc157', 'experience', 'Pretending to be alice', 'x') $$,
  '42501', null, 'Nobody can post as someone else');
select throws_ok($$ insert into public.posts (compound_id, kind, title, body, status)
                    values ('bpc157', 'experience', 'Sneaky status', 'x', 'visible') $$,
  '42501', null, 'Members can''t set a post''s status');
select throws_ok($$ insert into public.posts (compound_id, kind, title, body, score)
                    values ('bpc157', 'experience', 'Free points', 'x', 999) $$,
  '42501', null, 'Members can''t set a post''s score');
select throws_ok($$ update public.posts set status = 'visible' where id = tests.id('bob_post') $$,
  '42501', null, 'Members can''t change a post''s status');
select throws_ok($$ update public.posts set score = 500 where id = tests.id('bob_post') $$,
  '42501', null, 'Members can''t change a post''s score');

-- ===========================================================================
-- 4. The checks on every post
-- ===========================================================================
select tests.as_user('bob');
select throws_ok($$ insert into public.posts (compound_id, kind, title, body)
                    values ('semaglutide', 'question', 'Where to buy sema?', 'Anyone know where to buy?') $$,
  'P0001', 'Asking or telling where to buy isn''t allowed here (rule 1). Nothing was posted; edit it and try again.',
  'Asking where to buy is refused with the rule');
select throws_ok($$ insert into public.posts (compound_id, kind, title, body)
                    values ('semaglutide', 'question', 'Discount inside', 'Use code SAVE20 at checkout') $$,
  'P0001', 'Asking or telling where to buy isn''t allowed here (rule 1). Nothing was posted; edit it and try again.',
  'Promo codes are refused');

with p as (
  insert into public.posts (compound_id, kind, title, body)
  values ('tb500', 'experience', 'My TB-500 notes', 'Got mine from peptidesplace.shop and it was fine')
  returning id
) select tests.remember('bob_link_post', id) from p;
select is((select status::text from public.posts where id = tests.id('bob_link_post')), 'held',
  'A link to an unknown site is held for a moderator');
select ok(exists (select 1 from public.feed where id = tests.id('bob_link_post') and status = 'held'),
  'The author still sees their held post, marked as held');

with p as (
  insert into public.posts (compound_id, kind, title, body)
  values ('tb500', 'question', 'Study on TB-500 healing', 'This review: https://pubmed.ncbi.nlm.nih.gov/12345678/')
  returning id
) select tests.remember('bob_study_post', id) from p;
select is((select status::text from public.posts where id = tests.id('bob_study_post')), 'visible',
  'A link to PubMed goes straight up');

with p as (
  insert into public.posts (compound_id, kind, title, body)
  values ('ipamorelin', 'experience', 'Happy to compare notes', 'Hit me up on telegram if you want')
  returning id
) select tests.remember('bob_contact_post', id) from p;
select is((select status::text from public.posts where id = tests.id('bob_contact_post')), 'held',
  'Moving the conversation to Telegram is held');

with p as (
  insert into public.posts (compound_id, kind, title, body)
  values ('ipamorelin', 'experience', 'Ipamorelin sleep', 'Email me at bob.notes@example.com for my log')
  returning id
) select tests.remember('bob_email_post', id) from p;
select is((select status::text from public.posts where id = tests.id('bob_email_post')), 'held',
  'An email address is held');

select is((select count(*) from public.moderation_actions), 0::bigint, 'Members can''t read the moderation log');

select tests.as_owner();
select is((select count(*) from public.moderation_actions where actor = 'rules' and action = 'hold'), 3::bigint,
  'Every automatic hold is logged');

select tests.as_user('dan');
select throws_ok($$ insert into public.posts (compound_id, kind, title, body)
                    values ('tb500', 'experience', 'Check this site', 'Look at peptidesplace.shop') $$,
  'P0001', 'In your first week you can link only to studies and health agencies (rule 6). Nothing was posted; take the link out and try again.',
  'A new member can''t post links to unknown sites');
select lives_ok($$ insert into public.posts (compound_id, kind, title, body)
                   values ('tb500', 'question', 'A study for new members too', 'https://clinicaltrials.gov/study/NCT0000') $$,
  'A new member can link to a study registry');
select lives_ok($$ insert into public.posts (compound_id, kind, title, body)
                   values ('tb500', 'question', 'Second post today', 'Still going.') $$, 'A new member''s second post works');
select lives_ok($$ insert into public.posts (compound_id, kind, title, body)
                   values ('tb500', 'question', 'Third post today', 'Still going.') $$, 'A new member''s third post works');
select throws_ok($$ insert into public.posts (compound_id, kind, title, body)
                    values ('tb500', 'question', 'Fourth post today', 'One too many.') $$,
  'P0001', 'You can start 3 posts a day in your first week. Try again tomorrow.', 'New members are limited to 3 posts a day');

select tests.as_user('alice');
select lives_ok($$ insert into public.posts (compound_id, kind, title, body)
                   values ('retatrutide', 'experience', 'Retatrutide month one', 'Down 9 lb, appetite much lower than before I started.') $$,
  'A trusted founding member posts normally');

-- ===========================================================================
-- 5. Who sees what
-- ===========================================================================
select tests.as_user('carol');
select ok(exists (select 1 from public.posts where id = tests.id('bob_post')), 'Members see each other''s visible posts');
select ok(not exists (select 1 from public.posts where id = tests.id('bob_link_post')), 'Members don''t see someone else''s held post');
select is((select count(*) from public.feed where author_handle = 'bob' and status <> 'visible'), 0::bigint,
  'The feed never shows other people''s held posts');
select throws_ok($$ select trusted from public.profiles limit 1 $$, '42501', null, 'Members can''t read private profile fields');
select throws_ok($$ select status from public.profiles limit 1 $$, '42501', null, 'Members can''t read another member''s status');

select tests.as_user('mia');
select ok(exists (select 1 from public.posts where id = tests.id('bob_link_post')), 'Moderators see held posts');
select ok(exists (select 1 from public.mod_queue where target_id = tests.id('bob_link_post')), 'Held posts are in the moderation queue');

select tests.as_user('carol');
select is((select count(*) from public.mod_queue), 0::bigint, 'Members see nothing in the moderation queue');

select tests.as_user('sam');
select ok(exists (select 1 from public.posts where id = tests.id('bob_post')), 'A suspended member can still read');
select throws_ok($$ insert into public.posts (compound_id, kind, title, body) values ('bpc157', 'question', 'Am I back?', 'test') $$,
  '42501', null, 'A suspended member can''t post');

-- ===========================================================================
-- 6. Editing and deleting
-- ===========================================================================
select tests.as_user('carol');
update public.posts set title = 'Carol rewrote this' where id = tests.id('bob_post');
select is((select title from public.posts where id = tests.id('bob_post')), 'Week 3 on BPC-157 for my knee',
  'Members can''t edit someone else''s post');
delete from public.posts where id = tests.id('bob_post');
select ok(exists (select 1 from public.posts where id = tests.id('bob_post')), 'Members can''t delete someone else''s post');

select tests.as_user('bob');
select lives_ok($$ update public.posts set title = 'Week 3 on BPC-157 for my left knee' where id = tests.id('bob_post') $$,
  'Authors can edit their own post');
select isnt((select edited_at from public.posts where id = tests.id('bob_post')), null, 'An edit is marked as edited');
select throws_ok($$ update public.posts set body = 'Where to buy it cheaper?' where id = tests.id('bob_post') $$,
  'P0001', 'Asking or telling where to buy isn''t allowed here (rule 1). Nothing was posted; edit it and try again.',
  'An edit goes through the same checks');
select is((select status::text from public.posts where id = tests.id('bob_post')), 'visible', 'A refused edit changes nothing');

-- ===========================================================================
-- 7. Comments
-- ===========================================================================
select tests.as_user('carol');
with c as (
  insert into public.comments (post_id, body) values (tests.id('bob_post'), 'Same here, week 2 was the turning point.') returning id
) select tests.remember('carol_comment', id) from c;
select is((select author_id from public.comments where id = tests.id('carol_comment')), tests.id('carol'), 'A comment belongs to whoever wrote it');
select throws_ok($$ insert into public.comments (post_id, body) values (tests.id('bob_link_post'), 'Commenting on a held post') $$,
  '42501', null, 'Nobody can comment on a held post');
select throws_ok($$ insert into public.comments (post_id, author_id, body) values (tests.id('bob_post'), tests.id('bob'), 'As bob') $$,
  '42501', null, 'Nobody can comment as someone else');

select tests.as_user('dave');
update public.comments set body = 'dave was here' where id = tests.id('carol_comment');
select is((select body from public.comments where id = tests.id('carol_comment')), 'Same here, week 2 was the turning point.',
  'Members can''t edit someone else''s comment');
delete from public.comments where id = tests.id('carol_comment');
select ok(exists (select 1 from public.comments where id = tests.id('carol_comment')), 'Members can''t delete someone else''s comment');
select is((select comment_count from public.feed where id = tests.id('bob_post')), 1::bigint, 'The feed counts visible comments');

-- ===========================================================================
-- 8. Votes
-- ===========================================================================
select tests.as_user('carol');
select lives_ok($$ insert into public.post_votes (post_id, value) values (tests.id('bob_post'), 1) $$, 'Members can upvote a post');
select is((select score from public.posts where id = tests.id('bob_post')), 1, 'The post''s score goes up');
select throws_ok($$ insert into public.post_votes (post_id, value) values (tests.id('bob_post'), 1) $$,
  '23505', null, 'Nobody votes twice on the same post');
select lives_ok($$ update public.post_votes set value = -1 where post_id = tests.id('bob_post') $$, 'Members can change their vote');
select is((select score from public.posts where id = tests.id('bob_post')), -1, 'The score follows the change');
select is((select my_vote from public.feed where id = tests.id('bob_post')), -1::smallint, 'The feed shows your own vote');
select throws_ok($$ insert into public.post_votes (post_id, user_id, value) values (tests.id('bob_post'), tests.id('dave'), 1) $$,
  '42501', null, 'Nobody can vote as someone else');

select tests.as_user('bob');
select throws_ok($$ insert into public.post_votes (post_id, value) values (tests.id('bob_post'), 1) $$,
  '42501', null, 'Nobody can vote on their own post');
select is((select count(*) from public.post_votes where post_id = tests.id('bob_post')), 0::bigint,
  'Authors can''t see who voted on their post');

select tests.as_user('dave');
select lives_ok($$ insert into public.comment_votes (comment_id, value) values (tests.id('carol_comment'), 1) $$, 'Members can upvote a comment');
select is((select score from public.comments where id = tests.id('carol_comment')), 1, 'The comment''s score goes up');

-- ===========================================================================
-- 9. Reports, and the reporter stays anonymous
-- ===========================================================================
select tests.as_user('carol');
select lives_ok($$ insert into public.reports (target_kind, target_id, reason, note) values ('post', tests.id('bob_post'), 'dosing', 'Tells people what to take') $$,
  'Members can report a post');
select is((select reporter_id from public.reports where target_id = tests.id('bob_post')), tests.id('carol'), 'A report is filed under the real reporter');
select throws_ok($$ insert into public.reports (target_kind, target_id, reason) values ('post', tests.id('bob_post'), 'spam') $$,
  '23505', null, 'One report per person per post');
select throws_ok($$ insert into public.reports (reporter_id, target_kind, target_id, reason) values (tests.id('dave'), 'post', tests.id('bob_post'), 'spam') $$,
  '42501', null, 'Nobody can file a report as someone else');
select throws_ok($$ insert into public.reports (target_kind, target_id, reason) values ('post', tests.id('bob_link_post'), 'spam') $$,
  'P0001', 'There''s nothing to report there.', 'You can only report what you can see');

select tests.as_user('bob');
select is((select count(*) from public.reports), 0::bigint, 'The author can''t see who reported them');

select tests.as_user('dave');
select lives_ok($$ insert into public.reports (target_kind, target_id, reason) values ('post', tests.id('bob_post'), 'dosing') $$, 'A second report');
select tests.as_user('alice');
select lives_ok($$ insert into public.reports (target_kind, target_id, reason) values ('post', tests.id('bob_post'), 'dosing') $$, 'A third report');
select tests.as_owner();
select is((select status::text from public.posts where id = tests.id('bob_post')), 'held', 'Three reports hold a post for review');

-- ===========================================================================
-- 10. Moderation
-- ===========================================================================
select tests.as_user('carol');
select throws_ok($$ select public.moderate('post', tests.id('bob_post'), 'remove', 'test') $$,
  '42501', 'Only moderators can do that.', 'Members can''t moderate');
select throws_ok($$ select private.moderate('post', tests.id('bob_post'), 'remove', 'test', null, null) $$,
  '42501', 'Only moderators can do that.', 'Calling the private function directly doesn''t help');
select throws_ok($$ insert into public.moderation_actions (action, target_kind, target_id, reason) values ('remove', 'post', tests.id('bob_post'), 'x') $$,
  '42501', null, 'Members can''t write to the moderation log');
select throws_ok($$ insert into public.watch_terms (term) values ('harmless') $$,
  '42501', null, 'Members can''t edit the watch list');
select is((select count(*) from public.watch_terms), 0::bigint, 'Members can''t read the watch list');
select is((select count(*) from public.invites), 0::bigint, 'Members can''t read invite codes');
select is((select count(*) from public.signal_alerts), 0::bigint, 'Members can''t read Signal alerts');
select is((select count(*) from public.ai_reviews), 0::bigint, 'Members can''t read AI reviews');
select throws_ok($$ select * from public.beta_metrics() $$, '42501', 'Only moderators can see the beta numbers.', 'Members can''t see beta numbers');

select tests.as_user('mia');
select lives_ok($$ select public.moderate('post', tests.id('bob_post'), 'remove', 'Rule 2: dosing instructions', 'Told members to take 500mcg') $$,
  'A moderator removes a post');
select is((select status::text from public.posts where id = tests.id('bob_post')), 'removed', 'The post is removed');
select is((select count(*) from public.reports where target_id = tests.id('bob_post') and status = 'actioned'), 3::bigint,
  'Its reports are closed as actioned');
select is((select count(*) from public.moderation_actions where target_id = tests.id('bob_post') and moderator_id = tests.id('mia')), 1::bigint,
  'The action is logged under the moderator');
select throws_ok($$ select public.moderate('post', tests.id('bob_post'), 'remove', '') $$,
  'P0001', 'Give a reason; it goes in the log.', 'Every action needs a reason');
select lives_ok($$ select public.moderate('post', tests.id('bob_link_post'), 'restore', 'Link is a known pharmacy guide') $$,
  'A moderator restores a held post');
select is((select status::text from public.posts where id = tests.id('bob_link_post')), 'visible', 'The restored post is visible');
select ok((select count(*) from public.beta_metrics()) >= 10, 'Moderators can see the beta numbers');
select lives_ok($$ insert into public.watch_terms (term, action, reason) values ('sketchy-labs', 'hold', 'sourcing') $$,
  'Moderators can add to the watch list');
select lives_ok($$ insert into public.invites (note, max_uses) values ('For a forum moderator', 1) $$,
  'Moderators can create invite codes');

select tests.as_user('carol');
select ok(not exists (select 1 from public.posts where id = tests.id('bob_post')), 'Members no longer see the removed post');
select tests.as_user('bob');
select is((select status::text from public.feed where id = tests.id('bob_post')), 'removed', 'The author sees their post was removed');
select is((select status_reason from public.feed where id = tests.id('bob_post')), 'Rule 2: dosing instructions', 'and why');
select throws_ok($$ update public.posts set title = 'Trying to bring it back' where id = tests.id('bob_post') $$,
  'P0001', 'Removed posts can''t be edited.', 'A removed post can''t be edited back');

select tests.as_user('mia');
select lives_ok($$ select public.moderate('member', tests.id('dave'), 'suspend', 'Rule 4: harassment', null, 3) $$, 'A moderator suspends a member');
select tests.as_user('dave');
select throws_ok($$ insert into public.comments (post_id, body) values (tests.id('bob_link_post'), 'Can I still post?') $$,
  '42501', null, 'A suspended member can''t comment');
select tests.as_user('mia');
select throws_ok($$ select public.moderate('member', tests.id('ada'), 'ban', 'Testing') $$,
  '42501', 'Only an admin can act on a moderator.', 'A moderator can''t ban an admin');
select throws_ok($$ select public.moderate('member', tests.id('mia'), 'ban', 'Testing') $$,
  'P0001', 'You can''t act on your own account.', 'Nobody can act on their own account');
select lives_ok($$ select public.moderate('member', tests.id('carol'), 'ban', 'Rule 1: selling') $$, 'A moderator bans a member');
select tests.as_owner();
select is((select count(*) from public.comments where author_id = tests.id('carol') and status <> 'removed'), 0::bigint,
  'A ban removes the member''s content');

-- ===========================================================================
-- 11. Nobody can promote themselves
-- ===========================================================================
select tests.as_user('bob');
select throws_ok($$ update public.profiles set role = 'admin' where id = tests.id('bob') $$, '42501', null, 'Members can''t make themselves admins');
select throws_ok($$ update public.profiles set trusted = true where id = tests.id('bob') $$, '42501', null, 'Members can''t mark themselves trusted');
select throws_ok($$ insert into public.profiles (id, handle, adult_confirmed_at, rules_version, health_data_consent_at) values (gen_random_uuid(), 'ghost', now(), 'x', now()) $$,
  '42501', null, 'Members can''t create extra profiles');
select throws_ok($$ select public.record_ai_review('post', tests.id('bob_study_post'), 'm', 'hold', array['spam'], 'x') $$,
  '42501', null, 'Members can''t pose as the AI reviewer');
select throws_ok($$ select private.setting('rules_version') $$, '42501', null, 'Members can''t call internal settings');

-- ===========================================================================
-- 12. AI review results
-- ===========================================================================
select tests.as_service();
select lives_ok($$ select public.record_ai_review('post', tests.id('bob_study_post'), 'claude-haiku', 'hold', array['dosing'], 'Gives a dose to others') $$,
  'The AI reviewer can hold a post');
select tests.as_owner();
select is((select status::text from public.posts where id = tests.id('bob_study_post')), 'held', 'The AI hold takes effect');
select is((select count(*) from public.moderation_actions where target_id = tests.id('bob_study_post') and actor = 'ai'), 1::bigint,
  'The AI hold is logged');

-- ===========================================================================
-- 13. New accounts piling onto one compound
-- ===========================================================================
select tests.as_owner();
insert into public.posts (author_id, compound_id, kind, title, body)
values (tests.id('alice'), 'motsc', 'experience', 'MOTS-c baseline post', 'Energy about the same as before I started.')
returning tests.remember('mots_post', id);
select tests.member('bot' || g, 'member', false, interval '2 days') from generate_series(1, 9) g;
do $$
declare i integer;
begin
  for i in 1..9 loop
    perform tests.as_user('bot' || i);
    insert into public.post_votes (post_id, value) values (tests.id('mots_post'), 1);
    perform tests.as_owner();
  end loop;
end $$;
select tests.as_owner();
select is((select count(*) from public.signal_alerts where compound_id = 'motsc' and status = 'open'), 1::bigint,
  'Nine new accounts piling onto one compound raise one alert');
select is((select count(*) from public.signal_alerts where compound_id = 'retatrutide'), 0::bigint,
  'Normal activity raises no alert');

-- ===========================================================================
-- 14. Deleting an account deletes the member's content
-- ===========================================================================
select tests.as_owner();
delete from auth.users where id = tests.id('alice');
select is((select count(*) from public.profiles where id = tests.id('alice')), 0::bigint, 'The profile is gone');
select is((select count(*) from public.posts where author_id = tests.id('alice')), 0::bigint, 'Their posts are gone');
select is((select count(*) from public.post_votes where user_id = tests.id('alice')), 0::bigint, 'Their votes are gone');
select is((select count(*) from public.reports where reporter_id = tests.id('alice')), 0::bigint, 'Their reports no longer point to them');
select is((select count(*) from public.reports where target_id = tests.id('bob_post')), 3::bigint, 'but the reports themselves stay for the record');

select * from finish();
rollback;
