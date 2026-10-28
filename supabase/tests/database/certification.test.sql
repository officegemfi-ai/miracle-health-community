-- Miracle Health community: the Signal's levels, measuring tools and public snapshot (pgTAP)
-- Everything rolls back at the end.

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

select tests.member('alice', 'member', true, interval '60 days');
select tests.member('bob');
select tests.member('carol');
select tests.member('dave');
select tests.member('mia', 'moderator', false, interval '90 days');

-- ===========================================================================
-- 1. The levels
-- ===========================================================================
select is(private.certification(0, 0, 0, 90), 'forum', 'A Signal still made of forum data is "Forum data"');
select is(private.certification(100, 3, 3, 10), 'early', 'A stack with a few members'' reports and no forum data is an early signal');
select is(private.certification(30, 12, 5, 50), 'backed', 'A quarter from members and 10 reports: Community-backed');
select is(private.certification(55, 30, 20, 50), 'verified', 'Half from members, 25 reports, 15 voices: Community-verified');
select is(private.certification(80, 60, 40, 70), 'certified', 'Three quarters, 50 reports, 30 voices, confidence 60: Signal Certified');
select is(private.certification(80, 60, 40, 50), 'verified', 'but not without the confidence');
select is(private.certification(80, 60, 10, 90), 'backed', 'or with too few independent voices');
update private.settings set value = '5' where key = 'cert_backed_reports';
select is(private.certification(30, 6, 3, 0), 'backed', 'The thresholds are settings moderators can tune');
update private.settings set value = '10' where key = 'cert_backed_reports';

-- ===========================================================================
-- 2. The measuring tools
-- ===========================================================================
select is(private.wilson(7, 10), array[70, 40, 89], 'A 95% interval comes with the share that went better (7 of 10: 70%, 40 to 89)');
select is(private.wilson(0, 0), null::integer[], 'and none when nobody has reported');

-- Three reports on creatine (no forum baseline), one more held for review
select tests.post('r1', 'bob', 'creatine');
select tests.post('r2', 'carol', 'creatine');
select tests.post('r3', 'dave', 'creatine');
select tests.post('r4', 'alice', 'creatine');
update public.posts set status = 'held' where id = tests.id('r4');
select tests.as_service();
select public.record_post_read(tests.id('r1'), true, 'better', '8 weeks', array['Nausea', 'headache'], 'claude');
select public.record_post_read(tests.id('r2'), true, 'better', null, array['nausea'], 'claude');
select public.record_post_read(tests.id('r3'), true, 'worse', null, array['Bloating'], 'claude');
select public.record_post_read(tests.id('r4'), true, 'worse', null, array['Nausea'], 'claude');
select tests.as_user('bob');
select is((select (reports_better, reports_same, reports_worse)::text from public.signal_board where compound_id = 'creatine'),
  '(2,0,1)', 'The board splits first-hand reports into better, the same and worse (a held post doesn''t count)');
select is((select array[better_pct, better_low, better_high] from public.signal_board where compound_id = 'creatine'),
  private.wilson(2, 3), 'with the interval for "better"');
select is((select side_effects_top->0 from public.signal_board where compound_id = 'creatine'),
  '{"n": 2, "effect": "Nausea"}'::jsonb, 'Side effects are counted however they were written, most mentioned first');
select is((select jsonb_array_length(side_effects_top) from public.signal_board where compound_id = 'creatine'), 3,
  'every one of them, for members');
select is((select certification from public.signal_board where compound_id = 'creatine'), 'early',
  'Three reports and no forum data: an early signal');
select is((select internal_share from public.signal_history where compound_id = 'creatine' order by version desc limit 1), 100::smallint,
  'Each version records how much of it came from members');
select is((select (cert_early, external_weight)::text from public.community_pulse), '(1,50)',
  'The pulse counts each level and says what the forums are worth');

-- ===========================================================================
-- 3. The public snapshot
-- ===========================================================================
select throws_ok($$ select private.public_snapshot() $$, '42501', null, 'Members can''t pull the public snapshot themselves');
select tests.as_anon();
select throws_ok($$ select private.public_snapshot() $$, '42501', null, 'and neither can anyone signed out');
select tests.as_owner();
create temp table snap as select private.public_snapshot() as j;
select is((select j->'signals'->'creatine'->'outcomes'->>'better' from snap), '2', 'The site build gets each Signal''s totals');
select is((select jsonb_array_length(j->'signals'->'creatine'->'side_effects') from snap), 0,
  'but no side effect until three reports mention it');
select is((select (j->'community'->>'reports')::integer from snap), 3, 'and the community''s totals');
select ok((select position(tests.id('r1')::text in j::text) = 0 and position(tests.id('bob')::text in j::text) = 0
                  and position('Sample title' in j::text) = 0 from snap),
  'with no post, author or title anywhere in it');
select tests.as_service();
select public.record_post_read(tests.post('r5', 'alice', 'creatine'), true, 'better', null, array['Nausea'], 'claude');
select tests.as_owner();
select is((select (e->>'n')::integer from jsonb_array_elements(private.public_snapshot()->'signals'->'creatine'->'side_effects') e
           where e->>'effect' = 'Nausea'), 3, 'Once three reports mention one, the library shows it');

select * from finish();
rollback;
