-- Miracle Health community: ratings by use.
-- Members say what they took something for, and Miracle AI reads it from each first-hand
-- report: up to three uses (the list in shared/uses.json), each with how that use went.
-- Every Signal gains a rating per use (joint pain, injury healing, sleep...), from
-- first-hand reports only, since the public forums don't rate uses; next to it, how often
-- the forums mention that use. The headline number stays the overall rating.

-- ===========================================================================
-- 1. The uses (the same list as shared/uses.json; CI checks they match)
-- ===========================================================================
create table public.signal_uses (
  id text primary key check (id ~ '^[a-z_]{2,24}$'),
  label text not null check (length(label) between 2 and 40),
  goal text not null check (goal in ('weight', 'muscle', 'recovery', 'energy', 'sleep', 'cognition',
                                     'skin', 'sexual', 'longevity', 'gut', 'immune', 'hormonal')),
  sort smallint not null unique
);
insert into public.signal_uses (id, label, goal, sort) values
  ('injury', 'Injury healing', 'recovery', 1),
  ('joints', 'Joint pain', 'recovery', 2),
  ('tendons', 'Tendons & ligaments', 'recovery', 3),
  ('training_recovery', 'Training recovery', 'recovery', 4),
  ('pain', 'Other pain', 'recovery', 5),
  ('fat_loss', 'Fat loss', 'weight', 6),
  ('appetite', 'Appetite control', 'weight', 7),
  ('blood_sugar', 'Blood sugar', 'weight', 8),
  ('muscle', 'Muscle growth', 'muscle', 9),
  ('strength', 'Strength & performance', 'muscle', 10),
  ('body_comp', 'Body composition', 'muscle', 11),
  ('energy', 'Energy', 'energy', 12),
  ('endurance', 'Endurance', 'energy', 13),
  ('sleep', 'Sleep', 'sleep', 14),
  ('focus', 'Focus & memory', 'cognition', 15),
  ('mood', 'Mood & motivation', 'cognition', 16),
  ('anxiety', 'Stress & anxiety', 'cognition', 17),
  ('skin', 'Skin', 'skin', 18),
  ('hair', 'Hair', 'skin', 19),
  ('tanning', 'Tanning', 'skin', 20),
  ('libido', 'Libido & sexual function', 'sexual', 21),
  ('aging', 'Healthy aging', 'longevity', 22),
  ('heart', 'Heart & circulation', 'longevity', 23),
  ('gut', 'Gut health', 'gut', 24),
  ('inflammation', 'Inflammation', 'gut', 25),
  ('immune', 'Immune support', 'immune', 26),
  ('testosterone', 'Testosterone', 'hormonal', 27),
  ('hormones', 'Hormone balance', 'hormonal', 28),
  ('menopause', 'Menopause symptoms', 'hormonal', 29),
  ('fertility', 'Fertility', 'hormonal', 30);

insert into private.settings (key, value, note) values
  ('use_min_reports', '3', 'First-hand reports on a use before it gets its own rating')
on conflict (key) do nothing;

-- How often the public forums mention each use, from the forum research behind the
-- Signal's starting point (its themes, sorted into uses by hand; side effects and
-- "no clear change" aren't uses and stay out)
create table private.forum_uses (
  compound_id text not null references public.compounds (id) on delete cascade,
  use_id text not null references public.signal_uses (id),
  label text not null check (label in ('Very common', 'Common', 'Mixed', 'Occasional')),
  primary key (compound_id, use_id)
);
revoke all on private.forum_uses from public, anon, authenticated;
insert into private.forum_uses (compound_id, use_id, label)
select v.compound_id, v.use_id, v.label
from (values
  ('bpc157', 'injury', 'Very common'), ('bpc157', 'joints', 'Very common'), ('bpc157', 'gut', 'Common'),
  ('tirzepatide', 'appetite', 'Very common'), ('tirzepatide', 'fat_loss', 'Very common'), ('tirzepatide', 'inflammation', 'Common'),
  ('semaglutide', 'appetite', 'Very common'), ('semaglutide', 'fat_loss', 'Very common'),
  ('pt141', 'libido', 'Very common'),
  ('tb500', 'injury', 'Very common'), ('tb500', 'joints', 'Common'),
  ('ghkcu', 'skin', 'Very common'), ('ghkcu', 'hair', 'Common'), ('ghkcu', 'injury', 'Common'),
  ('retatrutide', 'fat_loss', 'Very common'), ('retatrutide', 'energy', 'Common'), ('retatrutide', 'appetite', 'Common'),
  ('testosterone', 'libido', 'Very common'), ('testosterone', 'energy', 'Very common'), ('testosterone', 'muscle', 'Common'),
  ('ipamorelin', 'sleep', 'Very common'), ('ipamorelin', 'training_recovery', 'Common'), ('ipamorelin', 'body_comp', 'Mixed'),
  ('mt2', 'tanning', 'Very common'), ('mt2', 'libido', 'Common'),
  ('estradiol', 'menopause', 'Very common'), ('estradiol', 'sleep', 'Very common'),
  ('motsc', 'energy', 'Very common'), ('motsc', 'endurance', 'Common'), ('motsc', 'fat_loss', 'Common'),
  ('cjc1295', 'sleep', 'Very common'), ('cjc1295', 'training_recovery', 'Common'), ('cjc1295', 'body_comp', 'Mixed'),
  ('somatropin', 'training_recovery', 'Very common'), ('somatropin', 'muscle', 'Common'),
  ('semax', 'focus', 'Very common'), ('semax', 'mood', 'Common'),
  ('hcg', 'fertility', 'Very common'), ('hcg', 'libido', 'Common'),
  ('ss31', 'energy', 'Common'), ('ss31', 'endurance', 'Common'),
  ('liraglutide', 'appetite', 'Very common'), ('liraglutide', 'fat_loss', 'Common'),
  ('collagen', 'skin', 'Common'), ('collagen', 'joints', 'Common'), ('collagen', 'hair', 'Common'),
  ('melatonin', 'sleep', 'Very common'),
  ('selank', 'anxiety', 'Very common'), ('selank', 'focus', 'Common'),
  ('cerebrolysin', 'focus', 'Common'), ('cerebrolysin', 'injury', 'Common'), ('cerebrolysin', 'mood', 'Mixed'),
  ('mk677', 'sleep', 'Common'), ('mk677', 'training_recovery', 'Common'),
  ('sermorelin', 'sleep', 'Common'), ('sermorelin', 'training_recovery', 'Common'), ('sermorelin', 'energy', 'Mixed'), ('sermorelin', 'body_comp', 'Mixed'),
  ('kpv', 'gut', 'Common'), ('kpv', 'skin', 'Common'), ('kpv', 'mood', 'Occasional'),
  ('progesterone', 'sleep', 'Very common'), ('progesterone', 'mood', 'Mixed'),
  ('metformin', 'blood_sugar', 'Common'), ('metformin', 'aging', 'Common'),
  ('afamelanotide', 'tanning', 'Common'), ('afamelanotide', 'skin', 'Common'),
  ('rapamycin', 'aging', 'Common'),
  ('ta1', 'immune', 'Common'), ('ta1', 'inflammation', 'Mixed'),
  ('tesamorelin', 'fat_loss', 'Common'), ('tesamorelin', 'sleep', 'Mixed'),
  ('nad', 'energy', 'Common'), ('nad', 'focus', 'Common'),
  ('anastrozole', 'hormones', 'Common'),
  ('igf1lr3', 'muscle', 'Common'), ('igf1lr3', 'strength', 'Mixed'),
  ('kisspeptin', 'libido', 'Common'), ('kisspeptin', 'hormones', 'Mixed'),
  ('epithalon', 'sleep', 'Common'), ('epithalon', 'energy', 'Mixed'),
  ('clomiphene', 'testosterone', 'Common'), ('clomiphene', 'libido', 'Mixed'),
  ('ll37', 'immune', 'Common'), ('ll37', 'gut', 'Mixed'),
  ('dhea', 'libido', 'Common'), ('dhea', 'energy', 'Mixed'), ('dhea', 'mood', 'Mixed'),
  ('glutathione', 'skin', 'Common'), ('glutathione', 'energy', 'Mixed'), ('glutathione', 'immune', 'Mixed'),
  ('ghrp2', 'training_recovery', 'Mixed'), ('ghrp2', 'sleep', 'Mixed'),
  ('ghrp6', 'training_recovery', 'Mixed'), ('ghrp6', 'sleep', 'Mixed'),
  ('oxytocin', 'mood', 'Mixed'), ('oxytocin', 'anxiety', 'Mixed'),
  ('aod9604', 'fat_loss', 'Mixed'),
  ('gonadorelin', 'fertility', 'Mixed'),
  ('dsip', 'sleep', 'Common'),
  ('hexarelin', 'training_recovery', 'Mixed'), ('hexarelin', 'sleep', 'Mixed'),
  ('pda', 'tendons', 'Mixed'), ('pda', 'joints', 'Mixed'),
  ('dihexa', 'focus', 'Mixed'),
  ('pregnenolone', 'focus', 'Mixed'), ('pregnenolone', 'sleep', 'Mixed'), ('pregnenolone', 'mood', 'Mixed'),
  ('humanin', 'aging', 'Common'), ('humanin', 'energy', 'Occasional')
) as v (compound_id, use_id, label)
where exists (select 1 from public.compounds c where c.id = v.compound_id);

-- ===========================================================================
-- 2. What each report says it was for
-- ===========================================================================
alter table public.post_reads add column uses jsonb not null default '[]'::jsonb
  constraint post_reads_uses_check check (jsonb_typeof(uses) = 'array' and jsonb_array_length(uses) <= 3);

-- Keeps only known uses, once each, at most three, each with better, the same or worse
-- (a use without its own outcome takes the report's)
create function private.clean_uses(p_uses jsonb, p_outcome text) returns jsonb
language sql stable set search_path = ''
as $$
  with items as (
    select t.e->>'use' as use_id,
           case when t.e->>'outcome' in ('better', 'same', 'worse') then t.e->>'outcome'
                when p_outcome in ('better', 'same', 'worse') then p_outcome end as outcome,
           t.o
    from jsonb_array_elements(case when jsonb_typeof(p_uses) = 'array' then p_uses else '[]'::jsonb end)
         with ordinality as t (e, o)
    where jsonb_typeof(t.e) = 'object'
  ), firsts as (
    select distinct on (i.use_id) i.use_id, i.outcome, i.o
    from items i
    where i.outcome is not null and exists (select 1 from public.signal_uses su where su.id = i.use_id)
    order by i.use_id, i.o
  ), kept as (
    select f.* from firsts f order by f.o limit 3
  )
  select coalesce(jsonb_agg(jsonb_build_object('use', k.use_id, 'outcome', k.outcome) order by k.o), '[]'::jsonb)
  from kept k
$$;

-- Miracle AI's read now carries the uses (the review function passes them; older callers
-- that don't still work)
drop function public.record_post_read(uuid, boolean, text, text, text[], text);
create function public.record_post_read(
  post_id uuid, counts boolean, outcome text, duration text, side_effects text[], model text,
  uses jsonb default '[]'::jsonb
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_compound text;
  v_outcome text := case when record_post_read.outcome in ('better', 'same', 'worse') then record_post_read.outcome end;
  v_counts boolean := coalesce(record_post_read.counts, false) and v_outcome is not null;
  v_effects text[];
  v_uses jsonb;
begin
  select p.compound_id into v_compound from public.posts p
  where p.id = record_post_read.post_id and p.kind = 'experience';
  if v_compound is null then
    return;  -- gone, or a question: nothing to count
  end if;
  select coalesce(array_agg(left(btrim(e), 40)), '{}') into v_effects
  from (select e from unnest(coalesce(record_post_read.side_effects, '{}')) as e
        where btrim(e) <> '' limit 3) t;
  v_uses := case when v_counts then private.clean_uses(record_post_read.uses, v_outcome) else '[]'::jsonb end;
  insert into public.post_reads as pr (post_id, compound_id, counts, outcome, duration, side_effects, model, read_at, uses)
  values (record_post_read.post_id, v_compound, v_counts, v_outcome,
          nullif(left(btrim(coalesce(record_post_read.duration, '')), 40), ''), v_effects,
          record_post_read.model, now(), v_uses)
  on conflict on constraint post_reads_pkey do update
    set counts = excluded.counts, outcome = excluded.outcome, duration = excluded.duration,
        side_effects = excluded.side_effects, model = excluded.model, read_at = excluded.read_at,
        uses = excluded.uses
    where pr.confirmed_at is null;
  if not found then
    -- The author already said how it went, and that stands. The read can still say what
    -- the report was for; each use takes the author's answer.
    update public.post_reads pr
       set uses = (select coalesce(jsonb_agg(jsonb_build_object('use', e->>'use', 'outcome', pr.outcome)), '[]'::jsonb)
                   from jsonb_array_elements(private.clean_uses(record_post_read.uses, pr.outcome)) e)
     where pr.post_id = record_post_read.post_id and pr.confirmed_at is not null and pr.counts
       and pr.uses = '[]'::jsonb;
  end if;
end;
$$;

-- When the author corrects how it went, each use follows their answer
create or replace function private.confirm_read(p_post uuid, p_outcome text) returns void
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
           corrected = v_read.corrected or v_read.outcome is distinct from p_outcome or not v_read.counts,
           uses = case when v_read.outcome is distinct from p_outcome
                       then (select coalesce(jsonb_agg(jsonb_build_object('use', e->>'use', 'outcome', p_outcome)), '[]'::jsonb)
                             from jsonb_array_elements(v_read.uses) e)
                       else v_read.uses end
     where post_id = p_post;
  end if;
  perform private.award(v_uid, 'confirm', p_post, null, null, '', null, false, true);
  perform private.check_badges(v_uid);
end;
$$;

-- ===========================================================================
-- 3. A rating per use in every Signal version
-- ===========================================================================
alter table public.signal_snapshots add column by_use jsonb not null default '[]'::jsonb;

-- Each use members reported on or the forums mention: first-hand reports (and "same for
-- me" on them, weighted like the Signal, new accounts at half), better / same / worse,
-- and a 0-100 rating once enough reports name that use
create function private.signal_by_use(p_compound text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with contributions as (
    select p.author_id as uid, r.uses, 'report' as kind
    from public.post_reads r
    join public.posts p on p.id = r.post_id
    where r.compound_id = p_compound and r.counts and p.status = 'visible'
    union all
    select s.user_id, r.uses, 'same'
    from public.same_for_me s
    join public.post_reads r on r.post_id = s.post_id
    join public.posts p on p.id = s.post_id
    where r.compound_id = p_compound and r.counts and p.status = 'visible'
  ), per_use as (
    select u->>'use' as use_id, u->>'outcome' as outcome, c.uid, c.kind,
           case when private.is_new_member(c.uid) then 0.5 else 1.0 end as w
    from contributions c
    cross join lateral jsonb_array_elements(c.uses) u
    where u->>'outcome' in ('better', 'same', 'worse')
  ), members as (
    select pu.use_id,
           count(*) filter (where pu.kind = 'report')::integer as reports,
           count(distinct pu.uid)::integer as voices,
           count(*) filter (where pu.kind = 'report' and pu.outcome = 'better')::integer as better,
           count(*) filter (where pu.kind = 'report' and pu.outcome = 'same')::integer as same,
           count(*) filter (where pu.kind = 'report' and pu.outcome = 'worse')::integer as worse,
           sum(pu.w) as n,
           sum(pu.w * case pu.outcome when 'better' then 1 when 'same' then 0.5 else 0 end) as total
    from per_use pu
    group by pu.use_id
  ), rows as (
    select su.id, su.sort, f.label as forum,
           coalesce(m.reports, 0) as reports, coalesce(m.voices, 0) as voices,
           coalesce(m.better, 0) as better, coalesce(m.same, 0) as same, coalesce(m.worse, 0) as worse,
           case when coalesce(m.reports, 0) >= private.setting_int('use_min_reports') and m.n > 0
                then round(100 * m.total / m.n)::integer end as rating
    from public.signal_uses su
    left join members m on m.use_id = su.id
    left join private.forum_uses f on f.compound_id = p_compound and f.use_id = su.id
    where m.use_id is not null or f.use_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'use', r.id, 'rating', r.rating, 'reports', r.reports, 'voices', r.voices,
           'better', r.better, 'same', r.same, 'worse', r.worse, 'forum', r.forum)
         order by (r.rating is not null) desc, r.reports desc,
                  case r.forum when 'Very common' then 0 when 'Common' then 1 when 'Mixed' then 2
                               when 'Occasional' then 3 else 4 end,
                  r.sort), '[]'::jsonb)
  from rows r
$$;

-- The Signal's calculation, as before, now also keeping the ratings by use
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
  v_by_use jsonb;
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
  v_by_use := private.signal_by_use(p_compound);

  if v_prev.id is not null and v_prev.score is not distinct from v_score then
    update public.signal_snapshots
       set efficacy = round(v_eff), consistency = round(v_cons), diversity = round(v_div),
           confidence = round(v_conf), first_hand = v_reports, same_for_me = v_sames,
           voices = v_voices, internal_share = v_share, by_use = v_by_use
     where id = v_prev.id;
    return;
  end if;
  insert into public.signal_snapshots (compound_id, version, score, efficacy, consistency, diversity,
                                       confidence, first_hand, same_for_me, voices, internal_share,
                                       themes, source_families, cause, cause_post, by_use)
  values (p_compound, coalesce(v_prev.version, 0) + 1, v_score, round(v_eff), round(v_cons),
          round(v_div), round(v_conf), v_reports, v_sames, v_voices, v_share,
          coalesce(b.themes, '[]'), coalesce(b.source_families, '{}'), v_cause, v_cause_post, v_by_use);
end;
$$;

-- A change to what a report was for moves the ratings too
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
                                        or (new.counts, new.outcome, new.uses) is distinct from (old.counts, old.outcome, old.uses)) then
    perform private.signal_compute(new.compound_id);
  end if;
  return null;
end;
$$;

-- Every Signal that has forum uses gets them now (a new version only where nothing
-- else changed would be noise, so this fills the current version in place)
update public.signal_snapshots s
   set by_use = private.signal_by_use(s.compound_id)
 where s.id in (select distinct on (x.compound_id) x.id from public.signal_snapshots x
                order by x.compound_id, x.version desc);

-- ===========================================================================
-- 4. The board, the feed and the public snapshot carry them
-- ===========================================================================
create or replace view public.signal_board with (security_invoker = true) as
with ranked as (
  select s.*, row_number() over (partition by s.compound_id order by s.version desc) as rn
  from public.signal_snapshots s
), outcomes as (
  select r.compound_id,
         count(*) filter (where r.outcome = 'better')::integer as better,
         count(*) filter (where r.outcome = 'same')::integer as same,
         count(*) filter (where r.outcome = 'worse')::integer as worse
  from public.post_reads r
  join public.posts p on p.id = r.post_id
  where r.counts and p.status = 'visible'
  group by r.compound_id
), mentions as (
  select r.compound_id, initcap(lower(btrim(e.effect))) as effect, count(*)::integer as n
  from public.post_reads r
  join public.posts p on p.id = r.post_id
  cross join lateral unnest(r.side_effects) as e(effect)
  where r.counts and p.status = 'visible' and btrim(e.effect) <> ''
  group by r.compound_id, initcap(lower(btrim(e.effect)))
), effects as (
  select m.compound_id,
         jsonb_agg(jsonb_build_object('effect', m.effect, 'n', m.n) order by m.n desc, m.effect) as list
  from (select mm.*, row_number() over (partition by mm.compound_id order by mm.n desc, mm.effect) as rk
        from mentions mm) m
  where m.rk <= 6
  group by m.compound_id
)
select c.id as compound_id, c.name as compound_name, c.category,
       cur.score, prev.score as prev_score,
       cur.efficacy, cur.consistency, cur.diversity, cur.confidence,
       case when cur.confidence >= 80 then 'High' when cur.confidence >= 60 then 'Moderate'
            when cur.confidence >= 40 then 'Building' else 'Low' end as confidence_label,
       case when cur.efficacy >= 75 then 'Mostly positive' when cur.efficacy >= 60 then 'Leaning positive'
            when cur.efficacy >= 45 then 'Mixed' else 'Mostly negative' end as summary_label,
       cur.first_hand, cur.same_for_me, cur.voices, cur.internal_share,
       cur.themes, cur.source_families, cur.version, cur.computed_at,
       c.kind, c.family,
       private.certification(cur.internal_share, cur.first_hand, cur.voices, cur.confidence) as certification,
       coalesce(o.better, 0) as reports_better, coalesce(o.same, 0) as reports_same, coalesce(o.worse, 0) as reports_worse,
       w.ci[1] as better_pct, w.ci[2] as better_low, w.ci[3] as better_high,
       coalesce(ef.list, '[]'::jsonb) as side_effects_top,
       cur.by_use
from ranked cur
join public.compounds c on c.id = cur.compound_id
left join ranked prev on prev.compound_id = cur.compound_id and prev.rn = 2
left join outcomes o on o.compound_id = cur.compound_id
left join effects ef on ef.compound_id = cur.compound_id
cross join lateral (select private.wilson(coalesce(o.better, 0), coalesce(o.better, 0) + coalesce(o.same, 0) + coalesce(o.worse, 0)) as ci) w
where cur.rn = 1;

-- Each post shows what its report was for
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
               where m.user_id = (select auth.uid())
                 and (m.compound_id = p.compound_id or m.compound_id = any (p.part_ids))) as in_my_spaces,
       p.part_ids, c.kind as compound_kind,
       coalesce(r.uses, '[]'::jsonb) as read_uses
from public.posts p
join public.profiles a on a.id = p.author_id
join public.compounds c on c.id = p.compound_id
left join public.post_reads r on r.post_id = p.id
left join public.member_scores ms on ms.user_id = p.author_id;

-- The public library gets each use's rating once enough reports name it, and the forums'
-- mentions; a use with fewer reports shows only what the forums say
create or replace function private.public_snapshot() returns jsonb
language sql stable security definer set search_path = ''
as $$
  with board as (
    select b.*, (b.reports_better + b.reports_same + b.reports_worse) as reports_read
    from public.signal_board b where b.score is not null
  ), hist as (
    select h.compound_id,
           jsonb_agg(jsonb_build_array(h.version, h.score, h.internal_share) order by h.version) as points
    from (select s.compound_id, s.version, s.score, s.internal_share,
                 row_number() over (partition by s.compound_id order by s.version desc) as rk
          from public.signal_snapshots s where s.score is not null) h
    where h.rk <= 40
    group by h.compound_id
  ), spaces as (
    select c.id, c.members_count,
           (select count(*) from public.posts p where p.compound_id = c.id and p.status = 'visible') as posts
    from public.compounds c where c.kind <> 'stack'
  )
  select jsonb_build_object(
    'generated_at', now(),
    'community', (select to_jsonb(x) from (
      select p.members, p.reports, p.reports_week, p.same_total, p.moves_today, p.signals, p.community_signals,
             p.community_share, p.external_weight, p.cert_forum, p.cert_early, p.cert_backed, p.cert_verified, p.cert_certified
      from public.community_pulse p) x),
    'uses', (select jsonb_object_agg(u.id, jsonb_build_array(u.label, u.goal)) from public.signal_uses u),
    'signals', coalesce((select jsonb_object_agg(b.compound_id, jsonb_build_object(
        'name', b.compound_name, 'kind', b.kind, 'score', b.score, 'prev', b.prev_score,
        'efficacy', b.efficacy, 'consistency', b.consistency, 'diversity', b.diversity, 'confidence', b.confidence,
        'confidence_label', b.confidence_label, 'summary_label', b.summary_label,
        'first_hand', b.first_hand, 'same_for_me', b.same_for_me, 'voices', b.voices, 'internal_share', b.internal_share,
        'certification', b.certification, 'themes', b.themes, 'source_families', b.source_families,
        'outcomes', case when b.reports_read >= 3 then jsonb_build_object(
            'better', b.reports_better, 'same', b.reports_same, 'worse', b.reports_worse,
            'better_pct', b.better_pct, 'better_low', b.better_low, 'better_high', b.better_high) end,
        'side_effects', coalesce((select jsonb_agg(e) from jsonb_array_elements(b.side_effects_top) e
                                  where (e->>'n')::integer >= private.setting_int('public_min_mentions')), '[]'::jsonb),
        'by_use', coalesce((select jsonb_agg(case when u->>'rating' is not null then u
                                                  else jsonb_build_object('use', u->'use', 'forum', u->'forum') end)
                            from jsonb_array_elements(b.by_use) u
                            where u->>'rating' is not null or u->>'forum' is not null), '[]'::jsonb),
        'history', coalesce(h.points, '[]'::jsonb)))
      from board b left join hist h on h.compound_id = b.compound_id), '{}'::jsonb),
    'spaces', coalesce((select jsonb_object_agg(s.id, jsonb_build_array(s.members_count, s.posts))
                        from spaces s where s.members_count > 0 or s.posts > 0), '{}'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.signal_uses enable row level security;
create policy "members read the list of uses" on public.signal_uses for select to authenticated using (true);
revoke all on public.signal_uses from anon, authenticated;
grant select on public.signal_uses to authenticated;

revoke execute on function private.clean_uses(jsonb, text) from public, anon, authenticated;
revoke execute on function private.signal_by_use(text) from public, anon, authenticated;
revoke execute on function public.record_post_read(uuid, boolean, text, text, text[], text, jsonb) from public, anon, authenticated;
revoke execute on function private.public_snapshot() from public, anon, authenticated;
grant execute on function private.clean_uses(jsonb, text) to service_role;
grant execute on function public.record_post_read(uuid, boolean, text, text, text[], text, jsonb) to service_role;
grant select on public.signal_board, public.feed to authenticated;
