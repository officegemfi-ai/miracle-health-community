-- Miracle Health community: the counts behind Miracle AI's chat on the website (pgTAP)
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

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;
create function tests.as_role(p_role text) returns void
language plpgsql as $$
begin
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
end $$;
create function tests.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- 64 hex characters, like the function's daily HMAC of an address
create function tests.key(p text) returns text
language sql immutable as $$ select md5(p) || md5(p || '.') $$;
grant execute on function tests.as_role(text), tests.as_owner(), tests.key(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Who can count
-- ---------------------------------------------------------------------------
select tests.as_role('anon');
select throws_ok($$ select public.ask_take(tests.key('a')) $$, '42501', null, 'Visitors can''t call the counter themselves');
select throws_ok($$ select count(*) from private.ask_usage $$, '42501', null, 'or read the counts');
select tests.as_role('authenticated');
select throws_ok($$ select public.ask_take(tests.key('a')) $$, '42501', null, 'Neither can signed-in members');
select tests.as_role('service_role');
select is(public.ask_take(tests.key('first')), '{"ok": true, "left": 39}'::jsonb, 'The ask function can: a visitor starts with 40 a day');
select throws_ok($$ select public.ask_take('203.0.113.9') $$, '22023', null, 'Only a hashed key is taken, never an address');

-- ---------------------------------------------------------------------------
-- The limits
-- ---------------------------------------------------------------------------
select tests.as_owner();
update private.settings set value = '2' where key = 'ask_per_visitor_10min';
select tests.as_role('service_role');
select is(public.ask_take(tests.key('c'))->>'ok', 'true', 'A second message in ten minutes goes ahead');
select is(public.ask_take(tests.key('c'))->>'ok', 'true', '');
select is(public.ask_take(tests.key('c')), '{"ok": false, "reason": "burst"}'::jsonb, 'A third in ten minutes waits (burst)');

select tests.as_owner();
update private.settings set value = '100' where key = 'ask_per_visitor_10min';
update private.settings set value = '3' where key = 'ask_per_visitor_day';
-- "first" and "c" (twice) have used 3 of the site's day so far
update private.settings set value = '6' where key = 'ask_per_day';
select tests.as_role('service_role');
select is(public.ask_take(tests.key('a'))->>'left', '2', 'Each answer says how many are left today');
select is(public.ask_take(tests.key('a'))->>'ok', 'true', '');
select is(public.ask_take(tests.key('a'))->>'left', '0', '');
select is(public.ask_take(tests.key('a')), '{"ok": false, "reason": "visitor_day"}'::jsonb, 'Past the visitor''s day: turned away');
select is(public.ask_take(tests.key('b')), '{"ok": false, "reason": "site_day"}'::jsonb,
          'Past the site''s day: everyone waits until tomorrow (the turned-away message above didn''t count)');

select tests.as_owner();
select is((select n from private.ask_usage where bucket = 'site'), 7, 'The site''s count only grows with messages the visitor''s own limits let through');
select is((select count(*)::integer from private.ask_usage where bucket !~ '^(site|v10:[0-9a-f]{64}|vd:[0-9a-f]{64})$'), 0, 'Nothing but hashed keys and the site''s total is kept');
update private.settings set value = 'off' where key = 'ask_enabled';
select tests.as_role('service_role');
select is(public.ask_take(tests.key('d')), '{"ok": false, "reason": "off"}'::jsonb, 'It can be paused');

select * from finish();
rollback;
