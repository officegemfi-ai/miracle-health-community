-- Miracle Health community: the game layer.
--
-- Spaces members join (one per compound, shown as s/Name), reply threads, Sig
-- sticker reactions, Signal points with the fifteen emblems (Spark to Organism),
-- badges, weekly quests, community goals, notifications (including notes from the
-- moderators), and a Signal that records what moved it, so the app can show it
-- moving live.
--
-- Points follow the community's rule: they go to follow-through, never to results.
-- A first-hand report earns the same whether it went better, the same or worse.
-- Everything is counted here; the app only shows it.

insert into private.settings (key, value, note) values
  ('comment_points_per_day', '20', 'Comments in 24 hours that earn Signal points'),
  ('max_thread_depth', '8', 'How many replies deep a thread can go'),
  ('builder_min_points', '100', 'Points in a month before a top-ten place earns the Signal Builder badge')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Reference data members can read
-- ---------------------------------------------------------------------------
create table public.levels (
  n smallint primary key check (n between 1 and 15),
  name text not null unique,
  min_points integer not null unique check (min_points >= 0),
  tier text not null check (tier in ('Signal', 'Resonant', 'Lodestar'))
);
insert into public.levels (n, name, min_points, tier) values
  (1, 'Spark', 0, 'Signal'), (2, 'Pulse', 60, 'Signal'), (3, 'Ripple', 150, 'Signal'),
  (4, 'Current', 280, 'Signal'), (5, 'Wave', 450, 'Signal'),
  (6, 'Beacon', 680, 'Resonant'), (7, 'Resonance', 980, 'Resonant'), (8, 'Frequency', 1350, 'Resonant'),
  (9, 'Amplifier', 1800, 'Resonant'), (10, 'Conduit', 2350, 'Resonant'),
  (11, 'Catalyst', 3000, 'Lodestar'), (12, 'Lodestar', 3800, 'Lodestar'), (13, 'Synapse', 4750, 'Lodestar'),
  (14, 'Nexus', 5900, 'Lodestar'), (15, 'Organism', 7300, 'Lodestar');

create table public.point_rules (
  reason text primary key,
  points integer not null,
  label text not null
);
insert into public.point_rules (reason, points, label) values
  ('report', 40, 'A first-hand report that feeds the Signal, whatever the outcome'),
  ('post', 5, 'Starting a post'),
  ('comment', 3, 'A comment or reply (the first 20 a day)'),
  ('same_given', 5, 'Saying “same for me” on a report that matches yours'),
  ('same_received', 5, 'Someone established said “same for me” on your report'),
  ('confirm', 10, 'Confirming or correcting how Miracle AI read your report'),
  ('upvote', 1, 'A helpful vote on your post or comment from an established member'),
  ('sticker', 1, 'A Sig sticker on your post from an established member'),
  ('daily', 5, 'Your first contribution of the day'),
  ('quest', 0, 'A finished quest (the quest says how many)');

create table public.badges (
  key text primary key,
  name text not null,
  description text not null,
  sort smallint not null
);
insert into public.badges (key, name, description, sort) values
  ('founding', 'Founding member', 'Joined with a founding invite', 1),
  ('first_report', 'First report', 'Shared a first-hand report that feeds the Signal', 2),
  ('specific', 'Specific', 'Three first-hand reports that say how long', 3),
  ('replicator', 'Replicator', 'Said “same for me” ten times', 4),
  ('voice', 'Voice', 'Five comments in the conversation', 5),
  ('receipts', 'Receipts', 'Confirmed three of Miracle AI’s reads', 6),
  ('pioneer', 'Pioneer', 'The first first-hand report in a space', 7),
  ('streak7', 'Seven days', 'Contributed seven days in a row', 8),
  ('builder', 'Signal Builder', 'A top-ten Signal Builder in a month', 9),
  ('season1', 'Season 1', 'Three first-hand reports in Season 1 · Founders', 10);

create table public.quests (
  key text primary key,
  title text not null,
  description text not null,
  need integer not null check (need > 0),
  reward integer not null check (reward > 0),
  cadence text not null check (cadence in ('weekly', 'once')),
  sort smallint not null
);
insert into public.quests (key, title, description, need, reward, cadence, sort) values
  ('report', 'Share a first-hand report', 'Post how it went for you: better, the same or worse. Miracle AI reads it into the Signal.', 1, 50, 'weekly', 1),
  ('same', 'Back up three reports', 'Tap “Same for me” on three reports that match your own experience.', 3, 30, 'weekly', 2),
  ('comment', 'Join three conversations', 'Leave three comments or replies.', 3, 20, 'weekly', 3),
  ('vote', 'Vote on ten posts', 'Mark what helps, so the best reports rise.', 10, 10, 'weekly', 4),
  ('spaces', 'Join three spaces', 'Follow the compounds you care about.', 3, 20, 'once', 5),
  ('confirm', 'Check a Miracle AI read', 'Confirm or correct how Miracle AI read one of your reports.', 1, 15, 'once', 6);

create table public.seasons (
  n smallint primary key,
  name text not null,
  starts date not null,
  ends date not null check (ends >= starts),
  goal_reports integer not null check (goal_reports > 0),
  badge_reports integer not null check (badge_reports > 0)
);
insert into public.seasons (n, name, starts, ends, goal_reports, badge_reports) values
  (1, 'Season 1 · Founders', '2026-10-01', '2026-12-31', 1000, 3);

-- ---------------------------------------------------------------------------
-- Spaces: members join compounds; the count lives on the compound
-- ---------------------------------------------------------------------------
alter table public.compounds add column members_count integer not null default 0;

create table public.space_members (
  compound_id text not null references public.compounds (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (compound_id, user_id)
);
create index space_members_user_idx on public.space_members (user_id);

-- ---------------------------------------------------------------------------
-- Reply threads
-- ---------------------------------------------------------------------------
-- A reply whose parent is deleted stays up and moves to the top of the thread
alter table public.comments
  add column parent_id uuid references public.comments (id) on delete set null,
  add column depth smallint not null default 0 check (depth between 0 and 20);
create index comments_parent_idx on public.comments (parent_id);

-- ---------------------------------------------------------------------------
-- Sig stickers on posts; like votes, the counts live on the post
-- ---------------------------------------------------------------------------
create table public.post_reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  sticker text not null check (sticker in ('cheer', 'support', 'curious', 'watching')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, sticker)
);
create index post_reactions_user_idx on public.post_reactions (user_id, created_at desc);
alter table public.posts add column reactions jsonb not null default '{}';

-- ---------------------------------------------------------------------------
-- Signal points: a ledger (members read their own lines) and running totals
-- (everyone reads those, like karma)
-- ---------------------------------------------------------------------------
create table public.points (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null references public.point_rules (reason),
  amount integer not null,
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  from_user uuid references public.profiles (id) on delete cascade,  -- never shown: votes and taps stay private
  ref text not null default '',
  void boolean not null default false,  -- the post or comment it came from isn't up
  created_at timestamptz not null default now()
);
create unique index points_once on public.points (
  user_id, reason,
  coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(from_user, '00000000-0000-0000-0000-000000000000'::uuid),
  ref);
create index points_user_idx on public.points (user_id, created_at desc);
create index points_reason_idx on public.points (reason);
create index points_post_idx on public.points (post_id) where post_id is not null;
create index points_comment_idx on public.points (comment_id) where comment_id is not null;
create index points_from_idx on public.points (from_user) where from_user is not null;

create table public.member_scores (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  total integer not null default 0,
  month_key text not null default to_char(now() at time zone 'utc', 'YYYY-MM'),
  month_total integer not null default 0,
  level smallint not null default 1 references public.levels (n),
  streak_days integer not null default 0,
  best_streak integer not null default 0,
  last_active_day date,
  updated_at timestamptz not null default now()
);
create index member_scores_month_idx on public.member_scores (month_key, month_total desc);
create index member_scores_level_idx on public.member_scores (level);

create table public.member_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge text not null references public.badges (key),
  earned_at timestamptz not null default now(),
  primary key (user_id, badge)
);
create index member_badges_badge_idx on public.member_badges (badge);

-- ---------------------------------------------------------------------------
-- Notifications (members read and clear their own)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('welcome', 'comment', 'reply', 'same_for_me', 'counted',
                                     'milestone', 'level_up', 'badge', 'mod')),
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  compound_id text references public.compounds (id),
  data jsonb not null default '{}',
  dedupe text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_dedupe on public.notifications (user_id, dedupe) where dedupe is not null;
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_post_idx on public.notifications (post_id) where post_id is not null;
create index notifications_comment_idx on public.notifications (comment_id) where comment_id is not null;
create index notifications_compound_idx on public.notifications (compound_id) where compound_id is not null;

-- ---------------------------------------------------------------------------
-- The Signal records what moved it; authors can confirm Miracle AI's read
-- ---------------------------------------------------------------------------
alter table public.signal_snapshots
  add column cause text check (cause in ('report', 'same', 'removed', 'restored', 'edit', 'deleted')),
  add column cause_post uuid;
alter table public.post_reads
  add column confirmed_at timestamptz,
  add column corrected boolean not null default false;

-- ===========================================================================
-- Counting points
-- ===========================================================================
create function private.level_of(p_points integer) returns smallint
language sql stable security definer set search_path = ''
as $$ select coalesce(max(l.n), 1)::smallint from public.levels l where l.min_points <= greatest(p_points, 0) $$;

create function private.notify(
  p_uid uuid, p_kind text, p_post uuid, p_comment uuid, p_compound text, p_data jsonb, p_dedupe text,
  p_refresh boolean default false
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_uid is null or not exists (select 1 from public.profiles where id = p_uid) then
    return;
  end if;
  if p_refresh and p_dedupe is not null then
    -- One running notification (e.g. "3 people said same for me"), back on top and unread
    insert into public.notifications (user_id, kind, post_id, comment_id, compound_id, data, dedupe)
    values (p_uid, p_kind, p_post, p_comment, p_compound, coalesce(p_data, '{}'), p_dedupe)
    on conflict (user_id, dedupe) where dedupe is not null
    do update set data = excluded.data, read_at = null, created_at = now();
  else
    insert into public.notifications (user_id, kind, post_id, comment_id, compound_id, data, dedupe)
    values (p_uid, p_kind, p_post, p_comment, p_compound, coalesce(p_data, '{}'), p_dedupe)
    on conflict do nothing;
  end if;
end;
$$;

create function private.give_badge(p_uid uuid, p_badge text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_uid is null or not exists (select 1 from public.profiles where id = p_uid) then
    return;
  end if;
  insert into public.member_badges (user_id, badge) values (p_uid, p_badge) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform private.notify(p_uid, 'badge', null, null, null,
      (select jsonb_build_object('badge', b.key, 'name', b.name, 'description', b.description)
       from public.badges b where b.key = p_badge),
      'badge:' || p_badge);
  end if;
end;
$$;

-- Adds one line to the ledger, once. "Active" lines are things the member did
-- themselves; the first one each day (UTC) adds the daily bonus and the streak.
create function private.award(
  p_uid uuid, p_reason text, p_post uuid default null, p_comment uuid default null,
  p_from uuid default null, p_ref text default '', p_amount integer default null,
  p_void boolean default false, p_active boolean default false
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_amount integer := coalesce(p_amount, (select r.points from public.point_rules r where r.reason = p_reason), 0);
  v_day date := (now() at time zone 'utc')::date;
  v_last date;
begin
  if p_uid is null or v_amount = 0 or not exists (select 1 from public.profiles where id = p_uid) then
    return;
  end if;
  insert into public.member_scores (user_id) values (p_uid) on conflict do nothing;
  if p_active and not p_void then
    select s.last_active_day into v_last from public.member_scores s where s.user_id = p_uid for update;
    if v_last is distinct from v_day then
      update public.member_scores
         set streak_days = case when last_active_day = v_day - 1 then streak_days + 1 else 1 end,
             best_streak = greatest(best_streak, case when last_active_day = v_day - 1 then streak_days + 1 else 1 end),
             last_active_day = v_day
       where user_id = p_uid;
      insert into public.points (user_id, reason, amount, ref)
      values (p_uid, 'daily', (select r.points from public.point_rules r where r.reason = 'daily'), v_day::text)
      on conflict do nothing;
    end if;
  end if;
  insert into public.points (user_id, reason, amount, post_id, comment_id, from_user, ref, void)
  values (p_uid, p_reason, v_amount, p_post, p_comment, p_from, coalesce(p_ref, ''), coalesce(p_void, false))
  on conflict do nothing;
end;
$$;

-- Keeps each member's totals, level and monthly score in step with the ledger
create function private.points_tally() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := coalesce(new.user_id, old.user_id);
  v_old integer := case when tg_op in ('UPDATE', 'DELETE') and not old.void then old.amount else 0 end;
  v_new integer := case when tg_op in ('INSERT', 'UPDATE') and not new.void then new.amount else 0 end;
  v_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_this_month boolean := to_char(coalesce(new.created_at, old.created_at) at time zone 'utc', 'YYYY-MM') = v_month;
  v_before public.member_scores;
  v_after public.member_scores;
  v_level smallint;
  v_rank integer;
begin
  if v_new = v_old or not exists (select 1 from public.profiles where id = v_uid) then
    return null;  -- nothing changed, or the member is being deleted
  end if;
  insert into public.member_scores (user_id) values (v_uid) on conflict do nothing;
  select * into v_before from public.member_scores where user_id = v_uid for update;
  update public.member_scores
     set total = greatest(total + v_new - v_old, 0),
         month_total = greatest(case when month_key = v_month then month_total else 0 end
                                + case when v_this_month then v_new - v_old else 0 end, 0),
         month_key = v_month,
         updated_at = now()
   where user_id = v_uid
  returning * into v_after;

  v_level := private.level_of(v_after.total);
  if v_level <> v_after.level then
    update public.member_scores set level = v_level where user_id = v_uid;
    if v_level > v_before.level then
      perform private.notify(v_uid, 'level_up', null, null, null,
        (select jsonb_build_object('level', l.n, 'name', l.name, 'tier', l.tier) from public.levels l where l.n = v_level),
        'level:' || v_level);
    end if;
  end if;

  if v_new > v_old and v_after.month_total >= private.setting_int('builder_min_points') then
    select count(*) + 1 into v_rank from public.member_scores s
    where s.month_key = v_month and s.month_total > v_after.month_total;
    if v_rank <= 10 then
      perform private.give_badge(v_uid, 'builder');
    end if;
  end if;
  return null;
end;
$$;

create trigger points_tally after insert or update or delete on public.points
  for each row execute function private.points_tally();

create function private.check_badges(p_uid uuid) returns void
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

-- ---------------------------------------------------------------------------
-- What earns points (and what takes them back)
-- ---------------------------------------------------------------------------
create function private.posts_award() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.award(new.author_id, 'post', new.id, null, null, '', null, new.status <> 'visible', true);
  return null;
end;
$$;

create function private.comments_award() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_today integer;
  v_post public.posts;
  v_parent public.comments;
begin
  select count(*) into v_today from public.points
  where user_id = new.author_id and reason = 'comment' and created_at > now() - interval '24 hours';
  if v_today < private.setting_int('comment_points_per_day') then
    perform private.award(new.author_id, 'comment', null, new.id, null, '', null, new.status <> 'visible', true);
  end if;
  perform private.check_badges(new.author_id);

  if new.status = 'visible' then
    select * into v_post from public.posts where id = new.post_id;
    if new.parent_id is not null then
      select * into v_parent from public.comments where id = new.parent_id;
      if v_parent.author_id is distinct from new.author_id then
        perform private.notify(v_parent.author_id, 'reply', new.post_id, new.id, v_post.compound_id, '{}', null);
      end if;
    end if;
    if v_post.author_id is distinct from new.author_id
       and (new.parent_id is null or v_parent.author_id is distinct from v_post.author_id) then
      perform private.notify(v_post.author_id, 'comment', new.post_id, new.id, v_post.compound_id, '{}', null);
    end if;
  end if;
  return null;
end;
$$;

-- Points follow their post or comment: down while it's held or removed, back when restored
create function private.points_follow_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'posts' then
    update public.points set void = (new.status <> 'visible')
    where post_id = new.id and void is distinct from (new.status <> 'visible');
  else
    update public.points set void = (new.status <> 'visible')
    where comment_id = new.id and void is distinct from (new.status <> 'visible');
  end if;
  return null;
end;
$$;

create function private.post_reads_award() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_post public.posts;
  v_cur public.signal_snapshots;
  v_prev numeric;
begin
  if tg_op = 'DELETE' then
    delete from public.points where post_id = old.post_id and reason = 'report';
    return null;
  end if;
  select * into v_post from public.posts where id = new.post_id;
  if v_post.id is null then
    return null;
  end if;
  if not new.counts then
    delete from public.points where post_id = new.post_id and reason = 'report';
    return null;
  end if;
  perform private.award(v_post.author_id, 'report', v_post.id, null, null, '', null, v_post.status <> 'visible', false);
  if v_post.status = 'visible' and (tg_op = 'INSERT' or not old.counts) then
    -- Tell the author what their report did to the Signal (the snapshot was
    -- written a moment ago by post_reads_signal)
    select * into v_cur from public.signal_snapshots
    where compound_id = new.compound_id order by version desc limit 1;
    if v_cur.cause_post = new.post_id then
      select s.score into v_prev from public.signal_snapshots s
      where s.compound_id = new.compound_id and s.version = v_cur.version - 1;
    else
      v_prev := v_cur.score;
    end if;
    perform private.notify(v_post.author_id, 'counted', v_post.id, null, new.compound_id,
      jsonb_build_object('outcome', new.outcome, 'duration', new.duration,
                         'from', v_prev, 'to', v_cur.score), 'counted:' || v_post.id);
  end if;
  perform private.check_badges(v_post.author_id);
  return null;
end;
$$;

create function private.same_for_me_award() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_post public.posts;
begin
  if tg_op = 'DELETE' then
    delete from public.points
    where post_id = old.post_id
      and ((reason = 'same_given' and user_id = old.user_id) or (reason = 'same_received' and from_user = old.user_id));
    return null;
  end if;
  select * into v_post from public.posts where id = new.post_id;
  perform private.award(new.user_id, 'same_given', new.post_id, null, null, '', null, false, true);
  if not private.is_new_member(new.user_id) then
    perform private.award(v_post.author_id, 'same_received', new.post_id, null, new.user_id, '', null,
                          v_post.status <> 'visible', false);
  end if;
  -- One running note per report; who tapped stays private
  perform private.notify(v_post.author_id, 'same_for_me', v_post.id, null, v_post.compound_id,
    jsonb_build_object('count', v_post.same_count), 'same:' || v_post.id, true);
  perform private.check_badges(new.user_id);
  return null;
end;
$$;

create function private.votes_award() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_author uuid;
  v_void boolean;
begin
  if tg_table_name = 'post_votes' then
    if tg_op in ('UPDATE', 'DELETE') then
      delete from public.points where reason = 'upvote' and post_id = old.post_id and from_user = old.user_id;
    end if;
    if tg_op in ('INSERT', 'UPDATE') and new.value = 1 and not private.is_new_member(new.user_id) then
      select p.author_id, p.status <> 'visible' into v_author, v_void from public.posts p where p.id = new.post_id;
      perform private.award(v_author, 'upvote', new.post_id, null, new.user_id, '', null, v_void, false);
    end if;
  else
    if tg_op in ('UPDATE', 'DELETE') then
      delete from public.points where reason = 'upvote' and comment_id = old.comment_id and from_user = old.user_id;
    end if;
    if tg_op in ('INSERT', 'UPDATE') and new.value = 1 and not private.is_new_member(new.user_id) then
      select c.author_id, c.status <> 'visible' into v_author, v_void from public.comments c where c.id = new.comment_id;
      perform private.award(v_author, 'upvote', null, new.comment_id, new.user_id, '', null, v_void, false);
    end if;
  end if;
  return null;
end;
$$;

create function private.posts_milestone() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  t integer;
begin
  foreach t in array array[5, 10, 25, 50, 100, 250, 500] loop
    if old.score < t and new.score >= t then
      perform private.notify(new.author_id, 'milestone', new.id, null, new.compound_id,
        jsonb_build_object('score', t), 'milestone:' || new.id || ':' || t);
    end if;
  end loop;
  return null;
end;
$$;

create function private.profiles_welcome() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.member_scores (user_id) values (new.id) on conflict do nothing;
  perform private.notify(new.id, 'welcome', null, null, null, '{}', 'welcome');
  if new.trusted then
    perform private.give_badge(new.id, 'founding');
  end if;
  return null;
end;
$$;

-- A note to the member when a moderator acts on them or their content
create function private.moderation_notify() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_post uuid;
  v_comment uuid;
  v_what text;
  v_until timestamptz;
begin
  if new.target_kind = 'post' then
    select p.author_id, p.id into v_uid, v_post from public.posts p where p.id = new.target_id;
    v_what := 'post';
  elsif new.target_kind = 'comment' then
    select c.author_id, c.post_id, c.id into v_uid, v_post, v_comment from public.comments c where c.id = new.target_id;
    v_what := 'comment';
  else
    v_uid := new.target_id;
    v_what := 'account';
  end if;
  if v_uid is null or new.action not in ('hold', 'remove', 'restore', 'warn', 'suspend', 'unban') then
    return null;
  end if;
  if new.action = 'suspend' then
    select p.suspended_until into v_until from public.profiles p where p.id = v_uid;
  end if;
  perform private.notify(v_uid, 'mod', v_post, v_comment, null,
    jsonb_build_object('action', new.action, 'what', v_what, 'reason', new.reason,
                       'note', case when new.action = 'warn' then new.note end,
                       'by', new.actor, 'until', v_until),
    null);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Spaces, threads and stickers
-- ---------------------------------------------------------------------------
create function private.space_members_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.user_id := (select auth.uid());
  end if;
  new.created_at := now();
  return new;
end;
$$;

create function private.space_members_count() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.compounds set members_count = members_count + 1 where id = new.compound_id;
  else
    update public.compounds set members_count = greatest(members_count - 1, 0) where id = old.compound_id;
  end if;
  return null;
end;
$$;

create function private.comments_thread() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_parent public.comments;
begin
  if new.parent_id is null then
    new.depth := 0;
    return new;
  end if;
  select * into v_parent from public.comments where id = new.parent_id;
  if v_parent.id is null or v_parent.post_id <> new.post_id then
    raise exception 'That reply doesn''t belong to this post.' using errcode = 'P0001';
  end if;
  if v_parent.status <> 'visible' then
    raise exception 'That comment isn''t up anymore.' using errcode = 'P0001';
  end if;
  if v_parent.depth >= private.setting_int('max_thread_depth') then
    raise exception 'This thread is as deep as it goes. Reply higher up.' using errcode = 'P0001';
  end if;
  new.depth := v_parent.depth + 1;
  return new;
end;
$$;

create function private.reactions_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_post public.posts;
  v_count integer;
begin
  if v_uid is null then
    return new;  -- service role
  end if;
  new.user_id := v_uid;
  new.created_at := now();
  select * into v_post from public.posts where id = new.post_id;
  if v_post.id is null or v_post.status <> 'visible' then
    raise exception 'That post isn''t up.' using errcode = 'P0001';
  end if;
  if v_post.author_id = v_uid then
    raise exception 'Stickers are for other people''s posts.' using errcode = 'P0001';
  end if;
  -- Shares the hourly vote allowance
  select (select count(*) from public.post_votes where user_id = v_uid and created_at > now() - interval '1 hour')
       + (select count(*) from public.comment_votes where user_id = v_uid and created_at > now() - interval '1 hour')
       + (select count(*) from public.same_for_me where user_id = v_uid and created_at > now() - interval '1 hour')
       + (select count(*) from public.post_reactions where user_id = v_uid and created_at > now() - interval '1 hour')
    into v_count;
  if v_count >= private.setting_int('votes_per_hour') then
    raise exception 'That''s a lot for one hour. Try again later.' using errcode = 'P0001', hint = 'rate_limit';
  end if;
  return new;
end;
$$;

create function private.reactions_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_post public.posts;
begin
  if tg_op = 'INSERT' then
    update public.posts
       set reactions = jsonb_set(reactions, array[new.sticker], to_jsonb(coalesce((reactions ->> new.sticker)::integer, 0) + 1))
     where id = new.post_id
    returning * into v_post;
    if not private.is_new_member(new.user_id) then
      perform private.award(v_post.author_id, 'sticker', new.post_id, null, new.user_id, new.sticker, null,
                            v_post.status <> 'visible', false);
    end if;
  else
    update public.posts
       set reactions = jsonb_set(reactions, array[old.sticker], to_jsonb(greatest(coalesce((reactions ->> old.sticker)::integer, 0) - 1, 0)))
     where id = old.post_id;
    delete from public.points
    where reason = 'sticker' and post_id = old.post_id and from_user = old.user_id and ref = old.sticker;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger posts_award after insert on public.posts
  for each row execute function private.posts_award();
create trigger posts_points_status after update of status on public.posts
  for each row when (old.status is distinct from new.status)
  execute function private.points_follow_status();
create trigger posts_milestone after update of score on public.posts
  for each row when (new.score > old.score)
  execute function private.posts_milestone();
create trigger comments_before_insert_thread before insert on public.comments
  for each row execute function private.comments_thread();
create trigger comments_award after insert on public.comments
  for each row execute function private.comments_award();
create trigger comments_points_status after update of status on public.comments
  for each row when (old.status is distinct from new.status)
  execute function private.points_follow_status();
-- Named to run after post_reads_signal, so the new Signal is already written
create trigger post_reads_signal_award after insert or update or delete on public.post_reads
  for each row execute function private.post_reads_award();
create trigger same_for_me_award after insert or delete on public.same_for_me
  for each row execute function private.same_for_me_award();
create trigger post_votes_award after insert or update or delete on public.post_votes
  for each row execute function private.votes_award();
create trigger comment_votes_award after insert or update or delete on public.comment_votes
  for each row execute function private.votes_award();
create trigger profiles_welcome after insert on public.profiles
  for each row execute function private.profiles_welcome();
create trigger moderation_notify after insert on public.moderation_actions
  for each row execute function private.moderation_notify();
create trigger space_members_before_insert before insert on public.space_members
  for each row execute function private.space_members_before_insert();
create trigger space_members_count after insert or delete on public.space_members
  for each row execute function private.space_members_count();
create trigger post_reactions_before_insert before insert on public.post_reactions
  for each row execute function private.reactions_before_insert();
create trigger post_reactions_after after insert or delete on public.post_reactions
  for each row execute function private.reactions_after();

-- ===========================================================================
-- The Signal says what moved it
-- ===========================================================================
-- The triggers that recompute the Signal leave a note for this transaction;
-- signal_compute writes it on the new version.
create function private.signal_cause(p_cause text, p_post uuid) returns void
language sql security definer set search_path = ''
as $$
  select set_config('mh.signal_cause', coalesce(p_cause, ''), true),
         set_config('mh.signal_cause_post', coalesce(p_post::text, ''), true);
$$;

create or replace function private.signal_compute(p_compound text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  b public.signal_baseline;
  v_prev public.signal_snapshots;
  v_n numeric; v_sum numeric; v_better numeric; v_same numeric; v_worse numeric;
  v_reports integer; v_sames integer; v_voices integer;
  v_ext numeric; v_entropy numeric := 0; v_in_eff numeric := 0; v_in_cons numeric := 0;
  v_eff numeric; v_cons numeric; v_div numeric; v_conf numeric; v_score numeric; v_share smallint;
  v_cause text := nullif(current_setting('mh.signal_cause', true), '');
  v_cause_post uuid := nullif(current_setting('mh.signal_cause_post', true), '')::uuid;
begin
  if p_compound is null then
    return;
  end if;
  -- One change at a time per compound, so versions never collide
  perform pg_advisory_xact_lock(hashtext('signal:' || p_compound));
  select * into b from public.signal_baseline where compound_id = p_compound;

  with contributions as (
    -- The author of each first-hand report that is up
    select p.author_id as uid, r.outcome, 'report' as kind
    from public.post_reads r
    join public.posts p on p.id = r.post_id
    where r.compound_id = p_compound and r.counts and p.status = 'visible'
    union all
    -- Everyone who said "same for me" on one of those
    select s.user_id, r.outcome, 'same'
    from public.same_for_me s
    join public.post_reads r on r.post_id = s.post_id
    join public.posts p on p.id = s.post_id
    where r.compound_id = p_compound and r.counts and p.status = 'visible'
  ), weighted as (
    select c.uid, c.outcome, c.kind,
           case when private.is_new_member(c.uid) then 0.5 else 1.0 end as w
    from contributions c
  )
  select coalesce(sum(w), 0),
         coalesce(sum(w * case outcome when 'better' then 1 when 'same' then 0.5 else 0 end), 0),
         coalesce(sum(w) filter (where outcome = 'better'), 0),
         coalesce(sum(w) filter (where outcome = 'same'), 0),
         coalesce(sum(w) filter (where outcome = 'worse'), 0),
         count(*) filter (where kind = 'report'),
         count(*) filter (where kind = 'same'),
         count(distinct uid)
    into v_n, v_sum, v_better, v_same, v_worse, v_reports, v_sames, v_voices
  from weighted;

  select * into v_prev from public.signal_snapshots
  where compound_id = p_compound order by version desc limit 1;

  if b.compound_id is null and v_n < private.setting_int('signal_min_reports') then
    -- Not enough to go on. If it had a number before, record that it no longer does.
    if v_prev.id is not null and v_prev.score is not null then
      insert into public.signal_snapshots (compound_id, version, score, first_hand, same_for_me, voices, cause, cause_post)
      values (p_compound, v_prev.version + 1, null, v_reports, v_sames, v_voices, v_cause, v_cause_post);
    end if;
    return;
  end if;

  v_ext := case when b.compound_id is null then 0 else private.setting_int('signal_external_weight') end;
  if v_n > 0 then
    v_in_eff := 100 * v_sum / v_n;
    v_entropy := -( case when v_better > 0 then (v_better / v_n) * ln(v_better / v_n) else 0 end
                  + case when v_same > 0 then (v_same / v_n) * ln(v_same / v_n) else 0 end
                  + case when v_worse > 0 then (v_worse / v_n) * ln(v_worse / v_n) else 0 end);
    v_in_cons := 100 * (1 - v_entropy / ln(3));
  end if;
  -- Efficacy and consistency: pooled, the baseline counting as v_ext reports.
  -- Diversity and confidence: only grow as more people and reports arrive.
  v_eff := coalesce((v_ext * coalesce(b.efficacy, 0) + v_n * v_in_eff) / nullif(v_ext + v_n, 0), 0);
  v_cons := coalesce((v_ext * coalesce(b.consistency, 0) + v_n * v_in_cons) / nullif(v_ext + v_n, 0), 0);
  v_div := 100 - (100 - coalesce(b.diversity, 0)) * exp(-v_voices / 40.0);
  v_conf := 100 - (100 - coalesce(b.confidence, 0)) * exp(-v_n / 60.0);
  v_score := round(0.65 * v_eff + 0.15 * v_cons + 0.10 * v_div + 0.10 * v_conf, 1);
  v_share := coalesce(round(100 * v_n / nullif(v_ext + v_n, 0)), 0);

  if v_prev.id is not null and v_prev.score is not distinct from v_score then
    update public.signal_snapshots
       set efficacy = round(v_eff), consistency = round(v_cons), diversity = round(v_div),
           confidence = round(v_conf), first_hand = v_reports, same_for_me = v_sames,
           voices = v_voices, internal_share = v_share
     where id = v_prev.id;
    return;
  end if;
  insert into public.signal_snapshots (compound_id, version, score, efficacy, consistency, diversity,
                                       confidence, first_hand, same_for_me, voices, internal_share,
                                       themes, source_families, cause, cause_post)
  values (p_compound, coalesce(v_prev.version, 0) + 1, v_score, round(v_eff), round(v_cons),
          round(v_div), round(v_conf), v_reports, v_sames, v_voices, v_share,
          coalesce(b.themes, '[]'), coalesce(b.source_families, '{}'), v_cause, v_cause_post);
end;
$$;

create or replace function private.post_reads_signal() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.signal_cause(
      case when exists (select 1 from public.posts p where p.id = old.post_id) then 'edit' else 'deleted' end,
      old.post_id);
  else
    perform private.signal_cause('report', new.post_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.signal_compute(old.compound_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.compound_id <> old.compound_id
                                        or (new.counts, new.outcome) is distinct from (old.counts, old.outcome)) then
    perform private.signal_compute(new.compound_id);
  end if;
  return null;
end;
$$;

create or replace function private.same_for_me_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_post uuid := coalesce(new.post_id, old.post_id);
begin
  if tg_op = 'INSERT' then
    update public.posts set same_count = same_count + 1 where id = v_post;
  else
    update public.posts set same_count = greatest(same_count - 1, 0) where id = v_post;
  end if;
  perform private.signal_cause('same', v_post);
  perform private.signal_compute((select r.compound_id from public.post_reads r where r.post_id = v_post));
  return null;
end;
$$;

create or replace function private.posts_signal_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.post_reads r where r.post_id = new.id and r.counts) then
    perform private.signal_cause(case when new.status = 'visible' then 'restored' else 'removed' end, new.id);
    perform private.signal_compute(new.compound_id);
  end if;
  return null;
end;
$$;

-- Claude's read never overwrites a read the author confirmed or corrected
create or replace function public.record_post_read(
  post_id uuid, counts boolean, outcome text, duration text, side_effects text[], model text
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_compound text;
  v_outcome text := case when record_post_read.outcome in ('better', 'same', 'worse') then record_post_read.outcome end;
  v_counts boolean := coalesce(record_post_read.counts, false) and v_outcome is not null;
  v_effects text[];
begin
  select p.compound_id into v_compound from public.posts p
  where p.id = record_post_read.post_id and p.kind = 'experience';
  if v_compound is null then
    return;  -- gone, or a question: nothing to count
  end if;
  select coalesce(array_agg(left(btrim(e), 40)), '{}') into v_effects
  from (select e from unnest(coalesce(record_post_read.side_effects, '{}')) as e
        where btrim(e) <> '' limit 3) t;
  insert into public.post_reads as pr (post_id, compound_id, counts, outcome, duration, side_effects, model, read_at)
  values (record_post_read.post_id, v_compound, v_counts, v_outcome,
          nullif(left(btrim(coalesce(record_post_read.duration, '')), 40), ''), v_effects,
          record_post_read.model, now())
  on conflict on constraint post_reads_pkey do update
    set counts = excluded.counts, outcome = excluded.outcome, duration = excluded.duration,
        side_effects = excluded.side_effects, model = excluded.model, read_at = excluded.read_at
    where pr.confirmed_at is null;
end;
$$;

-- ===========================================================================
-- What members do through the API
-- ===========================================================================
create function private.confirm_read(p_post uuid, p_outcome text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_post public.posts;
  v_read public.post_reads;
begin
  if v_uid is null or not private.can_write() then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into v_post from public.posts where id = p_post;
  if v_post.id is null or v_post.author_id <> v_uid then
    raise exception 'Only the author can confirm how a report went.' using errcode = '42501';
  end if;
  if v_post.kind <> 'experience' or v_post.status <> 'visible' then
    raise exception 'Only your reports that are up can be confirmed.' using errcode = 'P0001';
  end if;
  if p_outcome is null or p_outcome not in ('better', 'same', 'worse') then
    raise exception 'Pick better, about the same or worse.' using errcode = 'P0001';
  end if;
  select * into v_read from public.post_reads where post_id = p_post;
  if v_read.post_id is null then
    -- Miracle AI hasn't read it (or couldn't tell): the author's own answer stands
    insert into public.post_reads (post_id, compound_id, counts, outcome, model, confirmed_at, corrected)
    values (p_post, v_post.compound_id, true, p_outcome, 'author', now(), true);
  else
    update public.post_reads
       set counts = true, outcome = p_outcome, confirmed_at = now(),
           corrected = v_read.corrected or v_read.outcome is distinct from p_outcome or not v_read.counts
     where post_id = p_post;
  end if;
  perform private.award(v_uid, 'confirm', p_post, null, null, '', null, false, true);
  perform private.check_badges(v_uid);
end;
$$;

-- The current period of a quest: the ISO week, or "once"
create function private.quest_period(p_cadence text) returns text
language sql stable security definer set search_path = ''
as $$
  select case when p_cadence = 'weekly'
              then to_char(date_trunc('week', now() at time zone 'utc'), 'IYYY-"W"IW')
              else 'once' end
$$;

-- How far the signed-in member is with each quest
create function private.my_quest_progress()
returns table (key text, have integer)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid,
           (date_trunc('week', now() at time zone 'utc')) at time zone 'utc' as week_start
  )
  select 'report', (select count(*)::integer from public.post_reads r join public.posts p on p.id = r.post_id, me
                    where p.author_id = me.uid and r.counts and p.status = 'visible' and p.created_at >= me.week_start)
  union all
  select 'same', (select count(*)::integer from public.same_for_me s, me
                  where s.user_id = me.uid and s.created_at >= me.week_start)
  union all
  select 'comment', (select count(*)::integer from public.comments c, me
                     where c.author_id = me.uid and c.status = 'visible' and c.created_at >= me.week_start)
  union all
  select 'vote', (select count(*)::integer from public.post_votes v, me
                  where v.user_id = me.uid and v.created_at >= me.week_start)
  union all
  select 'spaces', (select count(*)::integer from public.space_members m, me where m.user_id = me.uid)
  union all
  select 'confirm', (select count(*)::integer from public.post_reads r join public.posts p on p.id = r.post_id, me
                     where p.author_id = me.uid and r.confirmed_at is not null)
$$;

create function private.claim_quest(p_key text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  q public.quests;
  v_have integer;
  v_ref text;
begin
  if v_uid is null or not private.can_write() then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into q from public.quests where key = p_key;
  if not found then
    raise exception 'There''s no such quest.' using errcode = 'P0002';
  end if;
  select g.have into v_have from private.my_quest_progress() g where g.key = p_key;
  if coalesce(v_have, 0) < q.need then
    raise exception 'Not done yet: % of %.', coalesce(v_have, 0), q.need using errcode = 'P0001';
  end if;
  v_ref := p_key || ':' || private.quest_period(q.cadence);
  if exists (select 1 from public.points where user_id = v_uid and reason = 'quest' and ref = v_ref) then
    raise exception 'Already claimed.' using errcode = '23505';
  end if;
  perform private.award(v_uid, 'quest', null, null, null, v_ref, q.reward, false, true);
  return q.reward;
end;
$$;

create function private.mark_notifications_read() returns void
language sql security definer set search_path = ''
as $$
  update public.notifications set read_at = now()
  where user_id = (select auth.uid()) and read_at is null
$$;

-- Shared goals, closest to done first: unlock a Signal (compounds without one),
-- or take one over (this community's share of the number passes half)
create function private.community_goals()
returns table (compound_id text, compound_name text, kind text, have integer, need integer)
language sql stable security definer set search_path = ''
as $$
  with counted as (
    select r.compound_id, count(*)::integer as n
    from public.post_reads r join public.posts p on p.id = r.post_id
    where r.counts and p.status = 'visible'
    group by r.compound_id
  ), latest as (
    select distinct on (s.compound_id) s.compound_id, s.score, s.internal_share
    from public.signal_snapshots s order by s.compound_id, s.version desc
  )
  select c.id, c.name,
         case when b.compound_id is null and l.score is null then 'unlock' else 'takeover' end,
         case when b.compound_id is null and l.score is null then coalesce(k.n, 0) else coalesce(l.internal_share, 0)::integer end,
         case when b.compound_id is null and l.score is null then private.setting_int('signal_min_reports') else 50 end
  from public.compounds c
  left join public.signal_baseline b on b.compound_id = c.id
  left join latest l on l.compound_id = c.id
  left join counted k on k.compound_id = c.id
  where (select private.can_read())
$$;

create function public.confirm_read(post_id uuid, outcome text) returns void
language sql security invoker set search_path = ''
as $$ select private.confirm_read(post_id, outcome) $$;

create function public.claim_quest(quest text) returns integer
language sql security invoker set search_path = ''
as $$ select private.claim_quest(quest) $$;

create function public.mark_notifications_read() returns void
language sql security invoker set search_path = ''
as $$ select private.mark_notifications_read() $$;

-- ===========================================================================
-- What members read
-- ===========================================================================
-- The feed gains stickers, the author's emblem, the author's own check on
-- Miracle AI's read, a hot rank and whether it's in one of your spaces
create or replace view public.feed with (security_invoker = true) as
select p.id, p.compound_id, c.name as compound_name, c.category as compound_category,
       p.kind, p.title, p.body, p.status, p.status_reason, p.score,
       p.created_at, p.edited_at, p.author_id, a.handle as author_handle,
       (p.author_id = (select auth.uid())) as is_mine,
       (select v.value from public.post_votes v
        where v.post_id = p.id and v.user_id = (select auth.uid())) as my_vote,
       (select count(*) from public.comments cm
        where cm.post_id = p.id and cm.status = 'visible') as comment_count,
       coalesce(r.counts, false) and p.status = 'visible' as counts_for_signal,
       r.outcome, r.duration, coalesce(r.side_effects, '{}') as side_effects,
       p.same_count,
       exists (select 1 from public.same_for_me s
               where s.post_id = p.id and s.user_id = (select auth.uid())) as i_same,
       (r.post_id is null and p.kind = 'experience' and p.status = 'visible'
        and p.created_at > now() - interval '10 minutes') as read_pending,
       p.reactions,
       coalesce((select array_agg(x.sticker order by x.sticker) from public.post_reactions x
                 where x.post_id = p.id and x.user_id = (select auth.uid())), '{}') as my_reactions,
       coalesce(ms.level, 1) as author_level,
       r.confirmed_at is not null as read_confirmed,
       coalesce(r.corrected, false) as read_corrected,
       round((sign(p.score + p.same_count)::numeric * log(greatest(abs(p.score + p.same_count), 1)::numeric)
              + extract(epoch from p.created_at) / 45000)::numeric, 6) as hot,
       exists (select 1 from public.space_members m
               where m.compound_id = p.compound_id and m.user_id = (select auth.uid())) as in_my_spaces
from public.posts p
join public.profiles a on a.id = p.author_id
join public.compounds c on c.id = p.compound_id
left join public.post_reads r on r.post_id = p.id
left join public.member_scores ms on ms.user_id = p.author_id;

create or replace view public.thread_comments with (security_invoker = true) as
select cm.id, cm.post_id, cm.body, cm.status, cm.status_reason, cm.score,
       cm.created_at, cm.edited_at, cm.author_id, a.handle as author_handle,
       (cm.author_id = (select auth.uid())) as is_mine,
       (select v.value from public.comment_votes v
        where v.comment_id = cm.id and v.user_id = (select auth.uid())) as my_vote,
       cm.parent_id, cm.depth, coalesce(ms.level, 1) as author_level
from public.comments cm
join public.profiles a on a.id = cm.author_id
left join public.member_scores ms on ms.user_id = cm.author_id;

create view public.spaces with (security_invoker = true) as
select c.id as compound_id, c.name, c.category, c.members_count,
       exists (select 1 from public.space_members m
               where m.compound_id = c.id and m.user_id = (select auth.uid())) as joined,
       (select count(*) from public.posts p
        where p.compound_id = c.id and p.status = 'visible' and p.created_at > now() - interval '7 days') as posts_week,
       (select count(*) from public.post_reads r join public.posts p on p.id = r.post_id
        where r.compound_id = c.id and r.counts and p.status = 'visible') as reports,
       b.score, b.prev_score, b.internal_share, b.first_hand, b.same_for_me, b.summary_label, b.confidence_label
from public.compounds c
left join public.signal_board b on b.compound_id = c.id;

create view public.member_cards with (security_invoker = true) as
select p.id, p.handle, p.role, p.created_at,
       row_number() over (order by p.created_at, p.id) as member_no,
       coalesce(s.total, 0) as points,
       coalesce(s.level, 1) as level, l.name as level_name, l.tier,
       (select min(n.min_points) from public.levels n where n.min_points > coalesce(s.total, 0)) as next_level_at,
       case when s.month_key = to_char(now() at time zone 'utc', 'YYYY-MM') then s.month_total else 0 end as month_points,
       case when s.last_active_day >= (now() at time zone 'utc')::date - 1 then coalesce(s.streak_days, 0) else 0 end as streak_days,
       coalesce(s.best_streak, 0) as best_streak,
       (select count(*) from public.posts x where x.author_id = p.id and x.status = 'visible') as posts,
       (select count(*) from public.comments x where x.author_id = p.id and x.status = 'visible') as comments,
       (select count(*) from public.post_reads r join public.posts x on x.id = r.post_id
        where x.author_id = p.id and r.counts and x.status = 'visible') as reports,
       coalesce((select array_agg(mb.badge order by bd.sort) from public.member_badges mb
                 join public.badges bd on bd.key = mb.badge where mb.user_id = p.id), '{}') as badges,
       (p.id = (select auth.uid())) as is_me
from public.profiles p
left join public.member_scores s on s.user_id = p.id
left join public.levels l on l.n = coalesce(s.level, 1);

create view public.signal_builders with (security_invoker = true) as
select rank() over (order by s.month_total desc) as rank,
       p.id, p.handle, s.month_total as points, s.level, l.name as level_name,
       (p.id = (select auth.uid())) as is_me
from public.member_scores s
join public.profiles p on p.id = s.user_id
join public.levels l on l.n = s.level
where s.month_key = to_char(now() at time zone 'utc', 'YYYY-MM') and s.month_total > 0;

create view public.my_points with (security_invoker = true) as
select pt.id, pt.reason, pt.amount, pt.post_id, pt.comment_id, pt.ref, pt.void, pt.created_at, pr.label
from public.points pt
join public.point_rules pr on pr.reason = pt.reason
where pt.user_id = (select auth.uid());

create view public.my_quests with (security_invoker = true) as
select q.key, q.title, q.description, q.need, q.reward, q.cadence, q.sort,
       least(coalesce(g.have, 0), q.need) as have,
       exists (select 1 from public.points pt
               where pt.user_id = (select auth.uid()) and pt.reason = 'quest'
                 and pt.ref = q.key || ':' || private.quest_period(q.cadence)) as claimed
from public.quests q
left join private.my_quest_progress() g on g.key = q.key;

create view public.community_goals with (security_invoker = true) as
select g.compound_id, g.compound_name, g.kind, g.have, g.need,
       round(100.0 * least(g.have, g.need) / g.need) as pct
from private.community_goals() g;

create view public.community_pulse with (security_invoker = true) as
with counted as (
  select r.post_id, p.created_at
  from public.post_reads r join public.posts p on p.id = r.post_id
  where r.counts and p.status = 'visible'
), season as (
  select s.* from public.seasons s
  where (now() at time zone 'utc')::date between s.starts and s.ends
  order by s.n desc limit 1
)
select (select count(*) from public.profiles) as members,
       (select count(*) from public.profiles where created_at > now() - interval '7 days') as members_week,
       (select count(*) from counted) as reports,
       (select count(*) from counted where created_at > now() - interval '7 days') as reports_week,
       (select coalesce(sum(same_count), 0) from public.posts where status = 'visible') as same_total,
       (select count(*) from public.signal_snapshots
        where version > 1 and computed_at > now() - interval '24 hours') as moves_today,
       (select count(*) from public.signal_board where score is not null) as signals,
       (select count(*) from public.signal_board where internal_share >= 50) as community_signals,
       (select name from season) as season_name,
       (select starts from season) as season_starts,
       (select ends from season) as season_ends,
       (select goal_reports from season) as season_goal,
       (select count(*) from counted c, season s
        where c.created_at >= s.starts and c.created_at < s.ends + 1) as season_reports;

create view public.signal_history with (security_invoker = true) as
select s.compound_id, s.version, s.score, s.cause, s.computed_at,
       s.score - lag(s.score) over (partition by s.compound_id order by s.version) as delta
from public.signal_snapshots s;

create view public.signal_moves with (security_invoker = true) as
select h.compound_id, c.name as compound_name, h.version, h.score, h.delta, h.cause, h.computed_at
from public.signal_history h
join public.compounds c on c.id = h.compound_id
where h.version > 1 and h.delta is not null and h.delta <> 0;

create view public.my_notifications with (security_invoker = true) as
select n.id, n.kind, n.post_id, n.comment_id, coalesce(n.compound_id, p.compound_id) as compound_id,
       n.data, n.read_at, n.created_at,
       p.title as post_title, cm.body as comment_body, a.handle as actor_handle, c.name as compound_name
from public.notifications n
left join public.posts p on p.id = n.post_id
left join public.comments cm on cm.id = n.comment_id
left join public.profiles a on a.id = cm.author_id
left join public.compounds c on c.id = coalesce(n.compound_id, p.compound_id)
where n.user_id = (select auth.uid());

-- ===========================================================================
-- Members who joined before this migration
-- ===========================================================================
insert into public.member_scores (user_id) select id from public.profiles on conflict do nothing;
insert into public.member_badges (user_id, badge)
select id, 'founding' from public.profiles where trusted on conflict do nothing;

-- ===========================================================================
-- Access: revoke, grant only what's needed, Row Level Security with one policy
-- per action (the same pattern as the foundation)
-- ===========================================================================
revoke all on public.levels, public.point_rules, public.badges, public.quests, public.seasons,
  public.space_members, public.post_reactions, public.points, public.member_scores,
  public.member_badges, public.notifications from anon, authenticated;
revoke all on public.spaces, public.member_cards, public.signal_builders, public.my_points,
  public.my_quests, public.community_goals, public.community_pulse, public.signal_history,
  public.signal_moves, public.my_notifications from anon, authenticated;
revoke execute on function public.confirm_read(uuid, text), public.claim_quest(text),
  public.mark_notifications_read() from public, anon, authenticated;

grant select on public.levels, public.point_rules, public.badges, public.quests, public.seasons to authenticated;
grant select, delete on public.space_members to authenticated;
grant insert (compound_id) on public.space_members to authenticated;
grant select, delete on public.post_reactions to authenticated;
grant insert (post_id, sticker) on public.post_reactions to authenticated;
grant select (id, user_id, reason, amount, post_id, comment_id, ref, void, created_at) on public.points to authenticated;
grant select on public.member_scores, public.member_badges to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant insert (post_id, body, parent_id) on public.comments to authenticated;
grant select on public.spaces, public.member_cards, public.signal_builders, public.my_points,
  public.my_quests, public.community_goals, public.community_pulse, public.signal_history,
  public.signal_moves, public.my_notifications, public.feed, public.thread_comments to authenticated;

grant execute on function public.confirm_read(uuid, text) to authenticated;
grant execute on function public.claim_quest(text) to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function private.confirm_read(uuid, text) to authenticated;
grant execute on function private.claim_quest(text) to authenticated;
grant execute on function private.mark_notifications_read() to authenticated;
grant execute on function private.my_quest_progress() to authenticated;
grant execute on function private.quest_period(text) to authenticated;
grant execute on function private.community_goals() to authenticated;

alter table public.levels enable row level security;
alter table public.point_rules enable row level security;
alter table public.badges enable row level security;
alter table public.quests enable row level security;
alter table public.seasons enable row level security;
alter table public.space_members enable row level security;
alter table public.post_reactions enable row level security;
alter table public.points enable row level security;
alter table public.member_scores enable row level security;
alter table public.member_badges enable row level security;
alter table public.notifications enable row level security;

create policy "members read levels" on public.levels
  for select to authenticated using ((select private.can_read()));
create policy "members read point rules" on public.point_rules
  for select to authenticated using ((select private.can_read()));
create policy "members read badges" on public.badges
  for select to authenticated using ((select private.can_read()));
create policy "members read quests" on public.quests
  for select to authenticated using ((select private.can_read()));
create policy "members read seasons" on public.seasons
  for select to authenticated using ((select private.can_read()));

-- Who joined which space stays private; the count is on the compound
create policy "read own spaces" on public.space_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy "join spaces" on public.space_members
  for insert to authenticated with check (user_id = (select auth.uid()) and (select private.can_read()));
create policy "leave spaces" on public.space_members
  for delete to authenticated using (user_id = (select auth.uid()));

-- Who put which sticker stays private; the counts are on the post
create policy "read own stickers" on public.post_reactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "add stickers" on public.post_reactions
  for insert to authenticated with check (user_id = (select auth.uid()) and (select private.can_write()));
create policy "take back stickers" on public.post_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

-- Your own points history; everyone's totals (like karma) and badges
create policy "read own points" on public.points
  for select to authenticated using (user_id = (select auth.uid()));
create policy "members read scores" on public.member_scores
  for select to authenticated using ((select private.can_read()));
create policy "members read badges earned" on public.member_badges
  for select to authenticated using ((select private.can_read()));

create policy "read own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "mark own notifications read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "clear own notifications" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

-- ===========================================================================
-- Live: the Signal, notifications and new posts stream to the app (Supabase
-- Realtime checks each subscriber against the policies above)
-- ===========================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.signal_snapshots, public.notifications, public.posts;
  end if;
end $$;
