-- Miracle Health community: the published Signal, the versions the signal function and Sig read
-- (migration 20261107000100) (pgTAP)
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
-- The newest version, read as the owner
create function tests.newest() returns private.signal_publications
language sql as $$ select * from private.signal_publications order by version desc limit 1 $$;
-- How many minute jobs publish the Signal; null where pg_cron isn't installed (plain Postgres)
create function tests.cron_jobs() returns integer
language plpgsql as $$
declare
  n integer;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return null;
  end if;
  execute $q$ select count(*)::integer from cron.job
              where jobname = 'signal-publish' and schedule = '* * * * *' and command = 'select private.publish_signal()' $q$ into n;
  return n;
end $$;
grant execute on function tests.as_role(text), tests.as_owner() to anon, authenticated, service_role;

-- The minute job can't publish in the middle of this test: it waits for the lock held here
-- (the publisher takes the same one, and a session that holds a lock can take it again)
select pg_advisory_xact_lock(hashtext('signal:publish'));

-- ---------------------------------------------------------------------------
-- Who can read and publish
-- ---------------------------------------------------------------------------
select tests.as_role('anon');
select throws_ok($$ select public.signal_latest() $$, '42501', null, 'Visitors can''t call the reader themselves');
select throws_ok($$ select public.signal_refresh() $$, '42501', null, 'or the publisher');
select throws_ok($$ select count(*) from private.signal_publications $$, '42501', null, 'or read the versions');
select tests.as_role('authenticated');
select throws_ok($$ select public.signal_latest() $$, '42501', null, 'Neither can signed-in members');
select throws_ok($$ select public.signal_refresh() $$, '42501', null, 'or the publisher');
select tests.as_role('service_role');
select throws_ok($$ select private.publish_signal() $$, '42501', null, 'The functions can''t call the publisher directly, only through signal_refresh');
select isnt(public.signal_latest(), null, 'The signal and ask functions can read the newest version');

-- ---------------------------------------------------------------------------
-- Publishing: a new version only when the numbers change
-- ---------------------------------------------------------------------------
select tests.as_owner();
delete from private.signal_publications;
select tests.as_role('service_role');
select is(public.signal_latest(), null, 'Before the first publish there is nothing to read');

select tests.as_owner();
select isnt(private.publish_signal('deploy'), null, 'The first publish stores a version');
select is((tests.newest()).checked_by, 'deploy', 'and says who published it');
select is(((tests.newest()).payload->>'generated_at')::timestamptz, (tests.newest()).published_at,
  'Its numbers are timed when they were published');
select ok((tests.newest()).payload ? 'signals' and (tests.newest()).payload ? 'founders',
  'It holds the public snapshot and the founding members'' count, as snapshot.json did');
select is((tests.newest()).hash, md5(((tests.newest()).payload - 'generated_at')::text),
  'Its hash leaves out the timestamp, so the same numbers always hash the same');
select is((tests.newest()).bytes, octet_length((tests.newest()).payload::text), 'and its size is counted');

select is(private.publish_signal(), null, 'The same numbers a minute later: no new version');
select is((select count(*)::integer from private.signal_publications), 1, 'still one');
select is((tests.newest()).checked_by, 'cron', 'but the check is recorded, and by whom');

update public.compounds set members_count = members_count + 5
where id = (select id from public.compounds where kind <> 'stack' order by id limit 1);
select isnt(private.publish_signal(), null, 'Changed numbers: a new version');
select is((select count(*)::integer from private.signal_publications), 2, 'beside the old one');
select ok((select (array_agg(version order by version))[1] < (array_agg(version order by version))[2] from private.signal_publications),
  'Versions only go up');

-- ---------------------------------------------------------------------------
-- Reading: the payload is left out when the caller already holds that version
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('tests.newest', (select max(version)::text from private.signal_publications), true); end $$;
select tests.as_role('service_role');
select is((public.signal_latest()->>'version')::bigint, current_setting('tests.newest')::bigint,
  'The reader answers the newest version');
select ok(public.signal_latest()->'payload' ? 'signals', 'with its payload');
select ok(public.signal_latest() ?& array['version', 'hash', 'published_at', 'checked_at', 'checked_by', 'bytes'],
  'and what the API needs to label it');
select is(public.signal_latest((public.signal_latest()->>'version')::bigint)->'payload', 'null'::jsonb,
  'A caller that already holds the newest version gets no payload');
select ok(public.signal_latest((public.signal_latest()->>'version')::bigint - 1)->'payload' ? 'signals',
  'A caller with an older one gets the new payload');

-- ---------------------------------------------------------------------------
-- The API standing in for the minute job
-- ---------------------------------------------------------------------------
select is(public.signal_refresh()->>'checked_by', 'api', 'signal_refresh publishes and says the API did it');
select ok(public.signal_refresh()->'payload' ? 'signals', 'and answers like the reader');

-- ---------------------------------------------------------------------------
-- Only the newest 60 are kept
-- ---------------------------------------------------------------------------
select tests.as_owner();
insert into private.signal_publications (hash, bytes, payload)
select md5(i::text), 16, '{"signals": {}}'::jsonb from generate_series(1, 70) i;
select isnt(private.publish_signal(), null, 'After 70 more versions, a new one');
select is((select count(*)::integer from private.signal_publications), 60, 'leaves the newest 60');
select is((select max(version) from private.signal_publications) - (select min(version) from private.signal_publications), 59::bigint,
  'and they are the newest');

-- ---------------------------------------------------------------------------
-- Every minute
-- ---------------------------------------------------------------------------
select case when tests.cron_jobs() is null
  then skip('pg_cron isn''t installed in this database (plain Postgres)', 1)
  else is(tests.cron_jobs(), 1, 'pg_cron publishes every minute, under one job')
end;

select * from finish();
rollback;
