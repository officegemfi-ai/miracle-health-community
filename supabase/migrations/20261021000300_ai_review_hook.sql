-- Miracle Health community: send each new post and comment to Claude for a
-- first read against the rules (the review-content Edge Function).
--
-- Needs, in the live project:
--   * the pg_net extension (Database > Extensions)
--   * two Vault secrets: project_url (https://<ref>.supabase.co) and
--     review_secret (the same value as the Edge Function secret REVIEW_SECRET)
-- Without them the trigger does nothing, so posting never breaks.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

create function private.queue_ai_review() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if new.status <> 'visible' then
    return null;  -- already held by the rules; a moderator will read it
  end if;
  if to_regnamespace('net') is null or to_regnamespace('vault') is null then
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
    into v_url using 'project_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
    into v_secret using 'review_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  -- Only the id travels; the function reads the text itself with the service role.
  execute 'select net.http_post(url := $1, headers := $2, body := $3)'
    using v_url || '/functions/v1/review-content',
          jsonb_build_object('Content-Type', 'application/json', 'x-review-secret', v_secret),
          jsonb_build_object('kind', tg_argv[0], 'id', new.id);
  return null;
end;
$$;

revoke execute on function private.queue_ai_review() from public, anon, authenticated;

create trigger posts_ai_review after insert on public.posts
  for each row execute function private.queue_ai_review('post');
create trigger comments_ai_review after insert on public.comments
  for each row execute function private.queue_ai_review('comment');
