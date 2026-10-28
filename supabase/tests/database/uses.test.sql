-- Miracle Health community: ratings by use (pgTAP)
-- What members took something for, read from each report; each Signal's rating per use;
-- the forums' mentions next to it; the public snapshot. Everything rolls back at the end.

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
select tests.member('erin');
select tests.member('newbie', 'member', false, interval '1 day');
select tests.member('mia', 'moderator', false, interval '90 days');

-- ===========================================================================
-- 1. The list of uses
-- ===========================================================================
select tests.as_user('bob');
select is((select count(*)::integer from public.signal_uses), 30, 'Members see the thirty uses');
select is((select label from public.signal_uses where id = 'joints'), 'Joint pain', 'each with a plain name');
select is((select goal from public.signal_uses where id = 'injury'), 'recovery', 'and the goal it belongs to');
select tests.as_anon();
select throws_ok($$ select * from public.signal_uses $$, '42501', null, 'Nobody signed out reads them');

-- ===========================================================================
-- 2. What a report was for, as Miracle AI reads it
-- ===========================================================================
select tests.as_owner();
select tests.post('r1', 'bob', 'bpc157');
select tests.post('r2', 'carol', 'bpc157');
select tests.post('r3', 'dave', 'bpc157');
select tests.post('q1', 'erin', 'bpc157', 'question');
select tests.as_service();
select public.record_post_read(tests.id('r1'), true, 'better', '6 weeks', array['Nausea'], 'claude',
  '[{"use": "joints", "outcome": "better"}, {"use": "gut", "outcome": "same"}, {"use": "joints", "outcome": "worse"},
    {"use": "made_up", "outcome": "better"}, {"use": "sleep"}, {"use": "skin", "outcome": "better"}, "junk"]'::jsonb);
select tests.as_owner();
select is((select uses from public.post_reads where post_id = tests.id('r1')),
  '[{"use": "joints", "outcome": "better"}, {"use": "gut", "outcome": "same"}, {"use": "sleep", "outcome": "better"}]'::jsonb,
  'The read keeps known uses, once each, at most three; a use without its own outcome takes the report''s');
select tests.as_service();
select public.record_post_read(tests.id('r2'), false, null, null, null, 'claude', '[{"use": "joints", "outcome": "better"}]'::jsonb);
select tests.as_owner();
select is((select uses from public.post_reads where post_id = tests.id('r2')), '[]'::jsonb,
  'A read that doesn''t count keeps no uses');
select tests.as_service();
select public.record_post_read(tests.id('r2'), true, 'better', null, null, 'claude');
select tests.as_owner();
select is((select uses from public.post_reads where post_id = tests.id('r2')), '[]'::jsonb,
  'and a caller that sends no uses still works');
select tests.as_user('bob');
select throws_ok($$ select public.record_post_read(tests.id('r1'), true, 'worse', null, null, 'me', '[]') $$, '42501', null,
  'Members can''t write reads themselves');
select throws_ok($$ select private.clean_uses('[]', 'better') $$, '42501', null, 'or call the cleaner');

-- ===========================================================================
-- 3. Ratings by use
-- ===========================================================================
select tests.as_user('bob');
select is((select (u->>'rating') from public.signal_board b, jsonb_array_elements(b.by_use) u
           where b.compound_id = 'bpc157' and u->>'use' = 'joints'), null,
  'One report on joint pain isn''t enough for a rating');
select is((select u->>'forum' from public.signal_board b, jsonb_array_elements(b.by_use) u
           where b.compound_id = 'bpc157' and u->>'use' = 'injury'), 'Very common',
  'The forums'' mentions show for each use they talk about');
select tests.as_service();
select public.record_post_read(tests.id('r2'), true, 'better', null, null, 'claude', '[{"use": "joints", "outcome": "better"}]'::jsonb);
select public.record_post_read(tests.id('r3'), true, 'same', null, null, 'claude', '[{"use": "joints", "outcome": "same"}, {"use": "injury", "outcome": "better"}]'::jsonb);
select tests.as_user('bob');
create temp table j as
  select u from public.signal_board b, jsonb_array_elements(b.by_use) u where b.compound_id = 'bpc157' and u->>'use' = 'joints';
select is((select (u->>'reports')::integer from j), 3, 'Three reports name joint pain');
select is((select (u->>'rating')::integer from j), 83, 'so it gets a rating: better counts fully, about the same half (2.5 of 3: 83)');
select is((select ((u->>'better')::integer, (u->>'same')::integer, (u->>'worse')::integer)::text from j), '(2,1,0)',
  'with how those reports went');
select is((select u->>'forum' from j), 'Very common', 'next to how often the forums mention it');
select is((select b.by_use->0->>'use' from public.signal_board b where b.compound_id = 'bpc157'), 'joints',
  'Rated uses come first');
drop table j;

-- "Same for me" weighs in like it does for the Signal; a new account counts half
select tests.as_user('alice');
insert into public.same_for_me (post_id) values (tests.id('r3'));
select tests.as_user('bob');
select is((select (u->>'rating')::integer from public.signal_board b, jsonb_array_elements(b.by_use) u
           where b.compound_id = 'bpc157' and u->>'use' = 'joints'), 75,
  '“Same for me” on a report counts toward its uses (3 of 4: 75)');
select is((select (u->>'reports')::integer from public.signal_board b, jsonb_array_elements(b.by_use) u
           where b.compound_id = 'bpc157' and u->>'use' = 'joints'), 3, 'but only reports count as reports');

-- The author corrects how it went: each use follows
select tests.as_user('dave');
select public.confirm_read(tests.id('r3'), 'worse');
select tests.as_owner();
select is((select uses from public.post_reads where post_id = tests.id('r3')),
  '[{"use": "joints", "outcome": "worse"}, {"use": "injury", "outcome": "worse"}]'::jsonb,
  'When the author corrects how it went, each use follows their answer');
select tests.as_user('bob');
select is((select (u->>'worse')::integer from public.signal_board b, jsonb_array_elements(b.by_use) u
           where b.compound_id = 'bpc157' and u->>'use' = 'joints'), 1, 'and the ratings move with it');

-- A read that arrives after the author answered keeps their answer, and adds what it was for
select tests.as_owner();
select tests.post('r4', 'erin', 'bpc157');
select tests.as_user('erin');
select public.confirm_read(tests.id('r4'), 'better');
select tests.as_service();
select public.record_post_read(tests.id('r4'), true, 'worse', null, null, 'claude', '[{"use": "gut", "outcome": "worse"}]'::jsonb);
select tests.as_owner();
select is((select (outcome, uses)::text from public.post_reads where post_id = tests.id('r4')),
  (select ('better', '[{"use": "gut", "outcome": "better"}]'::jsonb)::text),
  'A read that comes after the author answered keeps their answer, and adds what it was for');
delete from public.posts where id = tests.id('r4');

-- A post taken down stops counting
select tests.as_owner();
update public.posts set status = 'removed' where id = tests.id('r2');
select tests.as_user('bob');
select is((select u->>'rating' from public.signal_board b, jsonb_array_elements(b.by_use) u
           where b.compound_id = 'bpc157' and u->>'use' = 'joints'), null,
  'A report taken down stops counting, and with two left the rating waits');
select tests.as_owner();
update public.posts set status = 'visible' where id = tests.id('r2');

-- The post shows what it was for
select tests.as_user('bob');
select is((select read_uses from public.feed where id = tests.id('r1')),
  '[{"use": "joints", "outcome": "better"}, {"use": "gut", "outcome": "same"}, {"use": "sleep", "outcome": "better"}]'::jsonb,
  'Each post shows what its report was for');

-- A compound with no forum data gets uses from reports only
select tests.as_owner();
select tests.post('c1', 'bob', 'creatine');
select tests.post('c2', 'carol', 'creatine');
select tests.post('c3', 'dave', 'creatine');
select tests.post('c4', 'newbie', 'creatine');
select tests.as_service();
select public.record_post_read(tests.id('c1'), true, 'better', null, null, 'claude', '[{"use": "strength", "outcome": "better"}]'::jsonb);
select public.record_post_read(tests.id('c2'), true, 'better', null, null, 'claude', '[{"use": "strength", "outcome": "better"}]'::jsonb);
select public.record_post_read(tests.id('c3'), true, 'worse', null, null, 'claude', '[{"use": "strength", "outcome": "worse"}]'::jsonb);
select public.record_post_read(tests.id('c4'), true, 'better', null, null, 'claude', '[{"use": "strength", "outcome": "better"}]'::jsonb);
select tests.as_user('bob');
select is((select b.by_use from public.signal_board b where b.compound_id = 'creatine'),
  '[{"use": "strength", "same": 0, "forum": null, "worse": 1, "better": 3, "rating": 71, "voices": 4, "reports": 4}]'::jsonb,
  'Without forum data a compound''s uses come from reports alone (a first-week account counts half: 2.5 of 3.5, 71)');

-- ===========================================================================
-- 4. The public snapshot
-- ===========================================================================
select tests.as_owner();
create temp table snap as select private.public_snapshot() as j;
select is((select j->'uses'->'joints' from snap), '["Joint pain", "recovery"]'::jsonb, 'The public snapshot names the uses');
select is((select u from snap, jsonb_array_elements(j->'signals'->'bpc157'->'by_use') u where u->>'use' = 'joints'),
  (select u from public.signal_board b, jsonb_array_elements(b.by_use) u where b.compound_id = 'bpc157' and u->>'use' = 'joints'),
  'and gives each rated use in full');
select is((select u from snap, jsonb_array_elements(j->'signals'->'bpc157'->'by_use') u where u->>'use' = 'injury'),
  '{"use": "injury", "forum": "Very common"}'::jsonb, 'but for a use with too few reports, only what the forums say');
select is((select count(*)::integer from snap, jsonb_array_elements(j->'signals'->'bpc157'->'by_use') u where u->>'use' = 'sleep'), 0,
  'and nothing at all for a use only a report or two mention');

select * from finish();
rollback;
