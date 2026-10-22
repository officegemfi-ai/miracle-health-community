-- Miracle Health community: the Community Signal.
--
-- One number per compound, 0 to 100: 65% reported efficacy, 15% consistency,
-- 10% diversity of voices, 10% confidence. It starts from a public-forum baseline
-- (signal_baseline, loaded by the next migration) and moves toward this
-- community's own first-hand reports: Claude reads each post for how it went
-- (post_reads), and members add "same for me" to reports that match theirs
-- (same_for_me). New accounts count half. Every change is written as a snapshot
-- (signal_snapshots); members read the latest two through signal_board. All the
-- math is in this file; the app only shows the result.

insert into private.settings (key, value, note) values
  ('signal_external_weight', '50', 'How many first-hand reports the public-forum baseline is worth'),
  ('signal_min_reports', '3', 'Weighted first-hand reports a compound needs before it gets a Signal without a baseline')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.signal_baseline (
  compound_id text primary key references public.compounds (id),
  efficacy smallint not null check (efficacy between 0 and 100),
  consistency smallint not null check (consistency between 0 and 100),
  diversity smallint not null check (diversity between 0 and 100),
  confidence smallint not null check (confidence between 0 and 100),
  themes jsonb not null default '[]',
  source_families text[] not null default '{}',
  volume_label text,
  updated_at timestamptz not null default now()
);

create table public.post_reads (
  post_id uuid primary key references public.posts (id) on delete cascade,
  compound_id text not null references public.compounds (id),
  counts boolean not null,
  outcome text check (outcome in ('better', 'same', 'worse')),
  duration text check (char_length(duration) <= 40),
  side_effects text[] not null default '{}' check (cardinality(side_effects) <= 3),
  model text,
  read_at timestamptz not null default now(),
  check (not counts or outcome is not null)
);
create index post_reads_compound_idx on public.post_reads (compound_id);

create table public.same_for_me (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index same_for_me_user_idx on public.same_for_me (user_id, created_at desc);

-- Like votes, the count lives on the post and who tapped stays private
alter table public.posts add column same_count integer not null default 0;

create table public.signal_snapshots (
  id bigint generated always as identity primary key,
  compound_id text not null references public.compounds (id),
  version integer not null,
  score numeric(4, 1) check (score between 0 and 100),
  efficacy smallint, consistency smallint, diversity smallint, confidence smallint,
  first_hand integer not null default 0,
  same_for_me integer not null default 0,
  voices integer not null default 0,
  internal_share smallint not null default 0,
  themes jsonb not null default '[]',
  source_families text[] not null default '{}',
  computed_at timestamptz not null default now(),
  unique (compound_id, version)
);

-- ---------------------------------------------------------------------------
-- The math
-- ---------------------------------------------------------------------------
-- Recomputes one compound. A new version is written when the score moves;
-- when only the counts change, the latest version is brought up to date.
create function private.signal_compute(p_compound text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  b public.signal_baseline;
  v_prev public.signal_snapshots;
  v_n numeric; v_sum numeric; v_better numeric; v_same numeric; v_worse numeric;
  v_reports integer; v_sames integer; v_voices integer;
  v_ext numeric; v_entropy numeric := 0; v_in_eff numeric := 0; v_in_cons numeric := 0;
  v_eff numeric; v_cons numeric; v_div numeric; v_conf numeric; v_score numeric; v_share smallint;
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
      insert into public.signal_snapshots (compound_id, version, score, first_hand, same_for_me, voices)
      values (p_compound, v_prev.version + 1, null, v_reports, v_sames, v_voices);
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
                                       themes, source_families)
  values (p_compound, coalesce(v_prev.version, 0) + 1, v_score, round(v_eff), round(v_cons),
          round(v_div), round(v_conf), v_reports, v_sames, v_voices, v_share,
          coalesce(b.themes, '[]'), coalesce(b.source_families, '{}'));
end;
$$;

-- ---------------------------------------------------------------------------
-- What moves it
-- ---------------------------------------------------------------------------
create function private.post_reads_signal() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
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

create function private.same_for_me_before_insert() returns trigger
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
    raise exception 'That''s your own report.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.post_reads r where r.post_id = new.post_id and r.counts) then
    raise exception 'Only first-hand reports can take a "same for me".' using errcode = 'P0001';
  end if;
  -- Shares the hourly vote allowance, so taps can't be used to flood a compound
  select (select count(*) from public.post_votes where user_id = v_uid and created_at > now() - interval '1 hour')
       + (select count(*) from public.comment_votes where user_id = v_uid and created_at > now() - interval '1 hour')
       + (select count(*) from public.same_for_me where user_id = v_uid and created_at > now() - interval '1 hour')
    into v_count;
  if v_count >= private.setting_int('votes_per_hour') then
    raise exception 'That''s a lot for one hour. Try again later.' using errcode = 'P0001', hint = 'rate_limit';
  end if;
  return new;
end;
$$;

create function private.same_for_me_after() returns trigger
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
  perform private.signal_compute((select r.compound_id from public.post_reads r where r.post_id = v_post));
  return null;
end;
$$;

-- A post going up, being held or coming down changes what counts
create function private.posts_signal_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.post_reads r where r.post_id = new.id and r.counts) then
    perform private.signal_compute(new.compound_id);
  end if;
  return null;
end;
$$;

-- An edited post is read again: the old read no longer describes it
create function private.posts_forget_read() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.post_reads where post_id = new.id;
  return null;
end;
$$;

create trigger post_reads_signal after insert or update or delete on public.post_reads
  for each row execute function private.post_reads_signal();
create trigger same_for_me_before_insert before insert on public.same_for_me
  for each row execute function private.same_for_me_before_insert();
create trigger same_for_me_after after insert or delete on public.same_for_me
  for each row execute function private.same_for_me_after();
create trigger posts_signal_status after update of status on public.posts
  for each row when (old.status is distinct from new.status)
  execute function private.posts_signal_status();
create trigger posts_forget_read after update of title, body on public.posts
  for each row when (old.title is distinct from new.title or old.body is distinct from new.body)
  execute function private.posts_forget_read();

-- Claude reads edits too (the hook from 20261021000300 only fires on new posts)
do $$
begin
  if to_regprocedure('private.queue_ai_review()') is not null then
    create trigger posts_ai_review_on_edit after update of title, body on public.posts
      for each row when (old.title is distinct from new.title or old.body is distinct from new.body)
      execute function private.queue_ai_review('post');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Writing Claude's read (the review-content function, with the service role)
-- ---------------------------------------------------------------------------
create function public.record_post_read(
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
  insert into public.post_reads (post_id, compound_id, counts, outcome, duration, side_effects, model, read_at)
  values (record_post_read.post_id, v_compound, v_counts, v_outcome,
          nullif(left(btrim(coalesce(record_post_read.duration, '')), 40), ''), v_effects,
          record_post_read.model, now())
  on conflict on constraint post_reads_pkey do update
    set counts = excluded.counts, outcome = excluded.outcome, duration = excluded.duration,
        side_effects = excluded.side_effects, model = excluded.model, read_at = excluded.read_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- What members read
-- ---------------------------------------------------------------------------
create view public.signal_board with (security_invoker = true) as
with ranked as (
  select s.*, row_number() over (partition by s.compound_id order by s.version desc) as rn
  from public.signal_snapshots s
)
select c.id as compound_id, c.name as compound_name, c.category,
       cur.score, prev.score as prev_score,
       cur.efficacy, cur.consistency, cur.diversity, cur.confidence,
       case when cur.confidence >= 80 then 'High' when cur.confidence >= 60 then 'Moderate'
            when cur.confidence >= 40 then 'Building' else 'Low' end as confidence_label,
       case when cur.efficacy >= 75 then 'Mostly positive' when cur.efficacy >= 60 then 'Leaning positive'
            when cur.efficacy >= 45 then 'Mixed' else 'Mostly negative' end as summary_label,
       cur.first_hand, cur.same_for_me, cur.voices, cur.internal_share,
       cur.themes, cur.source_families, cur.version, cur.computed_at
from ranked cur
join public.compounds c on c.id = cur.compound_id
left join ranked prev on prev.compound_id = cur.compound_id and prev.rn = 2
where cur.rn = 1;

-- The feed gains what Claude read in each post, and "same for me"
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
        and p.created_at > now() - interval '10 minutes') as read_pending
from public.posts p
join public.profiles a on a.id = p.author_id
join public.compounds c on c.id = p.compound_id
left join public.post_reads r on r.post_id = p.id;

-- ---------------------------------------------------------------------------
-- Access: the same pattern as the foundation (revoke, grant only what's needed,
-- Row Level Security with one policy per action)
-- ---------------------------------------------------------------------------
revoke all on public.signal_baseline, public.post_reads, public.same_for_me, public.signal_snapshots
  from anon, authenticated;
revoke all on public.signal_board from anon, authenticated;
revoke execute on function public.record_post_read(uuid, boolean, text, text, text[], text) from public, anon, authenticated;
revoke execute on function private.signal_compute(text) from public, anon, authenticated;

grant select on public.post_reads to authenticated;
grant select on public.same_for_me to authenticated;
grant insert (post_id) on public.same_for_me to authenticated;
grant delete on public.same_for_me to authenticated;
grant select on public.signal_snapshots to authenticated;
grant select on public.signal_board, public.feed to authenticated;
grant execute on function public.record_post_read(uuid, boolean, text, text, text[], text) to service_role;

alter table public.signal_baseline enable row level security;
alter table public.post_reads enable row level security;
alter table public.same_for_me enable row level security;
alter table public.signal_snapshots enable row level security;

-- The baseline is read only by the scoring function (it runs as the owner)
create policy "nobody reads the baseline directly" on public.signal_baseline
  for select to authenticated using (false);

-- Reads follow the posts: members see the read of any post they can see
create policy "members read post reads" on public.post_reads
  for select to authenticated
  using ((select private.can_read()) and exists (select 1 from public.posts p where p.id = post_reads.post_id));
-- (Only Claude's read writes them: record_post_read runs as the service role,
-- which bypasses Row Level Security, as it does for ai_reviews.)

-- "Same for me": members see and change only their own
create policy "read own same for me" on public.same_for_me
  for select to authenticated using (user_id = (select auth.uid()));
create policy "add same for me" on public.same_for_me
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.can_write()));
create policy "take back same for me" on public.same_for_me
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "members read the Signal" on public.signal_snapshots
  for select to authenticated using ((select private.can_read()));
