-- Miracle Health community: the game layer (pgTAP)
-- Spaces, threads, stickers, Signal points and emblems, badges, quests,
-- notifications and the live Signal. One story, start to finish; it all rolls back.

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
-- Test helpers (the same as the other files; they live only in this transaction)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;
create table tests.ids (name text primary key, id uuid not null);
grant all on tests.ids to anon, authenticated, service_role;

create function tests.remember(p_name text, p_id uuid) returns uuid
language sql as $$ insert into tests.ids values (p_name, p_id) on conflict (name) do update set id = excluded.id returning id $$;
create function tests.id(p_name text) returns uuid
language sql stable as $$ select id from tests.ids where name = p_name $$;
create function tests.auth_user(p_name text) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, phone, phone_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'authenticated', 'authenticated', '1557' || lpad((abs(hashtext(p_name)) % 10000000)::text, 7, '0'),
          now(), now(), now(), '{}', '{}');
  return tests.remember(p_name, v);
end $$;
create function tests.member(
  p_name text, p_role public.member_role default 'member', p_trusted boolean default false,
  p_age interval default interval '30 days'
) returns uuid
language plpgsql as $$
declare v uuid := tests.auth_user(p_name);
begin
  insert into public.profiles (id, handle, role, status, trusted, adult_confirmed_at, rules_version,
                               created_at, health_data_consent_at)
  values (v, p_name, p_role, 'active', p_trusted, now(), '2026-10-21', now() - p_age, now());
  return v;
end $$;
create function tests.as_user(p_name text) returns void
language plpgsql as $$
declare v uuid := tests.id(p_name);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
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
create function tests.post(p_name text, p_author text, p_compound text, p_kind public.post_kind default 'experience')
returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.posts (author_id, compound_id, kind, title, body)
  values (tests.id(p_author), p_compound, p_kind, 'Sample title for ' || p_name, 'Sample body')
  returning id into v;
  return tests.remember(p_name, v);
end $$;
-- Read as the database owner, so the numbers don't depend on who is signed in
create function tests.total(p_name text) returns integer
language sql stable security definer set search_path = '' as $$
  select s.total from public.member_scores s where s.user_id = (select t.id from tests.ids t where t.name = p_name) $$;
create function tests.level(p_name text) returns smallint
language sql stable security definer set search_path = '' as $$
  select s.level from public.member_scores s where s.user_id = (select t.id from tests.ids t where t.name = p_name) $$;
create function tests.notes(p_name text, p_kind text) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.notifications n
  where n.user_id = (select t.id from tests.ids t where t.name = p_name) and n.kind = p_kind $$;
create function tests.latest_cause(p_compound text) returns text
language sql stable security definer set search_path = '' as $$
  select s.cause from public.signal_snapshots s where s.compound_id = p_compound order by s.version desc limit 1 $$;
create function tests.has_badge(p_name text, p_badge text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.member_badges b
                 where b.user_id = (select t.id from tests.ids t where t.name = p_name) and b.badge = p_badge) $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

select tests.member('alice', 'member', true, interval '60 days');   -- founding member
select tests.member('bob');
select tests.member('carol');
select tests.member('dan', 'member', false, interval '1 day');      -- brand new
select tests.member('mia', 'moderator', false, interval '90 days');

-- ===========================================================================
-- 1. Joining: the emblems, a welcome, and the founding badge
-- ===========================================================================
select tests.as_user('bob');
select is((select count(*) from public.levels), 15::bigint, 'Fifteen emblems');
select is((select name || ':' || min_points from public.levels where n = 1), 'Spark:0', 'The first is Spark, from 0 points');
select is((select name || ':' || min_points from public.levels where n = 15), 'Organism:7300', 'The last is Organism, at 7,300');
select is(tests.notes('bob', 'welcome'), 1::bigint, 'Every new member gets a welcome');
select is((select (points, level, level_name) from public.member_cards where handle = 'bob')::text, '(0,1,Spark)',
  'A new member starts at 0 points, Spark');
select ok(tests.has_badge('alice', 'founding') and not tests.has_badge('bob', 'founding'),
  'A founding invite earns the Founding member badge');
select tests.as_anon();
select throws_ok($$ select * from public.levels $$, '42501', null, 'Signed out, nothing of the game is visible');

-- ===========================================================================
-- 2. Spaces
-- ===========================================================================
select tests.as_user('bob');
insert into public.space_members (compound_id) values ('bpc157'), ('tirzepatide');
select tests.as_user('carol');
insert into public.space_members (compound_id) values ('bpc157');
select is((select members_count from public.compounds where id = 'bpc157'), 2, 'Joining a space adds to its member count');
select is((select count(*) from public.space_members), 1::bigint, 'Who joined which space stays private');
select tests.as_user('bob');
select is((select joined::text || '/' || members_count from public.spaces where compound_id = 'bpc157'), 'true/2',
  'The spaces list shows the count and whether you joined');
select is((select joined from public.spaces where compound_id = 'semaglutide'), false, 'and not the ones you didn''t');
select throws_ok($$ insert into public.space_members (compound_id, user_id) values ('semaglutide', tests.id('carol')) $$,
  '42501', null, 'Nobody joins a space for someone else');
select is((select have || ' of ' || need from public.my_quests where key = 'spaces'), '2 of 3', 'The spaces quest counts along');
select throws_like($$ select public.claim_quest('spaces') $$, '%Not done yet: 2 of 3%', 'An unfinished quest can''t be claimed');
insert into public.space_members (compound_id) values ('semaglutide');
select is(public.claim_quest('spaces'), 20, 'A finished quest pays its points');
select is(tests.total('bob'), 25, 'plus the first-contribution-of-the-day bonus (20 + 5)');
select throws_ok($$ select public.claim_quest('spaces') $$, '23505', null, 'A quest pays once');
delete from public.space_members where compound_id = 'semaglutide';
select is((select members_count from public.compounds where id = 'semaglutide'), 0, 'Leaving takes the count back down');

-- ===========================================================================
-- 3. A first-hand report: points for follow-through, and what it did to the Signal
-- ===========================================================================
select tests.as_owner();
select tests.post('bob_report', 'bob', 'bpc157');
select tests.post('carol_q', 'carol', 'bpc157', 'question');
select is(tests.total('bob'), 30, 'Starting a post earns 5');
select is(tests.total('carol'), 10, 'A first post of the day earns 5, plus 5 for the day');

select tests.as_service();
select public.record_post_read(tests.id('bob_report'), true, 'better', '6 weeks', array['Nausea'], 'claude');
select is(tests.total('bob'), 70, 'A first-hand report Miracle AI counts earns 40');
select is(tests.level('bob'), 2::smallint, 'which takes him past 60 points to Pulse');
select is(tests.notes('bob', 'level_up'), 1::bigint, 'and tells him');
select ok(tests.has_badge('bob', 'first_report'), 'His first counted report earns the First report badge');
select tests.as_user('bob');
select is((select (data ->> 'from') || ' -> ' || (data ->> 'to') from public.my_notifications where kind = 'counted'),
  '91.9 -> 92.1', 'He is told exactly how his report moved the BPC-157 Signal');
select is(tests.latest_cause('bpc157'), 'report', 'The Signal records what moved it');
select is((select count(*) from public.my_points), 4::bigint, 'He sees each line of his points');
select is((select (points, level_name, reports, next_level_at) from public.member_cards where handle = 'bob')::text,
  '(70,Pulse,1,150)', 'His card shows points, emblem, reports and the next emblem');
select tests.as_user('carol');
select is((select count(*) from public.points), 2::bigint, 'Members see only their own points lines');
select throws_ok($$ select from_user from public.points $$, '42501', null, 'and never who gave them points');

-- ===========================================================================
-- 4. "Same for me" and votes
-- ===========================================================================
select tests.as_user('carol');
insert into public.same_for_me (post_id) values (tests.id('bob_report'));
select is(tests.total('carol'), 15, '"Same for me" earns the member who taps 5');
select is(tests.total('bob'), 75, 'and the author 5');
select tests.as_user('dan');
insert into public.same_for_me (post_id) values (tests.id('bob_report'));
select is(tests.total('dan'), 10, 'A new member earns for tapping');
select is(tests.total('bob'), 75, 'but a brand-new account''s tap gives the author nothing');
select tests.as_user('bob');
select is((select (data ->> 'count') || '/' || count(*) over () from public.my_notifications where kind = 'same_for_me'),
  '2/1', 'One running note: two people, never who');

select tests.as_user('carol');
insert into public.post_votes (post_id, value) values (tests.id('bob_report'), 1);
select is(tests.total('bob'), 76, 'A helpful vote from an established member earns 1');
select tests.as_user('dan');
insert into public.post_votes (post_id, value) values (tests.id('bob_report'), 1);
select is(tests.total('bob'), 76, 'A new account''s vote earns nothing');
select tests.as_user('carol');
update public.post_votes set value = -1 where post_id = tests.id('bob_report');
select is(tests.total('bob'), 75, 'Turning it down takes the point back');
delete from public.post_votes where post_id = tests.id('bob_report');
insert into public.post_votes (post_id, value) values (tests.id('bob_report'), 1);
select is(tests.total('bob'), 76, 'and voting again gives it back once');

-- ===========================================================================
-- 5. A removed post takes its points down; restored, they come back
-- ===========================================================================
select tests.as_user('mia');
select public.moderate('post', tests.id('bob_report'), 'remove', 'Rule 2: dosing instructions', null, null);
select is(tests.total('bob'), 25, 'Everything the post earned goes down with it');
select is(tests.level('bob'), 1::smallint, 'and the emblem follows the points');
select is(tests.total('carol'), 10, 'including the taps on it');
select is(tests.latest_cause('bpc157'), 'removed', 'The Signal records the removal');
select tests.as_user('bob');
select is((select count(*) from public.my_notifications where kind = 'mod'
           and data ->> 'action' = 'remove' and data ->> 'reason' = 'Rule 2: dosing instructions'), 1::bigint,
  'The author is told it was removed, and why');
select tests.as_user('mia');
select public.moderate('post', tests.id('bob_report'), 'restore', 'Not a rule break', null, null);
select is(tests.total('bob'), 76, 'Restored, the points come back');
select is(tests.notes('bob', 'level_up'), 1::bigint, 'without a second level-up note');
select is(tests.latest_cause('bpc157'), 'restored', 'and the Signal records that too');

-- ===========================================================================
-- 6. Reply threads
-- ===========================================================================
select tests.as_user('carol');
with x as (insert into public.comments (post_id, body) values (tests.id('bob_report'), 'How did your knee feel at week 2?') returning id)
select tests.remember('c_carol', (select id from x));
select is(tests.notes('bob', 'comment'), 1::bigint, 'The author hears about a new comment');
select tests.as_user('bob');
with x as (insert into public.comments (post_id, parent_id, body) values (tests.id('bob_report'), tests.id('c_carol'), 'Stiff, then better by week 3.') returning id)
select tests.remember('c_bob', (select id from x));
select is((select depth from public.thread_comments where id = tests.id('c_bob')), 1::smallint, 'A reply sits one level down');
select is(tests.notes('carol', 'reply'), 1::bigint, 'and the person replied to is told');
select tests.as_user('dan');
with x as (insert into public.comments (post_id, parent_id, body) values (tests.id('bob_report'), tests.id('c_bob'), 'Same timeline here.') returning id)
select tests.remember('c_dan', (select id from x));
select is(tests.notes('bob', 'reply') || '/' || tests.notes('bob', 'comment'), '1/1', 'The author gets one note for a reply to him, not two');
select tests.as_owner();
select tests.post('alice_report', 'alice', 'tirzepatide');
select tests.as_user('dan');
select throws_like($$ insert into public.comments (post_id, parent_id, body) values (tests.id('alice_report'), tests.id('c_carol'), 'x') $$,
  '%doesn''t belong to this post%', 'A reply stays in its own post');
select tests.as_owner();
update private.settings set value = '2' where key = 'max_thread_depth';
select tests.as_user('carol');
select throws_like($$ insert into public.comments (post_id, parent_id, body) values (tests.id('bob_report'), tests.id('c_dan'), 'deeper') $$,
  '%as deep as it goes%', 'Threads stop at the set depth');
select tests.as_owner();
update private.settings set value = '8' where key = 'max_thread_depth';
select tests.as_user('carol');
delete from public.comments where id = tests.id('c_carol');
select is((select parent_id::text from public.thread_comments where id = tests.id('c_bob')), null::text,
  'Deleting a comment keeps the replies to it, at the top of the thread');
select is((select parent_id from public.thread_comments where id = tests.id('c_dan')), tests.id('c_bob'), 'with their own replies under them');

-- ===========================================================================
-- 7. Sig stickers
-- ===========================================================================
select tests.as_user('carol');
select is(tests.total('bob'), 79, 'Bob''s reply earned 3');
insert into public.post_reactions (post_id, sticker) values (tests.id('bob_report'), 'cheer');
select is((select reactions ->> 'cheer' from public.feed where id = tests.id('bob_report')), '1', 'A sticker shows on the post');
select is((select my_reactions from public.feed where id = tests.id('bob_report')), array['cheer'], 'and knows it was hers');
select is(tests.total('bob'), 80, 'and earns the author 1');
select throws_ok($$ insert into public.post_reactions (post_id, sticker) values (tests.id('bob_report'), 'cheer') $$,
  '23505', null, 'One of each sticker per post');
select tests.as_user('alice');
select is((select count(*) from public.post_reactions), 0::bigint, 'Nobody sees who put which sticker');
select tests.as_user('bob');
select throws_like($$ insert into public.post_reactions (post_id, sticker) values (tests.id('bob_report'), 'support') $$,
  '%other people''s posts%', 'No stickers on your own post');
select tests.as_user('carol');
delete from public.post_reactions where post_id = tests.id('bob_report');
select is((select (reactions ->> 'cheer') || '/' || tests.total('bob') from public.feed where id = tests.id('bob_report')), '0/79',
  'Taking it back takes the count and the point back');

-- ===========================================================================
-- 8. Weekly quests, and the Signal Builder badge
-- ===========================================================================
select tests.as_user('carol');
select is((select have from public.my_quests where key = 'same'), 1, 'Weekly quests count this week''s taps');
select is((select count(*) from public.my_quests), 6::bigint, 'Six quests to work on');
select tests.as_user('bob');
select is(public.claim_quest('report'), 50, 'Sharing a report this week pays 50');
select is(tests.total('bob'), 129, 'on top of what he had');
select ok(tests.has_badge('bob', 'builder'), 'Top ten with 100+ points this month: the Signal Builder badge');
select throws_ok($$ select public.claim_quest('report') $$, '23505', null, 'once a week');

-- ===========================================================================
-- 9. Authors check Miracle AI's read
-- ===========================================================================
select tests.as_user('carol');
select throws_ok($$ select public.confirm_read(tests.id('bob_report'), 'worse') $$, '42501', null,
  'Only the author can say how a report went');
select throws_like($$ select public.confirm_read(tests.id('carol_q'), 'better') $$, '%Only your reports%',
  'Questions aren''t reports');
select tests.as_user('bob');
select public.confirm_read(tests.id('bob_report'), 'same');
select is((select (outcome, corrected, confirmed_at is not null) from public.post_reads where post_id = tests.id('bob_report'))::text,
  '(same,t,t)', 'The author''s correction replaces Miracle AI''s read');
select is(tests.total('bob'), 139, 'and earns 10');
select is((select outcome from public.feed where id = tests.id('bob_report')), 'same', 'The feed shows the corrected read');
select tests.as_service();
select public.record_post_read(tests.id('bob_report'), true, 'better', '6 weeks', null, 'claude');
select is((select outcome from public.post_reads where post_id = tests.id('bob_report')), 'same',
  'A later read never overwrites what the author confirmed');

-- ===========================================================================
-- 10. Notes from the moderators, and notifications stay private
-- ===========================================================================
select tests.as_user('mia');
select public.moderate('member', tests.id('dan'), 'warn', 'Rule 4: harassment', 'Please keep it kind', null);
select tests.as_user('dan');
select is((select data ->> 'note' from public.my_notifications where kind = 'mod'), 'Please keep it kind',
  'A warned member gets the moderator''s note');
select tests.as_user('bob');
select is((select count(*) from public.notifications where user_id = tests.id('dan')), 0::bigint, 'Nobody reads someone else''s notifications');
select tests.as_user('dan');
select ok((select count(*) from public.my_notifications where read_at is null) > 0, 'Dan has unread notes');
select public.mark_notifications_read();
select is((select count(*) from public.my_notifications where read_at is null), 0::bigint, 'Marking them read clears them');
select throws_ok($$ update public.notifications set kind = 'badge' $$, '42501', null, 'Members can only mark notes read');
select throws_ok($$ insert into public.notifications (user_id, kind) values (tests.id('dan'), 'badge') $$, '42501', null,
  'Members can''t write notifications');
select throws_ok($$ insert into public.points (user_id, reason, amount) values (tests.id('dan'), 'quest', 9999) $$, '42501', null,
  'Members can''t give themselves points');
select throws_ok($$ update public.member_scores set total = 9999 $$, '42501', null, 'or change their totals');
select throws_ok($$ insert into public.member_badges (user_id, badge) values (tests.id('dan'), 'builder') $$, '42501', null,
  'or award themselves badges');

-- ===========================================================================
-- 11. Something bigger: the pulse, shared goals, Signal Builders, the moves
-- ===========================================================================
select tests.as_user('bob');
select is((select (reports, season_goal) from public.community_pulse)::text, '(1,1000)',
  'The pulse counts first-hand reports toward the season goal');
select is((select members from public.community_pulse), (select count(*) from public.profiles), 'and every member');
select ok((select season_name like 'Season 1%' from public.community_pulse), 'during Season 1');
select is((select kind || ':' || need from public.community_goals where compound_id = 'bpc157'), 'takeover:50',
  'A compound with forum data has a goal: this community passes half its Signal');
select is((select kind || ':' || need from public.community_goals where compound_id = 'creatine'), 'unlock:3',
  'One without has a goal to unlock its first Signal');
select is((select handle from public.signal_builders where rank = 1), 'bob', 'Signal Builders ranks this month''s points');
select ok((select is_me from public.signal_builders where handle = 'bob'), 'and marks you');
select is((select badges from public.member_cards where handle = 'alice'), array['founding'], 'Badges show on profiles');
select ok((select count(*) from public.signal_moves where compound_id = 'bpc157') >= 3,
  'Every move of the Signal is listed, with its cause');

-- ===========================================================================
-- 12. Deleting an account takes back what it gave
-- ===========================================================================
select tests.as_owner();
create temp table before_delete as select tests.total('bob') as t;
delete from auth.users where id = tests.id('carol');
select is((select t from before_delete) - tests.total('bob'), 6, 'Bob loses the 5 and 1 that Carol''s tap and vote gave him');
select is((select members_count from public.compounds where id = 'bpc157'), 1, 'and her space membership is gone');

select * from finish();
rollback;
