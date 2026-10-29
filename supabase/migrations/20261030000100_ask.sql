-- Miracle AI on the public website (miraclehealth.us/ai). The "ask" server function answers
-- anyone, no account needed. To keep the free chat from being run up, it counts messages:
-- per visitor per ten minutes and per day, and for the whole site per day. A visitor is a
-- key the function makes from their network address with a secret and the date (an HMAC),
-- so it can't be turned back into the address or followed from one day to the next.
-- No message, name or address is stored here or anywhere else. Counts go after two days.

insert into private.settings (key, value, note) values
  ('ask_enabled',           'on',   'Miracle AI on the website: on, or off to pause it'),
  ('ask_per_visitor_10min', '8',    'Messages one visitor can send Miracle AI in ten minutes'),
  ('ask_per_visitor_day',   '40',   'Messages one visitor can send Miracle AI in a day (UTC)'),
  ('ask_per_day',           '1500', 'Messages Miracle AI answers in a day (UTC), everyone together');

create table private.ask_usage (
  bucket text not null check (bucket = 'site' or bucket ~ '^(v10|vd):[0-9a-f]{64}$'),
  slot timestamptz not null,
  n integer not null default 0,
  primary key (bucket, slot)
);
revoke all on private.ask_usage from public, anon, authenticated;

-- Called by the ask function (service role only) before each message. Counts it and says
-- whether it may go ahead: {"ok": true, "left": n} or {"ok": false, "reason": ...} where the
-- reason is burst, visitor_day, site_day or off. A message turned away by the visitor's own
-- limits never counts against the site's.
create function public.ask_take(visitor text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_day timestamptz := date_trunc('day', v_now, 'UTC');
  v_slot timestamptz := to_timestamp(floor(extract(epoch from v_now) / 600) * 600);
  v_n integer;
  v_today integer;
begin
  if coalesce(private.setting('ask_enabled'), 'on') <> 'on' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if visitor is null or visitor !~ '^[0-9a-f]{64}$' then
    raise exception 'A visitor key is 64 lowercase hex characters' using errcode = '22023';
  end if;

  insert into private.ask_usage as u (bucket, slot, n) values ('v10:' || visitor, v_slot, 1)
    on conflict (bucket, slot) do update set n = u.n + 1 returning u.n into v_n;
  if v_n > coalesce(private.setting_int('ask_per_visitor_10min'), 8) then
    return jsonb_build_object('ok', false, 'reason', 'burst');
  end if;

  insert into private.ask_usage as u (bucket, slot, n) values ('vd:' || visitor, v_day, 1)
    on conflict (bucket, slot) do update set n = u.n + 1 returning u.n into v_today;
  if v_today > coalesce(private.setting_int('ask_per_visitor_day'), 40) then
    return jsonb_build_object('ok', false, 'reason', 'visitor_day');
  end if;

  insert into private.ask_usage as u (bucket, slot, n) values ('site', v_day, 1)
    on conflict (bucket, slot) do update set n = u.n + 1 returning u.n into v_n;
  if v_n > coalesce(private.setting_int('ask_per_day'), 1500) then
    return jsonb_build_object('ok', false, 'reason', 'site_day');
  end if;

  -- Now and then, forget counts older than two days
  if random() < 0.02 then
    delete from private.ask_usage where slot < v_now - interval '2 days';
  end if;
  return jsonb_build_object('ok', true, 'left', greatest(coalesce(private.setting_int('ask_per_visitor_day'), 40) - v_today, 0));
end;
$$;

revoke execute on function public.ask_take(text) from public, anon, authenticated;
grant execute on function public.ask_take(text) to service_role;
