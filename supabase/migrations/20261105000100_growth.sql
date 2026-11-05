-- Growth: GLP-1s first, reports public by the author's choice, check-in texts by the member's
-- choice, and the weekly email.

-- ===========================================================================
-- 1. GLP-1s first
-- ===========================================================================
-- The pairs the community fills first lead with the GLP-1s (the biggest group of people taking
-- something, with approved drugs and plenty of "is this normal?"), then BPC-157 for injuries.
delete from public.focus_pairs;
insert into public.focus_pairs (compound_id, use_id, goal, sort)
select v.c, v.u, 10, v.s
from (values ('tirzepatide', 'fat_loss', 1), ('semaglutide', 'fat_loss', 2), ('retatrutide', 'fat_loss', 3),
             ('tirzepatide', 'appetite', 4), ('bpc157', 'injury', 5)) as v (c, u, s)
where exists (select 1 from public.compounds c where c.id = v.c)
  and exists (select 1 from public.signal_uses u where u.id = v.u);

-- ===========================================================================
-- 2. A report can be public, if its author chooses
-- ===========================================================================
-- Posts stay members-only. The author of a report (not a question) can make it public: then
-- its title, words, handle, what it was about and how it went appear on a page anyone can read
-- (community.miraclehealth.us/r/..., made from private.public_reports() when the site is
-- built). Comments never do. Taking it back, a hold, a removal or deleting the account takes it
-- off at the next build.
alter table public.posts add column public_at timestamptz;

create function private.set_post_public(p_post uuid, p_public boolean) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_post public.posts;
  v_at timestamptz;
begin
  select * into v_post from public.posts where id = p_post;
  if v_post.id is null or v_post.author_id is distinct from (select auth.uid()) then
    raise exception 'Only the author can choose who sees a report.' using errcode = '42501';
  end if;
  if v_post.kind <> 'experience' then
    raise exception 'Only reports can be public, not questions.';
  end if;
  if p_public and v_post.status <> 'visible' then
    raise exception 'A post that’s held or removed can’t be public.';
  end if;
  update public.posts
     set public_at = case when p_public then coalesce(public_at, now()) else null end
   where id = p_post
  returning public_at into v_at;
  return v_at;
end;
$$;
create function public.set_post_public(post_id uuid, make_public boolean) returns timestamptz
language sql security invoker set search_path = ''
as $$ select private.set_post_public(post_id, make_public) $$;

-- For the site build only (run as the owner): the public reports, newest first
create function private.public_reports() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb)
  from (
    select p.created_at as at,
           jsonb_build_object(
             'id', p.id, 'title', p.title, 'body', p.body, 'at', p.created_at, 'edited_at', p.edited_at,
             'handle', a.handle, 'compound', p.compound_id, 'compound_name', c.name,
             'outcome', r.outcome, 'duration', r.duration) as j
    from public.posts p
    join public.profiles a on a.id = p.author_id
    join public.compounds c on c.id = p.compound_id
    left join public.post_reads r on r.post_id = p.id
    where p.public_at is not null and p.status = 'visible' and p.kind = 'experience'
      and a.status = 'active'
    order by p.created_at desc
    limit 5000
  ) x;
$$;

-- ===========================================================================
-- 3. Check-in texts, if the member asks for them
-- ===========================================================================
-- A text when a check-in on one of their reports is due (2, 6 and 12 weeks after it), to the
-- number they sign in with. Off unless they turn it on; replying STOP turns it off. The text
-- never names the compound. The send-texts function sends them, between 9am and 8pm in the
-- member's own time zone, at most one a day.
create table private.text_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  texts_on boolean not null default false,
  tz text not null default 'America/Los_Angeles' check (char_length(tz) between 3 and 60),
  opted_at timestamptz,
  stopped_at timestamptz
);
create table private.texts_sent (
  post_id uuid not null references public.posts (id) on delete cascade,
  week smallint not null check (week in (2, 6, 12)),
  user_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (post_id, week)
);
create index texts_sent_user_idx on private.texts_sent (user_id, sent_at desc);
revoke all on private.text_prefs, private.texts_sent from public, anon, authenticated;

create function private.set_checkin_texts(p_on boolean, p_tz text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_tz text := coalesce(nullif(left(p_tz, 60), ''), 'America/Los_Angeles');
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    v_tz := 'America/Los_Angeles';
  end if;
  insert into private.text_prefs as t (user_id, texts_on, tz, opted_at, stopped_at)
  values (v_me, p_on, v_tz, case when p_on then now() end, case when p_on then null else now() end)
  on conflict (user_id) do update
    set texts_on = excluded.texts_on, tz = excluded.tz,
        opted_at = case when excluded.texts_on then now() else t.opted_at end,
        stopped_at = case when excluded.texts_on then null else now() end;
  return jsonb_build_object('on', p_on, 'tz', v_tz);
end;
$$;
create function public.set_checkin_texts(turn_on boolean, tz text) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.set_checkin_texts(turn_on, tz) $$;

create function private.my_checkin_texts() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((select jsonb_build_object('on', t.texts_on, 'tz', t.tz) from private.text_prefs t
                   where t.user_id = (select auth.uid())), jsonb_build_object('on', false))
$$;
create function public.my_checkin_texts() returns jsonb
language sql security invoker set search_path = ''
as $$ select private.my_checkin_texts() $$;

-- For the send-texts function (service role only): who has a check-in due and hasn't had a
-- text for it, at most one per member, none to anyone texted in the last 20 hours
create function public.texts_due(max_rows integer default 200)
returns table (user_id uuid, post_id uuid, week smallint, tz text)
language sql stable security definer set search_path = ''
as $$
  select distinct on (d.user_id) d.user_id, d.post_id, d.week, d.tz
  from (
    select p.author_id as user_id, p.id as post_id, private.checkin_due(p.id) as week, t.tz, p.created_at
    from public.posts p
    join private.text_prefs t on t.user_id = p.author_id and t.texts_on
    join public.profiles a on a.id = p.author_id and a.status = 'active'
    where p.kind = 'experience' and p.status = 'visible' and p.created_at > now() - interval '20 weeks'
  ) d
  where d.week is not null
    and not exists (select 1 from private.texts_sent s where s.post_id = d.post_id and s.week = d.week)
    and not exists (select 1 from private.texts_sent s where s.user_id = d.user_id and s.sent_at > now() - interval '20 hours')
  order by d.user_id, d.created_at
  limit greatest(1, least(coalesce(max_rows, 200), 1000))
$$;
create function public.text_sent(post_id uuid, week smallint) returns void
language sql security definer set search_path = ''
as $$
  insert into private.texts_sent (post_id, week, user_id)
  select p.id, text_sent.week, p.author_id from public.posts p where p.id = text_sent.post_id
  on conflict do nothing
$$;
create function public.text_stopped(user_id uuid) returns void
language sql security definer set search_path = ''
as $$ update private.text_prefs set texts_on = false, stopped_at = now() where text_prefs.user_id = text_stopped.user_id $$;

-- ===========================================================================
-- 4. The weekly email
-- ===========================================================================
-- An address someone gives on miraclehealth.us, kept until they unsubscribe (then kept only so
-- it's never emailed again). Nothing is sent until they confirm it from the email we send
-- (double opt-in); an address not confirmed 30 days after that email goes. At most 5 sign-ups
-- a day from one connection, counted under the same daily key as Miracle AI's chat (the address
-- itself is never stored), and 300 new ones a day in all.
create table private.newsletter (
  id bigint generated always as identity primary key,
  email text not null check (char_length(email) between 6 and 254 and email ~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$'),
  source text check (char_length(source) <= 40),
  created_at timestamptz not null default now(),
  confirm_token uuid not null default gen_random_uuid(),
  confirmed_at timestamptz,
  unsub_token uuid not null default gen_random_uuid(),
  unsubscribed_at timestamptz,
  asked_at timestamptz,                -- when the confirmation email went
  last_issue integer not null default 0
);
create unique index newsletter_email_idx on private.newsletter (lower(email));
create table private.newsletter_hits (
  key text not null,
  day date not null,
  n integer not null default 0,
  primary key (key, day)
);
revoke all on private.newsletter, private.newsletter_hits from public, anon, authenticated;

create function public.newsletter_add(email text, source text, address text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_secret bytea;
  v_key text;
  v_n integer;
  v_row private.newsletter;
  v_email text := lower(btrim(coalesce(newsletter_add.email, '')));
begin
  if char_length(v_email) not between 6 and 254 or v_email !~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' then
    return jsonb_build_object('ok', false, 'why', 'email');
  end if;
  select s.secret into v_secret from private.ask_secrets s where s.day = v_day;
  if v_secret is null then
    insert into private.ask_secrets (day, secret) values (v_day, extensions.gen_random_bytes(32))
      on conflict (day) do nothing;
    select s.secret into v_secret from private.ask_secrets s where s.day = v_day;
  end if;
  v_key := encode(extensions.hmac(convert_to(coalesce(nullif(left(address, 80), ''), 'unknown'), 'UTF8'), v_secret, 'sha256'), 'hex');
  delete from private.newsletter_hits where day < v_day - 1;
  -- Unconfirmed 30 days after the confirmation email went (or, if email was never set up, after
  -- 180 days) goes
  delete from private.newsletter
   where confirmed_at is null and unsubscribed_at is null
     and (asked_at < now() - interval '30 days' or (asked_at is null and created_at < now() - interval '180 days'));
  insert into private.newsletter_hits as hh (key, day, n) values (v_key, v_day, 1)
  on conflict (key, day) do update set n = hh.n + 1
  returning n into v_n;
  if v_n > 5 then
    return jsonb_build_object('ok', false, 'why', 'limit');
  end if;
  select * into v_row from private.newsletter where lower(newsletter.email) = v_email;
  if v_row.id is null then
    if (select count(*) from private.newsletter where created_at > now() - interval '1 day') >= 300 then
      return jsonb_build_object('ok', false, 'why', 'busy');
    end if;
    insert into private.newsletter (email, source) values (v_email, left(newsletter_add.source, 40))
    returning * into v_row;
    return jsonb_build_object('ok', true, 'state', 'new', 'id', v_row.id, 'token', v_row.confirm_token, 'unsub', v_row.unsub_token);
  end if;
  if v_row.confirmed_at is not null and v_row.unsubscribed_at is null then
    return jsonb_build_object('ok', true, 'state', 'confirmed');
  end if;
  -- Back after unsubscribing, or never confirmed: confirm again
  update private.newsletter set unsubscribed_at = null, confirmed_at = null, asked_at = null, confirm_token = gen_random_uuid()
   where id = v_row.id returning * into v_row;
  return jsonb_build_object('ok', true, 'state', 'pending', 'id', v_row.id, 'token', v_row.confirm_token, 'unsub', v_row.unsub_token);
end;
$$;
create function public.newsletter_confirm(token uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update private.newsletter set confirmed_at = coalesce(confirmed_at, now())
   where confirm_token = newsletter_confirm.token and unsubscribed_at is null;
  return found;
end;
$$;
create function public.newsletter_unsubscribe(token uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update private.newsletter set unsubscribed_at = coalesce(unsubscribed_at, now())
   where unsub_token = newsletter_unsubscribe.token;
  return found;
end;
$$;
create function public.newsletter_due(issue integer, max_rows integer default 100)
returns table (id bigint, email text, unsub_token uuid)
language sql stable security definer set search_path = ''
as $$
  select n.id, n.email, n.unsub_token from private.newsletter n
  where n.confirmed_at is not null and n.unsubscribed_at is null and n.last_issue < newsletter_due.issue
  order by n.id
  limit greatest(1, least(coalesce(max_rows, 100), 100))
$$;
create function public.newsletter_sent(ids bigint[], issue integer) returns void
language sql security definer set search_path = ''
as $$ update private.newsletter set last_issue = greatest(last_issue, newsletter_sent.issue) where id = any (newsletter_sent.ids) $$;
-- Confirmation emails not sent yet (sign-ups from before an email provider was set up)
create function public.newsletter_pending(max_rows integer default 100)
returns table (id bigint, email text, confirm_token uuid, unsub_token uuid)
language sql stable security definer set search_path = ''
as $$
  select n.id, n.email, n.confirm_token, n.unsub_token from private.newsletter n
  where n.confirmed_at is null and n.unsubscribed_at is null and n.asked_at is null
  order by n.id
  limit greatest(1, least(coalesce(max_rows, 100), 100))
$$;
create function public.newsletter_asked(ids bigint[]) returns void
language sql security definer set search_path = ''
as $$ update private.newsletter set asked_at = now() where id = any (newsletter_asked.ids) $$;
create function public.newsletter_counts() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'confirmed', count(*) filter (where confirmed_at is not null and unsubscribed_at is null),
    'pending', count(*) filter (where confirmed_at is null and unsubscribed_at is null),
    'unsubscribed', count(*) filter (where unsubscribed_at is not null))
  from private.newsletter
$$;

-- ===========================================================================
-- 5. The first 100 reporters
-- ===========================================================================
-- The first 100 members whose first-hand report counts in the Signal are founding reporters,
-- with a badge for good (miraclehealth.us/founders). By when their first counted report was read,
-- so a reporter's place never changes. The site's snapshot shows how many spots are taken.
insert into public.badges (key, name, description, sort) values
  ('founder100', 'Founding reporter', 'One of the first 100 members to share a first-hand report', 0)
on conflict (key) do update set name = excluded.name, description = excluded.description, sort = excluded.sort;

create or replace function private.check_badges(p_uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_badge text;
  s public.seasons;
begin
  if p_uid is null or not exists (select 1 from public.profiles where id = p_uid) then
    return;
  end if;
  select * into s from public.seasons where n = 1;
  for v_badge in
    with mine as (
      select r.post_id, r.compound_id, r.duration, r.confirmed_at, r.read_at, p.created_at
      from public.post_reads r
      join public.posts p on p.id = r.post_id
      where p.author_id = p_uid and r.counts and p.status = 'visible'
    )
    select t.b from (values
      ('first_report', exists (select 1 from mine)),
      ('founder100', exists (select 1 from mine) and (
        select count(distinct p2.author_id)
        from public.post_reads r2 join public.posts p2 on p2.id = r2.post_id
        where r2.counts and p2.status = 'visible' and p2.author_id <> p_uid
          and r2.read_at < (select min(m.read_at) from mine m)) < 100),
      ('specific', (select count(*) from mine where duration is not null) >= 3),
      ('receipts', (select count(*) from mine where confirmed_at is not null) >= 3),
      ('replicator', (select count(*) from public.same_for_me x where x.user_id = p_uid) >= 10),
      ('voice', (select count(*) from public.comments c where c.author_id = p_uid and c.status = 'visible') >= 5),
      ('streak7', coalesce((select ms.best_streak from public.member_scores ms where ms.user_id = p_uid), 0) >= 7),
      ('season1', (select count(*) from mine where created_at >= s.starts and created_at < s.ends + 1) >= coalesce(s.badge_reports, 3)),
      ('pioneer', exists (
        select 1 from mine m
        where not exists (
          select 1 from public.post_reads r2 join public.posts p2 on p2.id = r2.post_id
          where r2.compound_id = m.compound_id and r2.counts and p2.status = 'visible'
            and p2.author_id <> p_uid and r2.read_at < m.read_at)))
    ) as t(b, ok)
    where t.ok
  loop
    perform private.give_badge(p_uid, v_badge);
  end loop;
end;
$$;

-- Anyone who already has a counted report gets their place
do $$
declare
  v uuid;
begin
  for v in select p.author_id from public.post_reads r join public.posts p on p.id = r.post_id
           where r.counts and p.status = 'visible' group by p.author_id order by min(r.read_at) loop
    perform private.check_badges(v);
  end loop;
end $$;

-- For the site's snapshot (run as the owner): how many of the 100 spots are taken
create function private.founding_progress() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('goal', 100, 'taken', least(100, (select count(*) from public.member_badges where badge = 'founder100')))
$$;

-- ===========================================================================
-- Privileges
-- ===========================================================================
revoke execute on function
  private.founding_progress(),
  private.set_post_public(uuid, boolean), public.set_post_public(uuid, boolean), private.public_reports(),
  private.set_checkin_texts(boolean, text), public.set_checkin_texts(boolean, text),
  private.my_checkin_texts(), public.my_checkin_texts(),
  public.texts_due(integer), public.text_sent(uuid, smallint), public.text_stopped(uuid),
  public.newsletter_add(text, text, text), public.newsletter_confirm(uuid), public.newsletter_unsubscribe(uuid),
  public.newsletter_due(integer, integer), public.newsletter_sent(bigint[], integer), public.newsletter_counts(),
  public.newsletter_pending(integer), public.newsletter_asked(bigint[])
  from public, anon, authenticated;
grant execute on function
  private.set_post_public(uuid, boolean), public.set_post_public(uuid, boolean),
  private.set_checkin_texts(boolean, text), public.set_checkin_texts(boolean, text),
  private.my_checkin_texts(), public.my_checkin_texts()
  to authenticated;
grant execute on function
  public.texts_due(integer), public.text_sent(uuid, smallint), public.text_stopped(uuid),
  public.newsletter_add(text, text, text), public.newsletter_confirm(uuid), public.newsletter_unsubscribe(uuid),
  public.newsletter_due(integer, integer), public.newsletter_sent(bigint[], integer), public.newsletter_counts(),
  public.newsletter_pending(integer), public.newsletter_asked(bigint[])
  to service_role;
