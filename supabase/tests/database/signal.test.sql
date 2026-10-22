-- Miracle Health community: the Community Signal (pgTAP)
-- Who can read it, what moves it, and what can't. Everything rolls back at the end.

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
-- Test helpers (the same as community.test.sql; they live only in this transaction)
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
  values (v, 'authenticated', 'authenticated', '1556' || lpad((abs(hashtext(p_name)) % 10000000)::text, 7, '0'),
          now(), now(), now(), '{}', '{}');
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
  values (v, p_name, p_role, p_status, null, p_trusted, now(), '2026-10-21', now() - p_age, now());
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
-- A post written straight into the table (as the owner), remembered by name
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
create function tests.board(p_compound text) returns public.signal_board
language sql stable as $$ select * from public.signal_board where compound_id = p_compound $$;

select tests.member('alice', 'member', true, interval '60 days');   -- trusted founding member
select tests.member('bob');
select tests.member('carol');
select tests.member('dan', 'member', false, interval '1 day');      -- brand new: counts half
select tests.member('mia', 'moderator', false, interval '90 days');
select tests.member('ben', 'member', false, interval '30 days', 'banned');

-- ===========================================================================
-- 1. Where it starts, and who can read it
-- ===========================================================================
select is((select count(*) from public.signal_snapshots where version = 1), 51::bigint,
  'Every compound with a public-forum baseline starts with a Signal');
select is((select score from public.signal_snapshots where compound_id = 'bpc157' and version = 1), 91.9,
  'The starting number is 65% efficacy, 15% consistency, 10% diversity, 10% confidence of the baseline');

select tests.as_user('bob');
select is((select count(*) from public.signal_board), 51::bigint, 'Members read the whole board');
select throws_ok($$ select * from public.signal_baseline $$, '42501', null, 'Members can''t read the raw baseline');
select throws_ok($$ insert into public.signal_snapshots (compound_id, version, score) values ('bpc157', 99, 100) $$,
  '42501', null, 'Members can''t write a Signal');
select throws_ok($$ insert into public.post_reads (post_id, compound_id, counts) values (gen_random_uuid(), 'bpc157', false) $$,
  '42501', null, 'Members can''t write what Claude read');
select throws_ok($$ select public.record_post_read(gen_random_uuid(), true, 'better', null, null, 'x') $$,
  '42501', null, 'Only the service role records Claude''s read');

select tests.as_user('ben');
select is((select count(*) from public.signal_board), 0::bigint, 'A banned member sees no Signal');
select tests.as_anon();
select throws_ok($$ select * from public.signal_board $$, '42501', null, 'Signed out, the Signal is hidden');

-- ===========================================================================
-- 2. Claude's read of a post moves it
-- ===========================================================================
select tests.as_owner();
select tests.post('bob_report', 'bob', 'bpc157');
select tests.post('carol_question', 'carol', 'bpc157', 'question');
select tests.post('dan_report', 'dan', 'bpc157');

select tests.as_service();
select lives_ok($$ select public.record_post_read(tests.id('bob_report'), true, 'worse', '6 weeks', array['Nausea'], 'claude') $$,
  'The service role records Claude''s read');
select tests.as_user('carol');
select is((select (b.version, b.first_hand) from tests.board('bpc157') b)::text, '(2,1)',
  'A first-hand report writes a new version of the compound''s Signal');
select ok((select b.score < b.prev_score from tests.board('bpc157') b), 'A "worse" report pulls the number down');
select is((select (counts_for_signal, outcome, duration, side_effects) from public.feed where id = tests.id('bob_report'))::text,
  '(t,worse,"6 weeks",{Nausea})', 'The feed shows what Claude read in the post');

select tests.as_service();
select public.record_post_read(tests.id('carol_question'), true, 'better', null, null, 'claude');
select is((select count(*) from public.post_reads where post_id = tests.id('carol_question')), 0::bigint,
  'A question is never counted');
select public.record_post_read(tests.id('dan_report'), true, 'sideways', null,
  array['A', 'B', 'C', 'D'], 'claude');
select is((select (counts, outcome, cardinality(side_effects)) from public.post_reads where post_id = tests.id('dan_report'))::text,
  '(f,,3)', 'An outcome Claude can''t name doesn''t count, and side effects stop at three');

-- ===========================================================================
-- 3. "Same for me"
-- ===========================================================================
select tests.as_user('carol');
select lives_ok($$ insert into public.same_for_me (post_id) values (tests.id('bob_report')) $$,
  'A member adds "same for me" to someone''s first-hand report');
select is((select (same_count, i_same) from public.feed where id = tests.id('bob_report'))::text, '(1,t)',
  'The post counts it, and knows it was hers');
select is((select (b.same_for_me, b.first_hand) from tests.board('bpc157') b)::text, '(1,1)', 'It feeds the Signal');
select throws_ok($$ insert into public.same_for_me (post_id) values (tests.id('bob_report')) $$,
  '23505', null, 'Only once per post');
select tests.as_user('alice');
select is((select count(*) from public.same_for_me), 0::bigint, 'Nobody can see who tapped');
select is((select i_same from public.feed where id = tests.id('bob_report')), false, 'Her own tap state is hers alone');
select tests.as_user('bob');
select throws_like($$ insert into public.same_for_me (post_id) values (tests.id('bob_report')) $$,
  '%your own report%', 'Not on your own report');
select tests.as_user('alice');
select throws_like($$ insert into public.same_for_me (post_id) values (tests.id('carol_question')) $$,
  '%first-hand reports%', 'Not on a post that isn''t a first-hand report');
select throws_ok($$ update public.posts set same_count = 500 where id = tests.id('bob_report') $$,
  '42501', null, 'Nobody sets the count by hand');

-- ===========================================================================
-- 4. New accounts count half
-- ===========================================================================
select tests.as_service();
select public.record_post_read(tests.id('dan_report'), true, 'better', '1 week', null, 'claude');
select tests.as_user('bob');
-- bob's report and carol's tap weigh 1 each, dan's report 0.5: 2.5 of 52.5 is 5%
-- (at full weight it would be 3 of 53, 6%)
select is((select b.internal_share from tests.board('bpc157') b), 5::smallint, 'A brand-new account''s report counts half');
select is((select b.first_hand from tests.board('bpc157') b), 2, 'Both reports are counted');

-- ===========================================================================
-- 5. What takes things back out
-- ===========================================================================
select tests.as_user('carol');
delete from public.same_for_me where post_id = tests.id('bob_report');
select is((select (same_count, i_same) from public.feed where id = tests.id('bob_report'))::text, '(0,f)',
  'Taking back "same for me" undoes the count');

select tests.as_user('mia');
select public.moderate('post', tests.id('bob_report'), 'remove', 'Rule 2: dosing instructions', null, null);
select is((select b.first_hand from tests.board('bpc157') b), 1, 'A removed post stops counting');
select public.moderate('post', tests.id('bob_report'), 'restore', 'Not a rule break', null, null);
select is((select b.first_hand from tests.board('bpc157') b), 2, 'Restored, it counts again');

select tests.as_user('dan');
update public.posts set title = 'Week 2 on BPC-157, an update' where id = tests.id('dan_report');
select is((select count(*) from public.post_reads where post_id = tests.id('dan_report')), 0::bigint,
  'An edited post is read again from scratch');
select tests.as_user('bob');
select is((select b.first_hand from tests.board('bpc157') b), 1, 'Until then it doesn''t count');

-- ===========================================================================
-- 6. A compound with no public baseline
-- ===========================================================================
select tests.as_owner();
select tests.post('a_creatine', 'alice', 'creatine');
select tests.post('b_creatine', 'bob', 'creatine');
select tests.post('c_creatine', 'carol', 'creatine');
select tests.as_service();
select public.record_post_read(tests.id('a_creatine'), true, 'better', null, null, 'claude');
select public.record_post_read(tests.id('b_creatine'), true, 'better', null, null, 'claude');
select tests.as_user('alice');
select is((select count(*) from public.signal_board where compound_id = 'creatine'), 0::bigint,
  'With no baseline, two reports aren''t enough for a number');
select tests.as_service();
select public.record_post_read(tests.id('c_creatine'), true, 'same', null, null, 'claude');
select tests.as_user('alice');
select ok((select b.score is not null and b.internal_share = 100 from tests.board('creatine') b),
  'The third report gives it a Signal made only of this community''s reports');
select tests.as_user('mia');
select public.moderate('post', tests.id('c_creatine'), 'remove', 'Rule 7: not about peptides', null, null);
select tests.as_user('alice');
select is((select b.score from tests.board('creatine') b), null::numeric, 'Below three again, it has no number');

-- ===========================================================================
-- 7. Deleting an account takes its "same for me" with it
-- ===========================================================================
select tests.as_user('carol');
insert into public.same_for_me (post_id) values (tests.id('a_creatine'));
select tests.as_owner();
delete from auth.users where id = tests.id('carol');
select tests.as_user('alice');
select is((select same_count from public.feed where id = tests.id('a_creatine')), 0, 'The count drops when a member leaves');

select * from finish();
rollback;
