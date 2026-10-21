-- Miracle Health community: foundation
-- Accounts (a profile on top of Supabase Auth), invites, posts, comments, votes,
-- reports, moderation and the checks that run on every post.
--
-- Security, in three layers:
--   1. Privileges: members get only the columns and actions they need.
--      They can never write a post's status, score or author.
--   2. Row Level Security on every table decides which rows each person can
--      see or change.
--   3. Privileged steps live in the "private" schema, which the API does not
--      expose. Each one checks who is calling before it does anything.

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('member', 'moderator', 'admin');
create type public.member_status as enum ('active', 'suspended', 'banned');
create type public.content_status as enum ('visible', 'held', 'removed');
create type public.post_kind as enum ('experience', 'question');
create type public.report_reason as enum (
  'sourcing', 'dosing', 'medical_misinfo', 'harassment', 'spam',
  'underage', 'personal_info', 'self_harm', 'off_topic', 'other'
);
create type public.report_status as enum ('open', 'actioned', 'dismissed');
create type public.target_kind as enum ('post', 'comment', 'member');
create type public.mod_action as enum (
  'hold', 'remove', 'restore', 'dismiss', 'warn', 'suspend', 'ban', 'unban'
);

-- ---------------------------------------------------------------------------
-- Settings the moderators can tune without a code change (private, not in the API)
-- ---------------------------------------------------------------------------
create table private.settings (
  key text primary key,
  value text not null,
  note text not null
);
revoke all on private.settings from public, anon, authenticated;

insert into private.settings (key, value, note) values
  ('rules_version',        '2026-10-21', 'Members accept this version of the rules at sign-up'),
  ('new_account_days',     '7',   'Accounts younger than this (and not trusted) are new'),
  ('posts_per_day_new',    '3',   'Posts a new member can start in 24 hours'),
  ('posts_per_day',        '10',  'Posts any other member can start in 24 hours'),
  ('comments_per_day_new', '20',  'Comments a new member can write in 24 hours'),
  ('comments_per_day',     '100', 'Comments any other member can write in 24 hours'),
  ('votes_per_hour',       '120', 'Votes anyone can cast in an hour'),
  ('reports_per_day',      '20',  'Reports anyone can file in 24 hours'),
  ('auto_hold_reports',    '3',   'Open reports from different established members that hold a post or comment for review'),
  ('pileon_window_hours',  '24',  'Window for spotting new accounts piling onto one compound'),
  ('pileon_min_accounts',  '8',   'New accounts active on one compound in the window before an alert'),
  ('pileon_share_pct',     '70',  'Share of that compound''s activity from new accounts before an alert');

create function private.setting(p_key text) returns text
language sql stable security definer set search_path = ''
as $$ select s.value from private.settings s where s.key = p_key $$;

create function private.setting_int(p_key text) returns integer
language sql stable security definer set search_path = ''
as $$ select s.value::integer from private.settings s where s.key = p_key $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.compounds (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  category text not null default 'Other',
  created_at timestamptz not null default now()
);

create table public.invites (
  code text primary key
    default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
    check (code ~ '^[A-Z0-9]{6,40}$'),
  note text check (char_length(note) <= 200),
  trusted boolean not null default false,
  max_uses integer not null default 1 check (max_uses between 1 and 500),
  uses integer not null default 0 check (uses >= 0),
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null check (handle ~ '^[A-Za-z0-9_]{3,20}$'),
  role public.member_role not null default 'member',
  status public.member_status not null default 'active',
  suspended_until timestamptz,
  trusted boolean not null default false,
  adult_confirmed_at timestamptz not null,
  rules_version text not null,
  rules_accepted_at timestamptz not null default now(),
  health_data_consent_at timestamptz not null,
  invite_code text references public.invites (code) on delete set null,
  created_at timestamptz not null default now()
);
create unique index profiles_handle_unique on public.profiles (lower(handle));
create index profiles_invite_code_idx on public.profiles (invite_code);

alter table public.invites
  add constraint invites_created_by_fkey foreign key (created_by)
  references public.profiles (id) on delete set null;
create index invites_created_by_idx on public.invites (created_by);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  compound_id text not null references public.compounds (id),
  kind public.post_kind not null default 'experience',
  title text not null check (char_length(title) between 5 and 140),
  body text not null check (char_length(body) between 1 and 10000),
  status public.content_status not null default 'visible',
  status_reason text,
  score integer not null default 0,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index posts_feed_idx on public.posts (created_at desc) where status = 'visible';
create index posts_author_idx on public.posts (author_id, created_at desc);
create index posts_compound_idx on public.posts (compound_id, created_at desc);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  status public.content_status not null default 'visible',
  status_reason text,
  score integer not null default 0,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index comments_post_idx on public.comments (post_id, created_at);
create index comments_author_idx on public.comments (author_id, created_at desc);

create table public.post_votes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_votes_user_idx on public.post_votes (user_id, created_at desc);

create table public.comment_votes (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index comment_votes_user_idx on public.comment_votes (user_id, created_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid default auth.uid() references public.profiles (id) on delete set null,
  target_kind public.target_kind not null,
  target_id uuid not null,
  reason public.report_reason not null,
  note text check (char_length(note) <= 500),
  status public.report_status not null default 'open',
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reporter_id, target_kind, target_id)
);
create index reports_open_idx on public.reports (target_kind, target_id) where status = 'open';
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index reports_resolved_by_idx on public.reports (resolved_by);

create table public.moderation_actions (
  id bigint generated always as identity primary key,
  moderator_id uuid references public.profiles (id) on delete set null,
  actor text not null default 'moderator' check (actor in ('moderator', 'rules', 'ai')),
  action public.mod_action not null,
  target_kind public.target_kind not null,
  target_id uuid not null,
  reason text not null,
  note text,
  created_at timestamptz not null default now()
);
create index moderation_actions_target_idx on public.moderation_actions (target_kind, target_id);
create index moderation_actions_moderator_idx on public.moderation_actions (moderator_id);

create table public.ai_reviews (
  id bigint generated always as identity primary key,
  target_kind public.target_kind not null check (target_kind in ('post', 'comment')),
  target_id uuid not null,
  model text not null,
  verdict text not null check (verdict in ('ok', 'hold')),
  categories text[] not null default '{}',
  explanation text,
  created_at timestamptz not null default now()
);
create index ai_reviews_target_idx on public.ai_reviews (target_kind, target_id);

-- Words and phrases moderators watch for. "block" refuses the post with the
-- rule that applies; "hold" sends it to the moderation queue.
create table public.watch_terms (
  id bigint generated always as identity primary key,
  term text not null check (char_length(term) between 2 and 100),
  action text not null default 'hold' check (action in ('block', 'hold')),
  reason public.report_reason not null default 'sourcing',
  note text,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index watch_terms_term_unique on public.watch_terms (lower(term));
create index watch_terms_created_by_idx on public.watch_terms (created_by);

-- Sites members may link to without review (studies, regulators).
create table public.link_domains (
  domain text primary key check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  note text,
  created_at timestamptz not null default now()
);

create table public.signal_alerts (
  id bigint generated always as identity primary key,
  compound_id text not null references public.compounds (id),
  kind text not null default 'new_account_pileon',
  new_accounts integer not null,
  events integer not null,
  new_account_events integer not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status text not null default 'open' check (status in ('open', 'reviewed')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index signal_alerts_compound_idx on public.signal_alerts (compound_id, created_at desc);
create index signal_alerts_reviewed_by_idx on public.signal_alerts (reviewed_by);

-- ---------------------------------------------------------------------------
-- Helpers used by the access rules (private, security definer so they can read
-- profiles without tripping over profiles' own access rules)
-- ---------------------------------------------------------------------------
create function private.can_read() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status <> 'banned'
  );
$$;

create function private.can_write() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and (p.status = 'active'
           or (p.status = 'suspended' and p.suspended_until is not null and p.suspended_until <= now()))
  );
$$;

create function private.is_moderator() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('moderator', 'admin')
      and p.status = 'active'
  );
$$;

create function private.is_new_member(p_uid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select not p.trusted
       and p.created_at > now() - make_interval(days => private.setting_int('new_account_days'))
    from public.profiles p where p.id = p_uid
  ), true);
$$;

create function private.regex_escape(p_text text) returns text
language sql immutable set search_path = ''
as $$ select regexp_replace(p_text, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') $$;

-- ---------------------------------------------------------------------------
-- The check every post, comment and edit goes through
--   block: refused at once, with the rule that applies
--   hold:  saved, but only the author and moderators see it until reviewed
-- ---------------------------------------------------------------------------
create function private.check_text(
  p_text text,
  p_new_member boolean,
  out verdict text,
  out reason public.report_reason,
  out message text
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_text text := lower(coalesce(p_text, ''));
  v_term record;
  v_hosts text[];
  v_host text;
begin
  verdict := 'ok';

  -- 1. Watched words and phrases
  for v_term in
    select w.term, w.action, w.reason from public.watch_terms w
    order by (w.action = 'block') desc, w.id
  loop
    if v_text ~ ('(^|[^a-z0-9])' || private.regex_escape(lower(v_term.term)) || '($|[^a-z0-9])') then
      if v_term.action = 'block' then
        verdict := 'block';
        reason := v_term.reason;
        message := case v_term.reason
          when 'sourcing' then 'Asking or telling where to buy isn''t allowed here (rule 1). Nothing was posted; edit it and try again.'
          when 'dosing'   then 'Telling other people what dose to take isn''t allowed here (rule 2). Share what you did instead.'
          else 'This breaks the community rules, so nothing was posted.'
        end;
        return;
      elsif verdict = 'ok' then
        verdict := 'hold';
        reason := v_term.reason;
        message := 'Held for a moderator (watched term: ' || v_term.term || ')';
      end if;
    end if;
  end loop;

  -- 2. Links: every web address or bare domain in the text
  select array_agg(distinct regexp_replace(m[1], '^www\.', ''))
    into v_hosts
  from (
    select regexp_matches(v_text, '(?:https?://|www\.)([a-z0-9-]+(?:\.[a-z0-9-]+)+)', 'g') as m
    union all
    select regexp_matches(
      v_text,
      '(?:^|[^a-z0-9@./-])((?:[a-z0-9-]+\.)+(?:com|net|org|io|co|shop|store|us|uk|ca|ru|cn|xyz|biz|info|me|ly|gg|app|to|link|site|online|pro|bio|health|club|vip|eu|de|au|in))(?=$|[^a-z0-9-])',
      'g') as m
  ) found;

  if v_hosts is not null then
    foreach v_host in array v_hosts loop
      if not exists (
        select 1 from public.link_domains d
        where v_host = d.domain or v_host like '%.' || d.domain
      ) then
        if p_new_member then
          verdict := 'block';
          reason := 'spam';
          message := 'In your first week you can link only to studies and health agencies (rule 6). Nothing was posted; take the link out and try again.';
          return;
        elsif verdict = 'ok' then
          verdict := 'hold';
          reason := 'spam';
          message := 'Held for a moderator (link to ' || v_host || ')';
        end if;
      end if;
    end loop;
  end if;

  -- 3. Contact details move deals off the platform
  if verdict = 'ok' and (
       v_text ~ '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}'
    or v_text ~ '(^|[^0-9])\(?[0-9]{3}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}($|[^0-9])'
  ) then
    verdict := 'hold';
    reason := 'personal_info';
    message := 'Held for a moderator (contact details)';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers on posts
-- ---------------------------------------------------------------------------
create function private.posts_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prof public.profiles;
  v_new boolean;
  v_count integer;
  v_limit integer;
  v_check record;
begin
  if v_uid is null then
    -- No member token: the database owner or the service role (seeding, admin tools)
    if coalesce((select auth.role()), '') in ('', 'service_role') then
      return new;
    end if;
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select * into v_prof from public.profiles where id = v_uid;
  if not found then
    raise exception 'Finish signing up first.' using errcode = '42501';
  end if;

  -- Fields members never set themselves
  new.author_id := v_uid;
  new.status := 'visible';
  new.status_reason := null;
  new.score := 0;
  new.created_at := now();
  new.edited_at := null;

  v_new := private.is_new_member(v_uid);
  v_limit := private.setting_int(case when v_new then 'posts_per_day_new' else 'posts_per_day' end);
  select count(*) into v_count from public.posts
  where author_id = v_uid and created_at > now() - interval '24 hours';
  if v_count >= v_limit then
    raise exception 'You can start % posts a day%. Try again tomorrow.',
      v_limit, case when v_new then ' in your first week' else '' end
      using errcode = 'P0001', hint = 'rate_limit';
  end if;

  select * into v_check from private.check_text(new.title || E'\n' || new.body, v_new);
  if v_check.verdict = 'block' then
    raise exception '%', v_check.message using errcode = 'P0001', hint = 'blocked_' || v_check.reason;
  elsif v_check.verdict = 'hold' then
    new.status := 'held';
    new.status_reason := v_check.message;
  end if;
  return new;
end;
$$;

create function private.posts_before_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_check record;
begin
  if new.title is distinct from old.title or new.body is distinct from old.body then
    if old.status = 'removed' then
      raise exception 'Removed posts can''t be edited.' using errcode = 'P0001';
    end if;
    select * into v_check
    from private.check_text(new.title || E'\n' || new.body, private.is_new_member(old.author_id));
    if v_check.verdict = 'block' then
      raise exception '%', v_check.message using errcode = 'P0001', hint = 'blocked_' || v_check.reason;
    elsif v_check.verdict = 'hold' and old.status = 'visible' then
      new.status := 'held';
      new.status_reason := v_check.message;
      insert into public.moderation_actions (moderator_id, actor, action, target_kind, target_id, reason)
      values (null, 'rules', 'hold', 'post', old.id, v_check.message);
    end if;
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create function private.content_after_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'held' then
    insert into public.moderation_actions (moderator_id, actor, action, target_kind, target_id, reason)
    values (null, 'rules', 'hold', tg_argv[0]::public.target_kind, new.id, coalesce(new.status_reason, 'rules'));
  end if;
  return null;
end;
$$;

create trigger posts_before_insert before insert on public.posts
  for each row execute function private.posts_before_insert();
create trigger posts_before_update before update on public.posts
  for each row execute function private.posts_before_update();
create trigger posts_after_insert after insert on public.posts
  for each row execute function private.content_after_insert('post');

-- ---------------------------------------------------------------------------
-- Triggers on comments
-- ---------------------------------------------------------------------------
create function private.comments_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_new boolean;
  v_count integer;
  v_limit integer;
  v_check record;
begin
  if v_uid is null then
    -- No member token: the database owner or the service role (seeding, admin tools)
    if coalesce((select auth.role()), '') in ('', 'service_role') then
      return new;
    end if;
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Finish signing up first.' using errcode = '42501';
  end if;

  new.author_id := v_uid;
  new.status := 'visible';
  new.status_reason := null;
  new.score := 0;
  new.created_at := now();
  new.edited_at := null;

  v_new := private.is_new_member(v_uid);
  v_limit := private.setting_int(case when v_new then 'comments_per_day_new' else 'comments_per_day' end);
  select count(*) into v_count from public.comments
  where author_id = v_uid and created_at > now() - interval '24 hours';
  if v_count >= v_limit then
    raise exception 'You can write % comments a day%. Try again tomorrow.',
      v_limit, case when v_new then ' in your first week' else '' end
      using errcode = 'P0001', hint = 'rate_limit';
  end if;

  select * into v_check from private.check_text(new.body, v_new);
  if v_check.verdict = 'block' then
    raise exception '%', v_check.message using errcode = 'P0001', hint = 'blocked_' || v_check.reason;
  elsif v_check.verdict = 'hold' then
    new.status := 'held';
    new.status_reason := v_check.message;
  end if;
  return new;
end;
$$;

create function private.comments_before_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_check record;
begin
  if new.body is distinct from old.body then
    if old.status = 'removed' then
      raise exception 'Removed comments can''t be edited.' using errcode = 'P0001';
    end if;
    select * into v_check from private.check_text(new.body, private.is_new_member(old.author_id));
    if v_check.verdict = 'block' then
      raise exception '%', v_check.message using errcode = 'P0001', hint = 'blocked_' || v_check.reason;
    elsif v_check.verdict = 'hold' and old.status = 'visible' then
      new.status := 'held';
      new.status_reason := v_check.message;
      insert into public.moderation_actions (moderator_id, actor, action, target_kind, target_id, reason)
      values (null, 'rules', 'hold', 'comment', old.id, v_check.message);
    end if;
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger comments_before_insert before insert on public.comments
  for each row execute function private.comments_before_insert();
create trigger comments_before_update before update on public.comments
  for each row execute function private.comments_before_update();
create trigger comments_after_insert after insert on public.comments
  for each row execute function private.content_after_insert('comment');

-- ---------------------------------------------------------------------------
-- Votes: hourly limit, and the score kept on each post and comment
-- ---------------------------------------------------------------------------
create function private.votes_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then
    return new;  -- service role
  end if;
  new.user_id := v_uid;
  new.created_at := now();
  select (select count(*) from public.post_votes where user_id = v_uid and created_at > now() - interval '1 hour')
       + (select count(*) from public.comment_votes where user_id = v_uid and created_at > now() - interval '1 hour')
    into v_count;
  if v_count >= private.setting_int('votes_per_hour') then
    raise exception 'That''s a lot of votes for one hour. Try again later.'
      using errcode = 'P0001', hint = 'rate_limit';
  end if;
  return new;
end;
$$;

create function private.post_votes_score() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set score = score + new.value where id = new.post_id;
  elsif tg_op = 'UPDATE' then
    update public.posts set score = score + new.value - old.value where id = new.post_id;
  else
    update public.posts set score = score - old.value where id = old.post_id;
  end if;
  return null;
end;
$$;

create function private.comment_votes_score() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.comments set score = score + new.value where id = new.comment_id;
  elsif tg_op = 'UPDATE' then
    update public.comments set score = score + new.value - old.value where id = new.comment_id;
  else
    update public.comments set score = score - old.value where id = old.comment_id;
  end if;
  return null;
end;
$$;

create trigger post_votes_before_insert before insert on public.post_votes
  for each row execute function private.votes_before_insert();
create trigger comment_votes_before_insert before insert on public.comment_votes
  for each row execute function private.votes_before_insert();
create trigger post_votes_score after insert or update or delete on public.post_votes
  for each row execute function private.post_votes_score();
create trigger comment_votes_score after insert or update or delete on public.comment_votes
  for each row execute function private.comment_votes_score();

-- ---------------------------------------------------------------------------
-- New accounts piling onto one compound: raise an alert for moderators
-- ---------------------------------------------------------------------------
create function private.check_pileon(p_compound text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_window interval := make_interval(hours => private.setting_int('pileon_window_hours'));
  v_new_days integer := private.setting_int('new_account_days');
  v_new integer;
  v_events integer;
  v_new_events integer;
begin
  if p_compound is null then
    return;
  end if;
  with activity as (
    select p.author_id as uid from public.posts p
    where p.compound_id = p_compound and p.created_at > now() - v_window
    union all
    select v.user_id from public.post_votes v
    join public.posts p on p.id = v.post_id
    where p.compound_id = p_compound and v.created_at > now() - v_window
  ), marked as (
    select a.uid,
           (not pr.trusted and pr.created_at > now() - make_interval(days => v_new_days)) as is_new
    from activity a join public.profiles pr on pr.id = a.uid
  )
  select count(distinct uid) filter (where is_new), count(*), count(*) filter (where is_new)
    into v_new, v_events, v_new_events
  from marked;

  if v_new >= private.setting_int('pileon_min_accounts')
     and v_events > 0
     and v_new_events * 100 >= v_events * private.setting_int('pileon_share_pct')
     and not exists (
       select 1 from public.signal_alerts s
       where s.compound_id = p_compound and s.status = 'open' and s.created_at > now() - v_window
     ) then
    insert into public.signal_alerts
      (compound_id, new_accounts, events, new_account_events, window_start, window_end)
    values (p_compound, v_new, v_events, v_new_events, now() - v_window, now());
  end if;
end;
$$;

create function private.posts_after_insert_pileon() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.check_pileon(new.compound_id);
  return null;
end;
$$;

create function private.post_votes_after_insert_pileon() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.check_pileon((select p.compound_id from public.posts p where p.id = new.post_id));
  return null;
end;
$$;

create trigger posts_pileon after insert on public.posts
  for each row execute function private.posts_after_insert_pileon();
create trigger post_votes_pileon after insert on public.post_votes
  for each row execute function private.post_votes_after_insert_pileon();

-- ---------------------------------------------------------------------------
-- Reports: daily limit, only things you can see, and auto-hold at 3 reports
-- ---------------------------------------------------------------------------
create function private.reports_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
  v_ok boolean;
begin
  if v_uid is null then
    return new;  -- service role
  end if;
  new.reporter_id := v_uid;
  new.status := 'open';
  new.resolved_by := null;
  new.resolved_at := null;
  new.created_at := now();

  select count(*) into v_count from public.reports
  where reporter_id = v_uid and created_at > now() - interval '24 hours';
  if v_count >= private.setting_int('reports_per_day') then
    raise exception 'You''ve filed a lot of reports today. Thanks; the moderators are on it.'
      using errcode = 'P0001', hint = 'rate_limit';
  end if;

  v_ok := case new.target_kind
    when 'post' then exists (
      select 1 from public.posts p where p.id = new.target_id
        and p.status = 'visible' and p.author_id <> v_uid)
    when 'comment' then exists (
      select 1 from public.comments c where c.id = new.target_id
        and c.status = 'visible' and c.author_id <> v_uid)
    else exists (
      select 1 from public.profiles pr where pr.id = new.target_id and pr.id <> v_uid)
  end;
  if not v_ok then
    raise exception 'There''s nothing to report there.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create function private.reports_after_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_open integer;
  v_rows integer := 0;
begin
  if new.target_kind = 'member' then
    return null;
  end if;
  -- Only reports from established members count toward hiding a post, so a
  -- handful of fresh accounts can't hide something just by reporting it.
  select count(distinct r.reporter_id) into v_open
  from public.reports r
  where r.target_kind = new.target_kind and r.target_id = new.target_id and r.status = 'open'
    and r.reporter_id is not null and not private.is_new_member(r.reporter_id);
  if v_open >= private.setting_int('auto_hold_reports') then
    if new.target_kind = 'post' then
      update public.posts set status = 'held', status_reason = 'Held after ' || v_open || ' reports'
      where id = new.target_id and status = 'visible';
    else
      update public.comments set status = 'held', status_reason = 'Held after ' || v_open || ' reports'
      where id = new.target_id and status = 'visible';
    end if;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      insert into public.moderation_actions (moderator_id, actor, action, target_kind, target_id, reason)
      values (null, 'rules', 'hold', new.target_kind, new.target_id, v_open || ' open reports');
    end if;
  end if;
  return null;
end;
$$;

create trigger reports_before_insert before insert on public.reports
  for each row execute function private.reports_before_insert();
create trigger reports_after_insert after insert on public.reports
  for each row execute function private.reports_after_insert();

-- ---------------------------------------------------------------------------
-- Sign-up: turn a confirmed phone number into a member (needs an invite)
-- ---------------------------------------------------------------------------
create function private.complete_signup(
  p_handle text, p_invite_code text, p_confirm_adult boolean, p_rules_version text,
  p_health_data_consent boolean
) returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.invites;
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'You''re already signed up.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.phone_confirmed_at is not null) then
    raise exception 'Confirm your phone number first.' using errcode = 'P0001';
  end if;
  if p_confirm_adult is not true then
    raise exception 'Miracle Health is for adults 18 and over.' using errcode = 'P0001';
  end if;
  -- Health-privacy laws such as Washington's My Health My Data Act require consent
  -- before collecting health information; posts about what you take are that.
  if p_health_data_consent is not true then
    raise exception 'To join, agree to how what you post about your health is collected and shown.' using errcode = 'P0001';
  end if;
  if p_handle is null or p_handle !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Handles are 3 to 20 letters, numbers or underscores.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where lower(handle) = lower(p_handle)) then
    raise exception 'That handle is taken.' using errcode = 'P0001';
  end if;
  if p_rules_version is distinct from private.setting('rules_version') then
    raise exception 'The rules changed. Read them again, then sign up.' using errcode = 'P0001';
  end if;

  select * into v_invite from public.invites
  where code = upper(trim(p_invite_code))
  for update;
  if not found
     or (v_invite.expires_at is not null and v_invite.expires_at < now())
     or v_invite.uses >= v_invite.max_uses then
    raise exception 'That invite code isn''t valid.' using errcode = 'P0001';
  end if;

  update public.invites set uses = uses + 1 where code = v_invite.code;
  insert into public.profiles (id, handle, trusted, adult_confirmed_at, rules_version, invite_code, health_data_consent_at)
  values (v_uid, p_handle, v_invite.trusted, now(), p_rules_version, v_invite.code, now())
  returning * into v_profile;
  return v_profile;
end;
$$;

create function private.me()
returns table (
  id uuid, handle text, role public.member_role, status public.member_status,
  suspended_until timestamptz, trusted boolean, new_member boolean,
  created_at timestamptz, rules_version text, current_rules_version text
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.handle, p.role, p.status, p.suspended_until, p.trusted,
         private.is_new_member(p.id), p.created_at, p.rules_version,
         private.setting('rules_version')
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Moderation: one door for every action, and every action is logged
-- ---------------------------------------------------------------------------
create function private.moderate(
  p_kind public.target_kind, p_id uuid, p_action public.mod_action,
  p_reason text, p_note text, p_days integer
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.member_role;
  v_target_role public.member_role;
  v_rows integer;
  v_status public.content_status;
begin
  select role into v_role from public.profiles where id = v_uid and status = 'active';
  if v_role is null or v_role not in ('moderator', 'admin') then
    raise exception 'Only moderators can do that.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason; it goes in the log.' using errcode = 'P0001';
  end if;

  if p_kind in ('post', 'comment') then
    if p_action not in ('hold', 'remove', 'restore', 'dismiss') then
      raise exception 'That action doesn''t apply to posts or comments.' using errcode = 'P0001';
    end if;
    if p_action <> 'dismiss' then
      v_status := case p_action when 'hold' then 'held' when 'remove' then 'removed' else 'visible' end;
      if p_kind = 'post' then
        update public.posts
        set status = v_status, status_reason = case when p_action = 'restore' then null else p_reason end
        where id = p_id;
      else
        update public.comments
        set status = v_status, status_reason = case when p_action = 'restore' then null else p_reason end
        where id = p_id;
      end if;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception 'Not found.' using errcode = 'P0002';
      end if;
    end if;
  else
    if p_action not in ('warn', 'suspend', 'ban', 'unban', 'dismiss') then
      raise exception 'That action doesn''t apply to members.' using errcode = 'P0001';
    end if;
    if p_id = v_uid then
      raise exception 'You can''t act on your own account.' using errcode = 'P0001';
    end if;
    select role into v_target_role from public.profiles where id = p_id;
    if not found then
      raise exception 'Not found.' using errcode = 'P0002';
    end if;
    if v_target_role in ('moderator', 'admin') and v_role <> 'admin' then
      raise exception 'Only an admin can act on a moderator.' using errcode = '42501';
    end if;
    if p_action = 'suspend' then
      update public.profiles
      set status = 'suspended', suspended_until = now() + make_interval(days => greatest(coalesce(p_days, 7), 1))
      where id = p_id;
    elsif p_action = 'ban' then
      update public.profiles set status = 'banned', suspended_until = null where id = p_id;
      update public.posts set status = 'removed', status_reason = 'Member banned'
      where author_id = p_id and status <> 'removed';
      update public.comments set status = 'removed', status_reason = 'Member banned'
      where author_id = p_id and status <> 'removed';
    elsif p_action = 'unban' then
      update public.profiles set status = 'active', suspended_until = null where id = p_id;
    end if;
  end if;

  if p_action <> 'hold' then
    update public.reports
    set status = case when p_action in ('dismiss', 'restore', 'unban') then 'dismissed' else 'actioned' end::public.report_status,
        resolved_by = v_uid,
        resolved_at = now()
    where target_kind = p_kind and target_id = p_id and status = 'open';
  end if;

  insert into public.moderation_actions (moderator_id, actor, action, target_kind, target_id, reason, note)
  values (v_uid, 'moderator', p_action, p_kind, p_id, p_reason, p_note);
end;
$$;

create function private.review_alert(p_alert_id bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_moderator() then
    raise exception 'Only moderators can do that.' using errcode = '42501';
  end if;
  update public.signal_alerts
  set status = 'reviewed', reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_alert_id and status = 'open';
end;
$$;

-- ---------------------------------------------------------------------------
-- Public API (security invoker: they run as the caller, and the private
-- functions they call check permissions)
-- ---------------------------------------------------------------------------
create function public.complete_signup(
  handle text, invite_code text, confirm_adult boolean, rules_version text, health_data_consent boolean
) returns public.profiles
language sql security invoker set search_path = ''
as $$ select * from private.complete_signup(handle, invite_code, confirm_adult, rules_version, health_data_consent) $$;

create function public.me()
returns table (
  id uuid, handle text, role public.member_role, status public.member_status,
  suspended_until timestamptz, trusted boolean, new_member boolean,
  created_at timestamptz, rules_version text, current_rules_version text
)
language sql stable security invoker set search_path = ''
as $$ select * from private.me() $$;

create function public.moderate(
  target_kind public.target_kind, target_id uuid, action public.mod_action,
  reason text, note text default null, days integer default null
) returns void
language sql security invoker set search_path = ''
as $$ select private.moderate(target_kind, target_id, action, reason, note, days) $$;

create function public.review_alert(alert_id bigint) returns void
language sql security invoker set search_path = ''
as $$ select private.review_alert(alert_id) $$;

-- Called by the review-content Edge Function with the service role only.
create function public.record_ai_review(
  target_kind public.target_kind, target_id uuid, model text,
  verdict text, categories text[], explanation text
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_rows integer := 0;
begin
  insert into public.ai_reviews (target_kind, target_id, model, verdict, categories, explanation)
  values (record_ai_review.target_kind, record_ai_review.target_id, record_ai_review.model,
          record_ai_review.verdict, coalesce(record_ai_review.categories, '{}'), record_ai_review.explanation);
  if record_ai_review.verdict = 'hold' then
    if record_ai_review.target_kind = 'post' then
      update public.posts set status = 'held',
        status_reason = 'AI review: ' || array_to_string(record_ai_review.categories, ', ')
      where id = record_ai_review.target_id and status = 'visible';
    else
      update public.comments set status = 'held',
        status_reason = 'AI review: ' || array_to_string(record_ai_review.categories, ', ')
      where id = record_ai_review.target_id and status = 'visible';
    end if;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      insert into public.moderation_actions (moderator_id, actor, action, target_kind, target_id, reason, note)
      values (null, 'ai', 'hold', record_ai_review.target_kind, record_ai_review.target_id,
              'AI review: ' || array_to_string(record_ai_review.categories, ', '),
              record_ai_review.explanation);
    end if;
  end if;
end;
$$;

-- Beta numbers for moderators: straight from the database, no opinions.
create function public.beta_metrics()
returns table (metric text, value numeric, detail text)
language plpgsql stable security invoker set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_moderator() then
    raise exception 'Only moderators can see the beta numbers.' using errcode = '42501';
  end if;
  return query
  with members as (
    select p.id, p.created_at from public.profiles p
  ), activity as (
    select author_id as uid, created_at, 'post' as kind from public.posts
    union all select author_id, created_at, 'comment' from public.comments
    union all select user_id, created_at, 'vote' from public.post_votes
    union all select user_id, created_at, 'vote' from public.comment_votes
  ), first_contrib as (
    select m.id, m.created_at as joined,
           min(a.created_at) filter (where a.kind in ('post', 'comment')) as first_contrib
    from members m left join activity a on a.uid = m.id
    group by m.id, m.created_at
  ), eligible_w2 as (
    select m.id, m.created_at from members m where m.created_at <= now() - interval '14 days'
  ), returned_w2 as (
    select distinct e.id from eligible_w2 e
    join activity a on a.uid = e.id
      and a.created_at >= e.created_at + interval '7 days'
      and a.created_at < e.created_at + interval '14 days'
  ), resolved as (
    select extract(epoch from (r.resolved_at - r.created_at)) / 60.0 as minutes
    from public.reports r where r.resolved_at is not null
  )
  select 'members'::text, count(*)::numeric, 'Signed up with an invite'::text from members
  union all
  select 'invites_redeemed', coalesce(sum(i.uses), 0)::numeric, coalesce(sum(i.max_uses), 0) || ' places on ' || count(*) || ' codes'
  from public.invites i
  union all
  select 'week1_contributors_pct',
         round(100.0 * count(*) filter (where first_contrib <= joined + interval '7 days') / nullif(count(*), 0), 1),
         'Members who posted or commented within 7 days of joining'
  from first_contrib
  union all
  select 'week2_return_pct',
         round(100.0 * (select count(*) from returned_w2) / nullif((select count(*) from eligible_w2), 0), 1),
         'Of members who joined 14+ days ago: active (post, comment or vote) in days 8 to 14; '
           || (select count(*) from eligible_w2) || ' eligible'
  union all
  select 'median_hours_to_first_contribution',
         round((percentile_cont(0.5) within group (order by extract(epoch from (first_contrib - joined)) / 3600.0))::numeric, 1),
         'From joining to first post or comment'
  from first_contrib where first_contrib is not null
  union all
  select 'reports_open', count(*)::numeric, 'Waiting for a moderator' from public.reports where status = 'open'
  union all
  select 'report_resolution_median_minutes', round((percentile_cont(0.5) within group (order by minutes))::numeric, 0),
         'Report filed to moderator decision' from resolved
  union all
  select 'report_resolution_p90_minutes', round((percentile_cont(0.9) within group (order by minutes))::numeric, 0),
         '9 in 10 reports are decided within this' from resolved
  union all
  select 'held_waiting', count(*)::numeric, 'Held posts and comments not yet reviewed'
  from (select id from public.posts where status = 'held' union all select id from public.comments where status = 'held') h
  union all
  select 'signal_alerts_open', count(*)::numeric, 'New accounts piling onto one compound'
  from public.signal_alerts where status = 'open';
end;
$$;

-- ---------------------------------------------------------------------------
-- Views (security invoker: they show only what the reader's access rules allow)
-- ---------------------------------------------------------------------------
create view public.feed with (security_invoker = true) as
select p.id, p.compound_id, c.name as compound_name, c.category as compound_category,
       p.kind, p.title, p.body, p.status, p.status_reason, p.score,
       p.created_at, p.edited_at, p.author_id, a.handle as author_handle,
       (p.author_id = (select auth.uid())) as is_mine,
       (select v.value from public.post_votes v
        where v.post_id = p.id and v.user_id = (select auth.uid())) as my_vote,
       (select count(*) from public.comments cm
        where cm.post_id = p.id and cm.status = 'visible') as comment_count
from public.posts p
join public.profiles a on a.id = p.author_id
join public.compounds c on c.id = p.compound_id;

create view public.thread_comments with (security_invoker = true) as
select cm.id, cm.post_id, cm.body, cm.status, cm.status_reason, cm.score,
       cm.created_at, cm.edited_at, cm.author_id, a.handle as author_handle,
       (cm.author_id = (select auth.uid())) as is_mine,
       (select v.value from public.comment_votes v
        where v.comment_id = cm.id and v.user_id = (select auth.uid())) as my_vote
from public.comments cm
join public.profiles a on a.id = cm.author_id;

create view public.mod_queue with (security_invoker = true) as
with open_reports as (
  select r.target_kind, r.target_id, count(*) as reports,
         array_agg(distinct r.reason) as reasons, min(r.created_at) as first_reported_at
  from public.reports r where r.status = 'open'
  group by r.target_kind, r.target_id
)
select 'post'::public.target_kind as target_kind, p.id as target_id, p.status, p.status_reason,
       p.title, p.body, p.compound_id, p.author_id, a.handle as author_handle,
       coalesce(r.reports, 0) as reports, r.reasons,
       coalesce(r.first_reported_at, p.created_at) as waiting_since
from public.posts p
join public.profiles a on a.id = p.author_id
left join open_reports r on r.target_kind = 'post' and r.target_id = p.id
where (select private.is_moderator()) and (p.status = 'held' or r.reports > 0)
union all
select 'comment', cm.id, cm.status, cm.status_reason, null, cm.body, null, cm.author_id, a.handle,
       coalesce(r.reports, 0), r.reasons, coalesce(r.first_reported_at, cm.created_at)
from public.comments cm
join public.profiles a on a.id = cm.author_id
left join open_reports r on r.target_kind = 'comment' and r.target_id = cm.id
where (select private.is_moderator()) and (cm.status = 'held' or r.reports > 0)
union all
select 'member', pr.id, null, null, null, null, null, pr.id, pr.handle,
       r.reports, r.reasons, r.first_reported_at
from public.profiles pr
join open_reports r on r.target_kind = 'member' and r.target_id = pr.id
where (select private.is_moderator());

-- ---------------------------------------------------------------------------
-- Privileges: Supabase grants new public tables to anon and authenticated by
-- default. Start from nothing and grant back exactly what members need.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant select on public.compounds to authenticated;
grant select (id, handle, role, created_at) on public.profiles to authenticated;
grant select, delete on public.posts to authenticated;
grant insert (compound_id, kind, title, body) on public.posts to authenticated;
grant update (title, body) on public.posts to authenticated;
grant select, delete on public.comments to authenticated;
grant insert (post_id, body) on public.comments to authenticated;
grant update (body) on public.comments to authenticated;
grant select, delete on public.post_votes to authenticated;
grant insert (post_id, value) on public.post_votes to authenticated;
grant update (value) on public.post_votes to authenticated;
grant select, delete on public.comment_votes to authenticated;
grant insert (comment_id, value) on public.comment_votes to authenticated;
grant update (value) on public.comment_votes to authenticated;
grant select on public.reports to authenticated;
grant insert (target_kind, target_id, reason, note) on public.reports to authenticated;
grant select on public.moderation_actions to authenticated;
grant select on public.ai_reviews to authenticated;
grant select, delete on public.watch_terms to authenticated;
grant insert (term, action, reason, note) on public.watch_terms to authenticated;
grant select, delete on public.link_domains to authenticated;
grant insert (domain, note) on public.link_domains to authenticated;
grant select, delete on public.invites to authenticated;
grant insert (code, note, trusted, max_uses, expires_at) on public.invites to authenticated;
grant update (max_uses, expires_at, note) on public.invites to authenticated;
grant select on public.signal_alerts to authenticated;
grant select on public.feed, public.thread_comments, public.mod_queue to authenticated;

grant execute on function public.complete_signup(text, text, boolean, text, boolean) to authenticated;
grant execute on function public.me() to authenticated;
grant execute on function public.moderate(public.target_kind, uuid, public.mod_action, text, text, integer) to authenticated;
grant execute on function public.review_alert(bigint) to authenticated;
grant execute on function public.beta_metrics() to authenticated;
grant execute on function public.record_ai_review(public.target_kind, uuid, text, text, text[], text) to service_role;

-- Helpers the access rules and the public functions call
grant execute on function private.can_read() to authenticated;
grant execute on function private.can_write() to authenticated;
grant execute on function private.is_moderator() to authenticated;
grant execute on function private.complete_signup(text, text, boolean, text, boolean) to authenticated;
grant execute on function private.me() to authenticated;
grant execute on function private.moderate(public.target_kind, uuid, public.mod_action, text, text, integer) to authenticated;
grant execute on function private.review_alert(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security: on for every table, one policy per action
-- ---------------------------------------------------------------------------
alter table public.compounds enable row level security;
alter table public.invites enable row level security;
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_votes enable row level security;
alter table public.comment_votes enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.ai_reviews enable row level security;
alter table public.watch_terms enable row level security;
alter table public.link_domains enable row level security;
alter table public.signal_alerts enable row level security;

create policy "members read compounds" on public.compounds
  for select to authenticated using ((select private.can_read()));

create policy "members read profiles" on public.profiles
  for select to authenticated using ((select private.can_read()));

create policy "read posts" on public.posts
  for select to authenticated
  using ((select private.can_read())
         and (status = 'visible' or author_id = (select auth.uid()) or (select private.is_moderator())));
create policy "start posts" on public.posts
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (select private.can_write()));
create policy "edit own posts" on public.posts
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()) and (select private.can_write()));
create policy "delete own posts" on public.posts
  for delete to authenticated using (author_id = (select auth.uid()));

create policy "read comments" on public.comments
  for select to authenticated
  using ((select private.can_read())
         and (status = 'visible' or author_id = (select auth.uid()) or (select private.is_moderator()))
         and exists (select 1 from public.posts p where p.id = post_id));
create policy "write comments" on public.comments
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (select private.can_write())
              and exists (select 1 from public.posts p where p.id = post_id and p.status = 'visible'));
create policy "edit own comments" on public.comments
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()) and (select private.can_write()));
create policy "delete own comments" on public.comments
  for delete to authenticated using (author_id = (select auth.uid()));

create policy "read own post votes" on public.post_votes
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_moderator()));
create policy "vote on posts" on public.post_votes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.can_write())
              and exists (select 1 from public.posts p
                          where p.id = post_id and p.status = 'visible' and p.author_id <> (select auth.uid())));
create policy "change own post votes" on public.post_votes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select private.can_write()));
create policy "remove own post votes" on public.post_votes
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "read own comment votes" on public.comment_votes
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_moderator()));
create policy "vote on comments" on public.comment_votes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.can_write())
              and exists (select 1 from public.comments c
                          where c.id = comment_id and c.status = 'visible' and c.author_id <> (select auth.uid())));
create policy "change own comment votes" on public.comment_votes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select private.can_write()));
create policy "remove own comment votes" on public.comment_votes
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "read own reports" on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or (select private.is_moderator()));
create policy "file reports" on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()) and (select private.can_read()));

create policy "moderators read the log" on public.moderation_actions
  for select to authenticated using ((select private.is_moderator()));

create policy "moderators read AI reviews" on public.ai_reviews
  for select to authenticated using ((select private.is_moderator()));

create policy "moderators manage watch terms" on public.watch_terms
  for all to authenticated
  using ((select private.is_moderator())) with check ((select private.is_moderator()));

create policy "moderators manage link domains" on public.link_domains
  for all to authenticated
  using ((select private.is_moderator())) with check ((select private.is_moderator()));

create policy "moderators manage invites" on public.invites
  for all to authenticated
  using ((select private.is_moderator())) with check ((select private.is_moderator()));

create policy "moderators read alerts" on public.signal_alerts
  for select to authenticated using ((select private.is_moderator()));
