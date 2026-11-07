-- The Community Signal, published: once a minute the database builds the public snapshot (the
-- numbers behind every Signal, the same as snapshot.json) and, when the numbers changed, keeps it
-- as a new numbered version. Everything that shows the Signal reads a version from here: the
-- signal function (the public read API, for miraclehealth.us), Sig's chat (the ask function),
-- and the Pages build that writes the static snapshot.json, the fallback when the API can't
-- answer. Before this, snapshot.json was rebuilt only with the whole community site, which
-- GitHub runs every four to eight hours, so a report took that long to reach the website.
--
--   private.signal_publications   one row per version; the newest 60 are kept
--   private.publish_signal(by)    builds the snapshot and stores it when it changed (pg_cron, each minute)
--   public.signal_latest(known)   the newest version for the functions (service role only); its
--                                 payload is left out when the caller already holds that version
--   public.signal_refresh(known)  publishes, then answers like signal_latest: the signal
--                                 function's fallback when the minute job hasn't run for minutes

-- ===========================================================================
-- 1. The versions
-- ===========================================================================
create table private.signal_publications (
  version bigint generated always as identity primary key,
  published_at timestamptz not null default now(),
  -- when the publisher last found these numbers still current, and who it was: the minute job,
  -- the signal function standing in for it, or a deploy
  checked_at timestamptz not null default now(),
  checked_by text not null default 'cron' check (checked_by in ('cron', 'api', 'deploy')),
  -- md5 of the payload without its timestamp: the same numbers always hash the same
  hash text not null check (hash ~ '^[0-9a-f]{32}$'),
  bytes integer not null check (bytes > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and payload ? 'signals')
);
revoke all on private.signal_publications from public, anon, authenticated;

-- ===========================================================================
-- 2. Publishing
-- ===========================================================================
-- Returns the new version, or null when the numbers hadn't changed (only checked_at moves) or
-- another publish was already running (one at a time: a transaction advisory lock).
create function private.publish_signal(p_by text default 'cron') returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_payload jsonb;
  v_hash text;
  v_latest bigint;
  v_latest_hash text;
  v_version bigint;
begin
  if not pg_try_advisory_xact_lock(hashtext('signal:publish')) then
    return null;
  end if;
  v_payload := private.public_snapshot() || jsonb_build_object('founders', private.founding_progress());
  v_hash := md5((v_payload - 'generated_at')::text);
  select p.version, p.hash into v_latest, v_latest_hash
  from private.signal_publications p order by p.version desc limit 1;
  if v_latest is not null and v_latest_hash = v_hash then
    update private.signal_publications set checked_at = now(), checked_by = p_by where version = v_latest;
    return null;
  end if;
  insert into private.signal_publications (checked_by, hash, bytes, payload)
  values (p_by, v_hash, octet_length(v_payload::text), v_payload)
  returning version into v_version;
  -- The newest 60 are kept (about an hour when the numbers move every minute); a compound's own
  -- history stays in public.signal_snapshots
  delete from private.signal_publications where version <= v_version - 60;
  return v_version;
end;
$$;

-- ===========================================================================
-- 3. Reading, for the functions (service role only)
-- ===========================================================================
-- {version, hash, published_at, checked_at, checked_by, bytes, payload}, or null before the
-- first publish. p_known: the version the caller already holds; when it's still the newest the
-- payload is left out, so a check that finds nothing new moves a couple of hundred bytes.
create function public.signal_latest(p_known bigint default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'version', p.version, 'hash', p.hash, 'published_at', p.published_at,
    'checked_at', p.checked_at, 'checked_by', p.checked_by, 'bytes', p.bytes,
    'payload', case when p.version is distinct from p_known then p.payload end)
  from private.signal_publications p
  order by p.version desc
  limit 1
$$;

-- The signal function calls this instead when the newest version was last checked minutes ago:
-- the minute job has stopped, so it publishes itself, and checked_by says so ('api').
create function public.signal_refresh(p_known bigint default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.publish_signal('api');
  return public.signal_latest(p_known);
end;
$$;

revoke execute on function private.publish_signal(text), public.signal_latest(bigint), public.signal_refresh(bigint)
  from public, anon, authenticated;
grant execute on function public.signal_latest(bigint), public.signal_refresh(bigint) to service_role;

-- ===========================================================================
-- 4. Every minute (pg_cron)
-- ===========================================================================
-- Supabase projects have pg_cron; it's turned on here. A plain Postgres without it (the local
-- test database, scripts/local_db.sh) skips this, and the signal function publishes when asked.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here: the Signal is published on deploy and by the signal function';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  grant usage on schema cron to postgres;
  grant all privileges on all tables in schema cron to postgres;
  -- by name: running this again updates the job rather than adding a second one
  perform cron.schedule('signal-publish', '* * * * *', 'select private.publish_signal()');
end $$;

-- The first version, so the function has one to serve before the job's first run
select private.publish_signal('deploy');
