-- Miracle AI's chat: the key a visitor is counted under is now made here, in the database,
-- with a random secret that changes every day and is thrown away after two days. Without the
-- secret nobody, not even with the project's own keys, can turn a count back into an address
-- or follow a visitor from one day to the next. The address itself is never stored.
-- Old secrets and counts go on the first message of each day, whether the chat is paused or not.

create table private.ask_secrets (
  day date primary key,
  secret bytea not null
);
revoke all on private.ask_secrets from public, anon, authenticated;

-- Called by the ask function (service role only) before each message, with the visitor's
-- network address (an IPv6 address cut to its /64 network). Counts the message under today's
-- key and answers as public.ask_take does.
create function public.ask_count(address text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_secret bytea;
begin
  select s.secret into v_secret from private.ask_secrets s where s.day = v_day;
  if v_secret is null then
    insert into private.ask_secrets (day, secret) values (v_day, extensions.gen_random_bytes(32))
      on conflict (day) do nothing;
    select s.secret into v_secret from private.ask_secrets s where s.day = v_day;
    delete from private.ask_secrets where day < v_day - 1;
    delete from private.ask_usage where slot < now() - interval '2 days';
  end if;
  return public.ask_take(encode(extensions.hmac(convert_to(coalesce(nullif(left(address, 80), ''), 'unknown'), 'UTF8'), v_secret, 'sha256'), 'hex'));
end;
$$;

revoke execute on function public.ask_count(text) from public, anon, authenticated;
grant execute on function public.ask_count(text) to service_role;
