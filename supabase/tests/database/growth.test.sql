-- Miracle Health community: growth (pgTAP)
-- GLP-1s first, a report public by its author's choice, check-in texts by the member's choice,
-- and the weekly email's sign-up, confirmation and unsubscribing. Rolls back at the end.

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
create function tests.member(p_name text, p_age interval default interval '30 days') returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, phone, phone_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'authenticated', 'authenticated', '1557' || lpad((abs(hashtext(p_name)) % 10000000)::text, 7, '0'),
          now(), now(), now(), '{}', '{}');
  insert into public.profiles (id, handle, role, status, suspended_until, trusted,
                               adult_confirmed_at, rules_version, created_at, health_data_consent_at)
  values (v, p_name, 'member', 'active', null, true, now(), '2026-10-21', now() - p_age, now());
  return tests.remember(p_name, v);
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
create function tests.post(p_name text, p_author text, p_compound text, p_kind public.post_kind default 'experience',
                           p_ago interval default interval '0 seconds')
returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.posts (author_id, compound_id, kind, title, body, created_at)
  values (tests.id(p_author), p_compound, p_kind, 'Sample title for ' || p_name, 'Sample body for ' || p_name, now() - p_ago)
  returning id into v;
  return tests.remember(p_name, v);
end $$;

select tests.member('gina');
select tests.member('hank');

-- ---------------------------------------------------------------------------
-- 1. GLP-1s first
-- ---------------------------------------------------------------------------
select is((select compound_id || '/' || use_id from public.focus_pairs order by sort limit 1), 'tirzepatide/fat_loss',
  'The pairs the community fills first start with the GLP-1s');
select ok(exists (select 1 from public.focus_pairs where compound_id = 'bpc157' and use_id = 'injury'),
  'BPC-157 for injuries is still on the list');

-- ---------------------------------------------------------------------------
-- 2. A report public by its author's choice
-- ---------------------------------------------------------------------------
select tests.post('g1', 'gina', 'bpc157');
select tests.post('gq', 'gina', 'bpc157', 'question');
select tests.as_user('hank');
select throws_ok($$ select public.set_post_public(tests.id('g1'), true) $$, '42501', null,
  'Only the author can make a report public');
select tests.as_user('gina');
select isnt(public.set_post_public(tests.id('g1'), true), null, 'The author makes their report public');
select throws_like($$ select public.set_post_public(tests.id('gq'), true) $$, '%Only reports%',
  'A question can’t be public');
select tests.as_owner();
select is(jsonb_array_length(private.public_reports()), 1, 'The site build sees one public report');
select is(private.public_reports()->0->>'handle', 'gina', 'with its author’s handle');
select ok(not (private.public_reports()->0 ? 'author_id'), 'and never who they are behind it');
update public.posts set status = 'held' where id = tests.id('g1');
select is(jsonb_array_length(private.public_reports()), 0, 'A held report isn’t public');
update public.posts set status = 'visible' where id = tests.id('g1');
select tests.as_user('gina');
select is(public.set_post_public(tests.id('g1'), false), null, 'The author takes it back');
select tests.as_owner();
select is(jsonb_array_length(private.public_reports()), 0, 'and it’s off the public list');
select tests.as_anon();
select throws_ok($$ select private.public_reports() $$, '42501', null, 'Visitors can’t call the build’s list');

-- ---------------------------------------------------------------------------
-- 3. Check-in texts by choice
-- ---------------------------------------------------------------------------
select tests.as_owner();
select tests.post('h1', 'hank', 'tirzepatide', 'experience', interval '15 days');
insert into public.post_reads (post_id, compound_id, counts, outcome) values (tests.id('h1'), 'tirzepatide', true, 'better');
select tests.as_service();
select is((select count(*)::int from public.texts_due(50)), 0, 'Nobody gets a text without asking for it');
select tests.as_user('hank');
select is(public.set_checkin_texts(true, 'America/New_York')->>'tz', 'America/New_York', 'A member turns texts on, in their time zone');
select is(public.my_checkin_texts()->>'on', 'true', 'and sees it’s on');
select tests.as_service();
select is((select week::int from public.texts_due(50) where user_id = tests.id('hank')), 2, 'Their 2-week check-in is due for a text');
select lives_ok($$ select public.text_sent(tests.id('h1'), 2::smallint) $$, 'The sender records the text');
select is((select count(*)::int from public.texts_due(50)), 0, 'and doesn’t send it twice');
select lives_ok($$ select public.text_stopped(tests.id('hank')) $$, 'Replying STOP turns texts off');
select tests.as_user('hank');
select is(public.my_checkin_texts()->>'on', 'false', 'and the member sees they’re off');
select is(public.set_checkin_texts(false, 'Nowhere/Fake')->>'tz', 'America/Los_Angeles', 'An unknown time zone falls back to Pacific');
select throws_ok($$ select public.texts_due(5) $$, '42501', null, 'Members can’t see who’s due for a text');

-- ---------------------------------------------------------------------------
-- 4. The weekly email
-- ---------------------------------------------------------------------------
select tests.as_anon();
select throws_ok($$ select public.newsletter_add('a@example.com', 'home', '1.2.3.4') $$, '42501', null,
  'Visitors sign up only through the server function');
select tests.as_service();
select is(public.newsletter_add('not-an-email', 'home', '1.2.3.4')->>'why', 'email', 'A bad address is turned away');
select is(public.newsletter_add('Reader@Example.com', 'home', '1.2.3.4')->>'state', 'new', 'A new address is kept, unconfirmed');
select is((select count(*)::int from public.newsletter_due(1, 100)), 0, 'Nothing is sent before it’s confirmed');
select is((select count(*)::int from public.newsletter_pending(100)), 1, 'Its confirmation email is waiting to go');
select lives_ok($$ select public.newsletter_asked(array(select id from public.newsletter_pending(100))) $$, 'The confirmation email goes');
select is((select count(*)::int from public.newsletter_pending(100)), 0, 'and only once');
select tests.as_owner();
select tests.remember('ctok', (select confirm_token from private.newsletter where email = 'reader@example.com'));
select tests.remember('utok', (select unsub_token from private.newsletter where email = 'reader@example.com'));
select tests.as_service();
select ok(public.newsletter_confirm(tests.id('ctok')), 'Confirming works');
select is((select count(*)::int from public.newsletter_due(1, 100)), 1, 'then it gets the next issue');
select lives_ok($$ select public.newsletter_sent(array(select id from public.newsletter_due(1, 100)), 1) $$, 'Sent issue 1');
select is((select count(*)::int from public.newsletter_due(1, 100)), 0, 'and never twice');
select is(public.newsletter_add('reader@example.com', 'home', '1.2.3.4')->>'state', 'confirmed', 'Signing up again changes nothing');
select ok(public.newsletter_unsubscribe(tests.id('utok')), 'Unsubscribing works');
select is((select count(*)::int from public.newsletter_due(2, 100)), 0, 'and nothing more is sent');
select is(public.newsletter_add('x1@example.com', 'home', '9.9.9.9')->>'ok', 'true', 'One connection: 1');
select public.newsletter_add('x2@example.com', 'home', '9.9.9.9'), public.newsletter_add('x3@example.com', 'home', '9.9.9.9'),
       public.newsletter_add('x4@example.com', 'home', '9.9.9.9'), public.newsletter_add('x5@example.com', 'home', '9.9.9.9');
select is(public.newsletter_add('x6@example.com', 'home', '9.9.9.9')->>'why', 'limit', 'the sixth sign-up from one connection in a day is turned away');
select tests.as_owner();
select ok(not exists (select 1 from private.newsletter_hits where key like '%9.9.9.9%'), 'and the address itself is never stored');

-- ---------------------------------------------------------------------------
-- 5. The first 100 reporters
-- ---------------------------------------------------------------------------
select tests.as_owner();
select is((private.founding_progress()->>'taken')::int, (select count(*)::int from public.member_badges where badge = 'founder100'),
  'The snapshot counts the founding reporters there are');
select tests.member('ivy');
select tests.post('i1', 'ivy', 'semaglutide', 'experience', interval '1 day');
insert into public.post_reads (post_id, compound_id, counts, outcome) values (tests.id('i1'), 'semaglutide', true, 'same');
select private.check_badges(tests.id('ivy'));
select ok(exists (select 1 from public.member_badges where user_id = tests.id('ivy') and badge = 'founder100'),
  'A member whose report counts, among the first 100, is a founding reporter');
select tests.member('jojo');
select tests.post('j1', 'jojo', 'semaglutide', 'question');
select private.check_badges(tests.id('jojo'));
select ok(not exists (select 1 from public.member_badges where user_id = tests.id('jojo') and badge = 'founder100'),
  'A question doesn’t make anyone a founding reporter');
select tests.as_anon();
select throws_ok($$ select private.founding_progress() $$, '42501', null, 'Visitors can’t call the snapshot’s count');

select * from finish();
rollback;
