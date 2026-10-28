-- Miracle Health community: the library, stacks and suggestions (pgTAP)
-- Posting one compound, a blend or a stack; finding stacks; a stack's own Signal;
-- suggesting what the library is missing. Everything rolls back at the end.

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

-- The stack a member posts, by name
create function tests.stack_post(p_name text, p_author text, p_compounds text[], p_body text default 'Six weeks in: better than before I started.')
returns uuid
language plpgsql as $$
declare v uuid;
begin
  perform tests.as_user(p_author);
  v := public.create_post(p_compounds, 'experience', 'Sample title for ' || p_name, p_body);
  perform tests.as_owner();
  return tests.remember(p_name, v);
end $$;
create function tests.cid(p_post text) returns text
language sql stable as $$ select compound_id from public.posts where id = tests.id(p_post) $$;

select tests.member('alice', 'member', true, interval '60 days');   -- trusted founding member
select tests.member('bob');
select tests.member('carol');
select tests.member('dave');
select tests.member('dan', 'member', false, interval '1 day');      -- brand new
select tests.member('mia', 'moderator', false, interval '90 days');
select tests.member('ben', 'member', false, interval '30 days', 'banned');

-- ===========================================================================
-- 1. The library
-- ===========================================================================
select tests.as_user('bob');
select ok((select count(*) from public.compounds where kind <> 'stack') >= 300, 'The library has 300 entries or more');
select is((select array_agg(distinct family order by family) from public.compounds where kind <> 'stack'),
  array['Blends', 'Hormones', 'Medications', 'Peptides', 'Supplements'],
  'in five families: peptides, hormones, supplements, medications and blends');
select ok(exists (select 1 from public.compounds c, unnest(c.aliases) a where c.id = 'semaglutide' and a = 'Ozempic'),
  'Brand names are there to search by (Ozempic is semaglutide)');
select is((select array_agg(part_id order by part_id) from public.compound_parts where compound_id = 'wolverine'),
  array['bpc157', 'tb500'], 'A blend lists what''s in the vial');
select is((select kind from public.compounds where id = 'wolverine'), 'blend', 'and is a blend, scored on its own');
select is((select name from public.compounds where id = 'bpc157'), 'BPC-157', 'Existing compounds keep their ids');
select throws_ok($$ insert into public.compounds (id, name) values ('newthing', 'New thing') $$, '42501', null,
  'Members can''t add to the library directly');
select throws_ok($$ insert into public.compound_parts values ('wolverine', 'ghkcu') $$, '42501', null,
  'or change what a blend contains');
select is((select count(*) from public.spaces where kind = 'blend'), 9::bigint, 'Blends have spaces of their own');

-- ===========================================================================
-- 2. Posting one compound, a blend, or a stack
-- ===========================================================================
select tests.stack_post('bob_bpc', 'bob', array['bpc157']);
select is(tests.cid('bob_bpc'), 'bpc157', 'One compound posts to its own space, as before');
select is((select part_ids from public.posts where id = tests.id('bob_bpc')), array['bpc157'], 'and the post says what''s in it');

select tests.stack_post('bob_stack', 'bob', array['tb500', ' BPC157 ', 'bpc157']);
select ok(tests.cid('bob_stack') like 'stack-%', 'Two compounds post to a stack');
select is((select name from public.compounds where id = tests.cid('bob_stack')), 'BPC-157 + TB-500',
  'named after what''s in it, whatever order they were picked in');
select is((select (kind, family, category)::text from public.compounds where id = tests.cid('bob_stack')),
  '(stack,Stacks,Stacks)', 'It''s a stack');
select is((select array_agg(part_id order by part_id) from public.compound_parts where compound_id = tests.cid('bob_stack')),
  array['bpc157', 'tb500'], 'made of exactly the picked compounds (repeats and spaces ignored)');
select is((select part_ids from public.posts where id = tests.id('bob_stack')),
  array[tests.cid('bob_stack'), 'bpc157', 'tb500'], 'and the post lists the stack and both compounds');

select tests.stack_post('carol_stack', 'carol', array['bpc157', 'tb500']);
select is(tests.cid('carol_stack'), tests.cid('bob_stack'), 'The same stack picked again is the same space');
select is((select count(*) from public.compounds where kind = 'stack'), 1::bigint, 'with no duplicate made');

select tests.stack_post('dave_blend', 'dave', array['wolverine']);
select is(tests.cid('dave_blend'), 'wolverine', 'A blend on its own posts to the blend');
select is((select part_ids from public.posts where id = tests.id('dave_blend')), array['wolverine', 'bpc157', 'tb500'],
  'and still shows up for each compound in it');
select tests.stack_post('dave_blend_plus', 'dave', array['wolverine', 'ghkcu']);
select is((select name from public.compounds where id = tests.cid('dave_blend_plus')), 'GHK-Cu + Wolverine blend (BPC-157 + TB-500)',
  'A blend can be part of a stack');
select is((select part_ids from public.posts where id = tests.id('dave_blend_plus')),
  array[tests.cid('dave_blend_plus'), 'bpc157', 'ghkcu', 'tb500', 'wolverine'],
  'and shows up for what''s in the blend too');

select tests.as_user('bob');
select throws_ok($$ select public.create_post(array[]::text[], 'experience', 'Nothing picked here', 'Body') $$, 'P0001',
  'Pick what you took from the library.', 'A post needs at least one compound');
select throws_ok($$ select public.create_post(array['bpc157','tb500','ghkcu','kpv','semax','selank','dsip','epithalon','motsc'], 'experience', 'Nine at once', 'Body') $$,
  'P0001', 'A stack can have up to 8 compounds.', 'and at most eight');
select throws_ok($$ select public.create_post(array['bpc157','madeup-thing'], 'experience', 'Unknown thing', 'Body') $$,
  'P0001', null, 'Only library entries can be picked');
select throws_ok(format($$ select public.create_post(array[%L, 'ghkcu'], 'experience', 'Stack of a stack', 'Body') $$, tests.cid('bob_stack')),
  'P0001', null, 'A stack can''t contain another stack');
select throws_ok($$ insert into public.posts (compound_id, kind, title, body, part_ids) values ('bpc157', 'experience', 'Sneaky parts', 'Body', array['semaglutide']) $$,
  '42501', null, 'Members can''t write what a post contains');
select tests.as_user('ben');
select throws_ok($$ select public.create_post(array['bpc157','tb500'], 'experience', 'Banned member', 'Body') $$, '42501', null,
  'A banned member can''t post a stack');
select tests.as_anon();
select throws_ok($$ select public.create_post(array['bpc157'], 'experience', 'Not signed in', 'Body') $$, '42501', null,
  'and nobody signed out can post');

-- The usual limits and checks still apply, and a refused post makes no stack
select tests.as_user('dan');
select lives_ok($$ select public.create_post(array['semax'], 'experience', 'Day one on semax', 'Calm focus') $$, 'A new member posts');
select lives_ok($$ select public.create_post(array['selank'], 'experience', 'Day two on selank', 'Calm') $$, 'twice');
select lives_ok($$ select public.create_post(array['dsip'], 'experience', 'Day three on DSIP', 'Sleep') $$, 'three times');
select throws_ok($$ select public.create_post(array['semax', 'selank', 'dsip'], 'experience', 'My whole stack', 'All three') $$,
  'P0001', null, 'A fourth post on the first day is refused');
select is((select count(*) from public.compounds where stack_key = 'dsip+selank+semax'), 0::bigint, 'and its stack isn''t made');
select tests.as_user('carol');
select throws_ok($$ select public.create_post(array['semax', 'kpv'], 'experience', 'Where to buy semax', 'Where to buy it?') $$,
  'P0001', null, 'Sourcing is blocked in stacks too');
select is((select count(*) from public.compounds where stack_key = 'kpv+semax'), 0::bigint, 'with no stack left behind');

-- ===========================================================================
-- 3. Finding stacks
-- ===========================================================================
select tests.as_user('carol');
select is((select count(*) from public.feed where part_ids @> array['bpc157']), 5::bigint,
  'Searching BPC-157 finds every post with it: alone, in stacks and in blends');
select is((select count(*) from public.feed where part_ids @> array['bpc157', 'tb500']), 4::bigint,
  'Searching BPC-157 and TB-500 finds the stack, the blend and the stack with the blend');
select is((select count(*) from public.feed where compound_id = tests.cid('bob_stack')), 2::bigint,
  'The stack''s own space has its two posts');
insert into public.space_members (compound_id) values ('tb500');
select ok((select in_my_spaces from public.feed where id = tests.id('bob_stack')),
  'Following TB-500 brings its stacks to your Home feed');
select is((select part_ids from public.spaces where compound_id = tests.cid('bob_stack')), array['bpc157', 'tb500'],
  'A stack''s space lists its compounds');
select is((select count(*) from public.spaces where kind = 'stack'), 2::bigint, 'Stacks with posts have spaces');
select tests.as_user('dave');
delete from public.posts where id = tests.id('dave_blend_plus');
select is((select count(*) from public.spaces where kind = 'stack'), 1::bigint, 'and a stack with no posts left drops out of sight');

-- ===========================================================================
-- 4. A stack has its own Signal, from reports of exactly that stack
-- ===========================================================================
select tests.as_owner();
create temp table bpc_before as select coalesce((select first_hand from public.signal_board where compound_id = 'bpc157'), 0) as n;
grant all on bpc_before to authenticated, service_role;
select tests.as_service();
select public.record_post_read(tests.id('bob_stack'), true, 'better', '6 weeks', null, 'claude');
select is((select compound_id from public.post_reads where post_id = tests.id('bob_stack')), tests.cid('bob_stack'),
  'Miracle AI''s read of a stack report counts for the stack');
select tests.as_user('bob');
select is((select kind || ':' || have || ':' || need from public.community_goals where compound_id = tests.cid('bob_stack')),
  'unlock:1:3', 'After its first report the stack has a goal: three reports unlock its Signal');
select tests.as_service();
select public.record_post_read(tests.id('carol_stack'), true, 'better', null, null, 'claude');
select tests.stack_post('alice_stack', 'alice', array['tb500', 'bpc157']);
select tests.as_service();
select public.record_post_read(tests.id('alice_stack'), true, 'same', null, null, 'claude');
select tests.as_user('bob');
select ok((select score from public.signal_board where compound_id = tests.cid('bob_stack')) is not null,
  'Three reports give the stack a Signal of its own');
select is((select kind from public.signal_board where compound_id = tests.cid('bob_stack')), 'stack', 'shown as a stack');
select is((select first_hand from public.signal_board where compound_id = 'bpc157'), (select n from bpc_before),
  'BPC-157''s own number doesn''t mix in reports of the stack');
select tests.as_service();
select public.record_post_read(tests.id('bob_bpc'), true, 'better', null, null, 'claude');
select tests.as_user('bob');
select is((select first_hand from public.signal_board where compound_id = 'bpc157'), (select n from bpc_before) + 1,
  'while a report of BPC-157 alone moves it');

-- ===========================================================================
-- 5. Suggesting what the library is missing
-- ===========================================================================
select tests.as_user('carol');
insert into public.compound_requests (name, note) values ('  Selank nasal spray ', 'The nasal form');
select is((select (name, status, requested_by = tests.id('carol'))::text from public.compound_requests),
  '("Selank nasal spray",open,t)', 'A member suggests something missing');
select throws_ok($$ insert into public.compound_requests (name) values ('Ozempic') $$, 'P0001', 'Ozempic is already in the library.',
  'Suggesting what''s already there (even by a brand name) says so');
select throws_ok($$ insert into public.compound_requests (name, note) values ('Semax spray', 'where to buy it cheap') $$, 'P0001', null,
  'Sourcing in a suggestion is blocked');
select throws_ok($$ update public.compound_requests set status = 'added' $$, '42501', null, 'Members can''t mark it added');
select throws_ok($$ select public.add_compound('Selank nasal spray', 'Peptides', 'Mood & stress', null, null) $$, '42501', null,
  'or add to the library themselves');
select tests.as_user('bob');
select is((select count(*) from public.library_requests), 0::bigint, 'Other members don''t see who suggested what');
insert into public.compound_requests (name) values ('Glycine propionyl'), ('Some odd thing');

select tests.as_user('mia');
select is((select count(*) from public.library_requests where status = 'open'), 3::bigint, 'Moderators see every suggestion');
select is(public.add_compound('Selank nasal spray', 'Peptides', 'Mood & stress', array['Selank spray', ' '],
  (select id from public.compound_requests where name = 'Selank nasal spray')), 'selank-nasal-spray',
  'and add it to the library');
select is((select (family, category, aliases)::text from public.compounds where id = 'selank-nasal-spray'),
  '(Peptides,"Mood & stress","{""Selank spray""}")', 'with its family, category and aliases');
select is((select status || ':' || compound_id from public.compound_requests where name = 'Selank nasal spray'),
  'added:selank-nasal-spray', 'The suggestion is marked added');
select throws_ok($$ select public.add_compound('selank NASAL spray', 'Peptides', 'Mood & stress', null, null) $$, 'P0001', null,
  'The same name can''t be added twice');
select throws_ok($$ select public.add_compound('New steroid', 'Steroids', 'Mood & stress', null, null) $$, 'P0001', null,
  'Only the library''s families');
select throws_ok($$ select public.add_compound('New thing', 'Supplements', 'Whatever', null, null) $$, 'P0001', null,
  'and categories');
select lives_ok(format($$ select public.dismiss_compound_request(%s) $$, (select id from public.compound_requests where name = 'Some odd thing')),
  'A moderator can turn one down');
select tests.as_user('carol');
select is((select kind || ':' || (data->>'name') from public.my_notifications where kind = 'library'), 'library:Selank nasal spray',
  'Whoever suggested it hears it was added');
select ok(exists (select 1 from public.spaces where compound_id = 'selank-nasal-spray'), 'and it has a space');
select lives_ok($$ select public.create_post(array['selank-nasal-spray', 'semax'], 'experience', 'Spray plus semax', 'Calmer') $$,
  'and goes into stacks like the rest');

select * from finish();
rollback;
