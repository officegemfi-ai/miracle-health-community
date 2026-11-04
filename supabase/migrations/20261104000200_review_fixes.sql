-- Fixes from an independent review of 20261104000100_reports_weighted.sql, before it went live:
--
-- 1. What an author writes into their report's read is checked: how long must be a length of
--    time ("6 weeks", "1–3 months"), and a side effect they add must be one of the names the
--    side-effect watch counts. Totals (the Signal's side effects, the watch, the public numbers)
--    count only those names, so no free text reaches them.
-- 2. A copy is the same words as an earlier post by someone else, earlier by when its words were
--    written (an edit counts from the edit), so an old post edited to match a new report is the
--    copy, and reposting your own report is a repeat, not a copy.
-- 3. A burst counts accounts, not posts, within any 48 hours, and takes in "same for me" taps
--    from week-old accounts. A "same for me" is weighed on its own (who tapped, when),
--    whatever happened to the report it was tapped on.
-- 4. Each use's starting point is pooled from the weighted reports, holds included.
-- 5. A rating's likely range uses the reports' effective number (Kish), not the sum of weights.
-- 6. A question or a comment that describes a reaction that sounds serious gets the same note as
--    a report (and the writer the same note in the bell); moderators see them all in one list.
-- 7. A check-in is taken only for the week that's due; answering it clears every reminder for
--    that report.

-- ===========================================================================
-- 1. What an author can write into the read
-- ===========================================================================
-- "crash" is fatigue (it had a name of its own that no one would pick)
update private.effect_terms set effect = 'Fatigue' where effect = 'Lethargy after dosing';

-- The one name a side effect takes, only when it's one the side-effect watch counts
create function private.effect_known(p text) returns text
language sql stable security definer set search_path = ''
as $$
  select e.effect from private.effect_terms e where e.effect = private.effect_name(p) limit 1
$$;

-- A side effect in a few plain words: letters only, no web addresses, codes, sellers or amounts
create function private.effect_ok(p text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    btrim(p) ~ '^[A-Za-z][A-Za-z''’ -]{1,39}$'
    and array_length(regexp_split_to_array(btrim(p), '\s+'), 1) <= 4
    and lower(btrim(p)) !~ '\m(com|net|org|io|www|https?|dot|codes?|coupons?|promo|discount|buy|bought|sells?|sellers?|vendors?|shops?|stores?|order|ordered|sourced?|suppliers?|pharmac(y|ies)|labs?|telegram|whatsapp|discord|reddit|email|dm|mcg|mg|iu|ml|units?)\M',
    false)
$$;

-- How long, as a length of time: "6 weeks", "1–3 months", "under a week", "6 months or more"
create function private.duration_ok(p text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(lower(btrim(p)) ~ '^((under|about|over|almost|nearly|around|just over|just under) )?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|a few|a couple of|[0-9]{1,3}([.,][0-9])?)( ?(-|–|to) ?[0-9]{1,3})?\+? ?(day|days|week|weeks|month|months|year|years)( or more)?$', false)
$$;

-- At most three, once each, by their one name, in the order given; anything that isn't a few
-- plain words is left out
create or replace function private.clean_effects(p text[]) returns text[]
language sql stable set search_path = ''
as $$
  select coalesce(array_agg(y.effect order by y.o), '{}')
  from (
    select x.effect, x.o
    from (
      select distinct on (private.effect_name(t.e)) private.effect_name(t.e) as effect, t.o
      from unnest(coalesce(p, '{}'::text[])) with ordinality as t (e, o)
      where private.effect_name(t.e) is not null and private.effect_ok(private.effect_name(t.e))
      order by private.effect_name(t.e), t.o
    ) x
    order by x.o
    limit 3
  ) y
$$;

-- The names a member can pick from when they add a side effect
create function private.side_effect_names() returns setof text
language sql stable security definer set search_path = ''
as $$ select distinct e.effect from private.effect_terms e order by 1 $$;
create function public.side_effect_names() returns setof text
language sql stable security invoker set search_path = ''
as $$ select private.side_effect_names() $$;

create or replace function private.fix_read(
  p_post uuid, p_outcome text, p_duration text, p_uses jsonb, p_side_effects text[], p_confirm boolean
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_post public.posts;
  v_read public.post_reads;
  v_outcome text;
  v_duration text;
  v_effects text[];
  v_uses jsonb;
  v_changed boolean;
begin
  if v_uid is null or not private.can_write() then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into v_post from public.posts where id = p_post;
  if v_post.id is null or v_post.author_id <> v_uid then
    raise exception 'Only the author can confirm or fix how their report was read.' using errcode = '42501';
  end if;
  if v_post.kind <> 'experience' or v_post.status <> 'visible' then
    raise exception 'Only your reports that are up can be confirmed.' using errcode = 'P0001';
  end if;
  if p_outcome is not null and p_outcome not in ('better', 'same', 'worse') then
    raise exception 'Pick better, about the same or worse.' using errcode = 'P0001';
  end if;
  select * into v_read from public.post_reads where post_id = p_post;
  v_outcome := coalesce(p_outcome, case when v_read.counts then v_read.outcome end);
  if v_outcome is null then
    raise exception 'Say how it went first: better, about the same or worse.' using errcode = 'P0001';
  end if;
  -- How long: as read, or a length of time
  if nullif(btrim(coalesce(p_duration, '')), '') is not null
     and btrim(p_duration) is distinct from v_read.duration and not private.duration_ok(p_duration) then
    raise exception 'Pick how long from the list.' using errcode = 'P0001';
  end if;
  -- Side effects: as read, or picked from the names the side-effect watch counts
  if p_side_effects is not null and exists (
       select 1 from unnest(p_side_effects) e
       where nullif(btrim(coalesce(e, '')), '') is not null
         and private.effect_known(e) is null
         and not (private.effect_name(e) = any (coalesce(v_read.side_effects, '{}'::text[])))) then
    raise exception 'Pick side effects from the list.' using errcode = 'P0001';
  end if;
  v_duration := case when p_duration is null then v_read.duration
                     else nullif(left(btrim(p_duration), 40), '') end;
  v_effects := case when p_side_effects is null then coalesce(v_read.side_effects, '{}')
                    else private.clean_effects(p_side_effects) end;
  if p_uses is null then
    -- What it was for stays; each use follows a changed answer on how it went
    v_uses := case when v_read.outcome is distinct from v_outcome
                   then (select coalesce(jsonb_agg(jsonb_build_object('use', e->>'use', 'outcome', v_outcome)), '[]'::jsonb)
                         from jsonb_array_elements(coalesce(v_read.uses, '[]'::jsonb)) e)
                   else coalesce(v_read.uses, '[]'::jsonb) end;
  else
    v_uses := private.clean_uses((
      select coalesce(jsonb_agg(case
               when jsonb_typeof(e) = 'string' then jsonb_build_object('use', e #>> '{}', 'outcome', coalesce(
                 (select o->>'outcome' from jsonb_array_elements(coalesce(v_read.uses, '[]'::jsonb)) o
                  where o->>'use' = e #>> '{}' and v_read.outcome is not distinct from v_outcome limit 1), v_outcome))
               else e end), '[]'::jsonb)
      from jsonb_array_elements(case when jsonb_typeof(p_uses) = 'array' then p_uses else '[]'::jsonb end) e), v_outcome);
  end if;
  v_changed := v_read.post_id is null or not v_read.counts or v_read.outcome is distinct from v_outcome
            or v_read.duration is distinct from v_duration or v_read.side_effects is distinct from v_effects
            or v_read.uses is distinct from v_uses;
  if v_read.post_id is null then
    -- Miracle AI hasn't read it (or couldn't tell): the author's own answer stands
    insert into public.post_reads (post_id, compound_id, counts, outcome, duration, side_effects, model,
                                   confirmed_at, corrected, uses, weeks)
    values (p_post, v_post.compound_id, true, v_outcome, v_duration, v_effects, 'author',
            case when p_confirm then now() end, true, v_uses, private.weeks_of(v_duration));
  else
    update public.post_reads
       set counts = true, outcome = v_outcome, duration = v_duration, side_effects = v_effects, uses = v_uses,
           weeks = private.weeks_of(v_duration),
           confirmed_at = case when p_confirm then now() else confirmed_at end,
           corrected = corrected or v_changed
     where post_id = p_post;
  end if;
  if p_confirm then
    perform private.award(v_uid, 'confirm', p_post, null, null, '', null, false, true);
    perform private.check_badges(v_uid);
  end if;
end;
$$;

-- ===========================================================================
-- 2-3. Weighting reports: copies, bursts and "same for me"
-- ===========================================================================
-- Every contribution to a compound's Signal, with its weight (w) and, when it's held out or
-- turned down, why (held):
--   a first-hand report: 1, half for an account in its first days (new_account_days);
--     x1.25 when the author confirmed or fixed the read;
--     how long: unknown x0.85, under a week x0.6, 1-4 weeks x0.9, 1-3 months x1, 3 months+ x1.15;
--     x1.1 for each check-in, up to three;
--     outcome and uses: the latest check-in's answer, when there is one
--   a "same for me": half a report (half again for a new account)
--   held: 'repeat'      an earlier report by the same account on this compound (its latest
--                       counts), or an earlier "same for me" by the same account
--         'copy'        the same words as an earlier post by someone else (counts nothing)
--         'burst'       from a week-old account, when 5+ week-old accounts reported or tapped
--                       "same for me" on this compound within 48 hours (counts a quarter)
--         'own_report'  a "same for me" from someone whose own report on it already counts
-- A moderator can clear a copy or a burst on a report (private.signal_clears).
create or replace function private.signal_rows(p_compound text)
returns table (post_id uuid, uid uuid, kind text, outcome text, uses jsonb, w numeric, held text, fresh boolean)
language sql stable security definer set search_path = ''
as $$
  with reads as (
    select r.post_id, p.author_id as uid, p.created_at, coalesce(p.edited_at, p.created_at) as text_at,
           a.created_at as joined, p.fingerprint, p.fingerprint_head, r.outcome as read_outcome,
           r.uses as read_uses, r.confirmed_at, r.weeks,
           (select c.outcome from public.report_checkins c where c.post_id = r.post_id order by c.week desc limit 1) as now_outcome,
           (select count(*) from public.report_checkins c where c.post_id = r.post_id) as checkins,
           private.is_new_member(p.author_id) as fresh
    from public.post_reads r
    join public.posts p on p.id = r.post_id
    join public.profiles a on a.id = p.author_id
    where r.compound_id = p_compound and r.counts and p.status = 'visible'
  ), taps as (
    select s.post_id, s.user_id as uid, s.created_at, a.created_at as joined
    from public.same_for_me s
    join reads r on r.post_id = s.post_id
    join public.profiles a on a.id = s.user_id
  ), early as (
    -- What accounts in their first week did here, and when
    select x.uid, x.created_at from reads x where x.created_at - x.joined < interval '7 days'
    union all
    select t.uid, t.created_at from taps t where t.created_at - t.joined < interval '7 days'
  ), hot as (
    -- 48-hour stretches, each starting at a first-week account's report or tap, in which
    -- burst_reports or more first-week accounts acted on this compound
    select a.created_at as start
    from early a
    where (select count(distinct e.uid) from early e
           where e.created_at >= a.created_at and e.created_at <= a.created_at + interval '48 hours')
          >= private.setting_int('burst_reports')
  ), marked as (
    select x.*,
           row_number() over (partition by x.uid order by x.created_at desc, x.post_id) as nth,
           exists (select 1 from public.posts q
                   where q.id <> x.post_id and q.author_id <> x.uid
                     and q.kind = 'experience' and q.status = 'visible'
                     and coalesce(q.edited_at, q.created_at) < x.text_at
                     and (q.fingerprint = x.fingerprint
                          or (x.fingerprint_head is not null and q.fingerprint_head = x.fingerprint_head))) as copied,
           (x.created_at - x.joined < interval '7 days'
            and exists (select 1 from hot w where w.start between x.created_at - interval '48 hours' and x.created_at)) as burst,
           exists (select 1 from private.signal_clears k where k.post_id = x.post_id) as cleared
    from reads x
  ), reports as (
    select m.post_id, m.uid, 'report'::text as kind,
           coalesce(m.now_outcome, m.read_outcome) as outcome,
           case when m.now_outcome is null or m.now_outcome = m.read_outcome then m.read_uses
                else (select coalesce(jsonb_agg(jsonb_build_object('use', e->>'use', 'outcome', m.now_outcome)), '[]'::jsonb)
                      from jsonb_array_elements(m.read_uses) e) end as uses,
           case when m.nth > 1 then 'repeat'
                when m.copied and not m.cleared then 'copy'
                when m.burst and not m.cleared then 'burst' end as held,
           m.fresh,
           (case when m.fresh then 0.5 else 1.0 end)
           * (case when m.confirmed_at is not null then 1.25 else 1.0 end)
           * (case when m.weeks is null then 0.85 when m.weeks < 1 then 0.6 when m.weeks < 4 then 0.9
                   when m.weeks < 12 then 1.0 else 1.15 end)
           * (1 + 0.1 * least(m.checkins, 3)) as base
    from marked m
  ), sames as (
    select t.post_id, t.uid, 'same'::text as kind, r.outcome, r.uses,
           case when exists (select 1 from reports o where o.uid = t.uid) then 'own_report'
                when row_number() over (partition by t.uid order by t.created_at desc, t.post_id) > 1 then 'repeat'
                when t.created_at - t.joined < interval '7 days'
                     and exists (select 1 from hot w where w.start between t.created_at - interval '48 hours' and t.created_at)
                  then 'burst' end as held,
           private.is_new_member(t.uid) as fresh,
           0.5 * (case when private.is_new_member(t.uid) then 0.5 else 1.0 end) as base
    from taps t
    join reports r on r.post_id = t.post_id
  )
  select x.post_id, x.uid, x.kind, x.outcome, x.uses,
         round(case when x.held is null then x.base when x.held = 'burst' then x.base * 0.25 else 0 end, 4) as w,
         x.held, x.fresh
  from (select post_id, uid, kind, outcome, uses, held, fresh, base from reports
        union all
        select post_id, uid, kind, outcome, uses, held, fresh, base from sames) x
$$;

-- ===========================================================================
-- 4-5. Ratings by use: the starting point from weighted reports, the range from the effective
-- number of reports
-- ===========================================================================
-- What members report for each use across every compound (two even reports to start), weighed
-- as each compound's Signal weighs them (holds included)
create or replace function private.use_priors() returns table (use_id text, mean numeric)
language sql stable security definer set search_path = ''
as $$
  select u->>'use' as use_id,
         (1.0 + sum(r.w * case u->>'outcome' when 'better' then 1 when 'same' then 0.5 else 0 end)) / (2 + sum(r.w)) as mean
  from (select distinct pr.compound_id from public.post_reads pr where pr.counts) c
  cross join lateral private.signal_rows(c.compound_id) r
  cross join lateral jsonb_array_elements(r.uses) u
  where r.w > 0 and u->>'outcome' in ('better', 'same', 'worse')
  group by u->>'use'
$$;

-- rating: pooled 0-100 (better 1, about the same 0.5, worse 0), starting from pool_strength
--   reports at the average for that use and moving toward the compound's own weighted reports;
--   shown once use_min_reports reports name the use
-- low, high: its 90% range, from the effective number of reports ((sum of weights)^2 / sum of
--   squared weights), so weights above 1 don't make it look surer than the reports allow
-- own: the compound's reports alone, unpooled
-- better_pct (with better_low, better_high, a 95% Wilson interval): the share of reports that
--   went better, next to which the library shows how many improve on a placebo in trials
create or replace function private.signal_by_use(p_compound text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with per_use as (
    select u->>'use' as use_id, u->>'outcome' as outcome, r.uid, r.kind, r.w
    from private.signal_rows(p_compound) r
    cross join lateral jsonb_array_elements(r.uses) u
    where r.w > 0 and u->>'outcome' in ('better', 'same', 'worse')
  ), members as (
    select pu.use_id,
           count(*) filter (where pu.kind = 'report')::integer as reports,
           count(distinct pu.uid)::integer as voices,
           count(*) filter (where pu.kind = 'report' and pu.outcome = 'better')::integer as better,
           count(*) filter (where pu.kind = 'report' and pu.outcome = 'same')::integer as same,
           count(*) filter (where pu.kind = 'report' and pu.outcome = 'worse')::integer as worse,
           sum(pu.w) as n,
           sum(pu.w * pu.w) as n2,
           sum(pu.w * case pu.outcome when 'better' then 1 when 'same' then 0.5 else 0 end) as total
    from per_use pu
    group by pu.use_id
  ), rows as (
    select su.id, su.sort, f.label as forum,
           coalesce(m.reports, 0) as reports, coalesce(m.voices, 0) as voices,
           coalesce(m.better, 0) as better, coalesce(m.same, 0) as same, coalesce(m.worse, 0) as worse,
           m.n, m.total, case when m.n2 > 0 then m.n * m.n / m.n2 end as neff, coalesce(pr.mean, 0.5) as prior
    from public.signal_uses su
    left join members m on m.use_id = su.id
    left join private.forum_uses f on f.compound_id = p_compound and f.use_id = su.id
    left join private.use_priors() pr on pr.use_id = su.id
    where m.use_id is not null or f.use_id is not null
  ), rated as (
    select r.*, k.k,
           case when r.reports >= private.setting_int('use_min_reports') and r.n > 0
                then (k.k * r.prior + r.total) / (k.k + r.n) end as mean,
           case when r.reports >= private.setting_int('use_min_reports') then private.wilson(r.better, r.reports) end as ci
    from rows r
    cross join (select greatest(private.setting_int('pool_strength'), 0)::numeric as k) k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'use', r.id, 'rating', round(100 * r.mean)::integer,
           'low', case when r.mean is not null then greatest(0, round(100 * (r.mean - 1.645 * sqrt(r.mean * (1 - r.mean) / (r.k + r.neff + 1)))))::integer end,
           'high', case when r.mean is not null then least(100, round(100 * (r.mean + 1.645 * sqrt(r.mean * (1 - r.mean) / (r.k + r.neff + 1)))))::integer end,
           'own', case when r.mean is not null then round(100 * r.total / r.n)::integer end,
           'better_pct', r.ci[1], 'better_low', r.ci[2], 'better_high', r.ci[3],
           'reports', r.reports, 'voices', r.voices,
           'better', r.better, 'same', r.same, 'worse', r.worse, 'forum', r.forum)
         order by (r.mean is not null) desc, r.reports desc,
                  case r.forum when 'Very common' then 0 when 'Common' then 1 when 'Mixed' then 2
                               when 'Occasional' then 3 else 4 end,
                  r.sort), '[]'::jsonb)
  from rated r
$$;

-- ===========================================================================
-- 1 (continued). Totals count only the names the watch knows
-- ===========================================================================
create or replace function private.signal_extras(p_compound text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with rows as (
    select * from private.signal_rows(p_compound)
  ), counted as (
    select r.post_id, r.outcome from rows r where r.kind = 'report' and r.w > 0
  ), reads as (
    select c.post_id, c.outcome, pr.side_effects, pr.serious
    from counted c join public.post_reads pr on pr.post_id = c.post_id
  ), effects as (
    select private.effect_known(e) as effect, count(distinct rd.post_id)::integer as n
    from reads rd cross join lateral unnest(rd.side_effects) as e
    where private.effect_known(e) is not null
    group by 1
  ), others as (
    select pr.post_id, pr.side_effects
    from public.post_reads pr join public.posts p on p.id = pr.post_id
    where pr.compound_id <> p_compound and pr.counts and p.status = 'visible'
  ), other_effects as (
    select private.effect_known(e) as effect, count(distinct o.post_id)::numeric as c
    from others o cross join lateral unnest(o.side_effects) as e
    where private.effect_known(e) is not null
    group by 1
  ), sizes as (
    select (select count(*) from counted)::numeric as nx, (select count(*) from others)::numeric as no
  ), tested as (
    select e.effect, e.n::numeric as a, s.nx, s.no, coalesce(oe.c, 0) as c
    from effects e cross join sizes s left join other_effects oe on oe.effect = e.effect
  ), scored as (
    select t.*,
           ((t.a + 0.5) / (t.nx + 1)) / ((t.c + 0.5) / (t.no + 1)) as ratio,
           case when t.nx > 0 and t.no > 0 and (t.a + t.c) > 0 and (t.nx + t.no - t.a - t.c) > 0 then
             (t.nx + t.no) * power(greatest(abs(t.a * (t.no - t.c) - (t.nx - t.a) * t.c) - (t.nx + t.no) / 2, 0), 2)
             / (t.nx * t.no * (t.a + t.c) * (t.nx + t.no - t.a - t.c)) end as chi2
    from tested t
  ), flagged as (
    select s.* from scored s
    where s.a >= private.setting_int('watch_min_reports') and s.no >= private.setting_int('watch_min_others')
      and s.ratio >= private.setting_int('watch_ratio') and coalesce(s.chi2, 0) >= 3.84
    order by s.ratio desc, s.a desc
    limit 3
  ), checks as (
    select c.post_id, c.week, c.still_taking, c.stop_reason,
           row_number() over (partition by c.post_id order by c.week desc) as rk
    from public.report_checkins c join counted k on k.post_id = c.post_id
  )
  select jsonb_build_object(
    'better', (select count(*) from counted where outcome = 'better'),
    'same', (select count(*) from counted where outcome = 'same'),
    'worse', (select count(*) from counted where outcome = 'worse'),
    'held', (select count(*) from rows where kind = 'report' and w = 0),
    'effects', coalesce((select jsonb_agg(jsonb_build_object('effect', x.effect, 'n', x.n) order by x.n desc, x.effect)
                         from (select * from effects order by n desc, effect limit 6) x), '[]'::jsonb),
    'watch', coalesce((select jsonb_agg(jsonb_build_object(
                         'effect', f.effect, 'n', f.a::integer, 'of', f.nx::integer,
                         'pct', round(100 * f.a / f.nx)::integer, 'others_pct', round(100 * f.c / f.no, 1),
                         'ratio', round(f.ratio, 1)) order by f.ratio desc, f.a desc)
                       from flagged f), '[]'::jsonb),
    'serious', (select count(*) from reads where serious),
    'checkins', jsonb_build_object(
      'reports', (select count(distinct post_id) from checks),
      'still', (select count(*) from checks where rk = 1 and still_taking),
      'stopped', (select count(*) from checks where rk = 1 and not still_taking),
      'reasons', coalesce((select jsonb_object_agg(x.stop_reason, x.n)
                           from (select stop_reason, count(*) as n from checks
                                 where rk = 1 and not still_taking and stop_reason is not null
                                 group by stop_reason) x), '{}'::jsonb),
      'at12', (select count(*) from checks where week = 12),
      'still12', (select count(*) from checks where week = 12 and still_taking)))
$$;

-- ===========================================================================
-- 6. A reaction that sounds serious, in a question or a comment too
-- ===========================================================================
create or replace function public.record_post_read(
  post_id uuid, counts boolean, outcome text, duration text, side_effects text[], model text,
  uses jsonb default '[]'::jsonb, serious boolean default false
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_compound text;
  v_kind text;
  v_outcome text := case when record_post_read.outcome in ('better', 'same', 'worse') then record_post_read.outcome end;
  v_counts boolean := coalesce(record_post_read.counts, false) and v_outcome is not null;
  v_duration text := nullif(left(btrim(coalesce(record_post_read.duration, '')), 40), '');
  v_effects text[];
  v_uses jsonb;
begin
  select p.compound_id, p.kind::text into v_compound, v_kind from public.posts p
  where p.id = record_post_read.post_id;
  if v_compound is null then
    return;  -- gone
  end if;
  if v_kind <> 'experience' then
    -- A question counts for nothing, but a reaction it describes that sounds serious still gets
    -- the note (and its writer the note in the bell)
    if coalesce(record_post_read.serious, false) then
      insert into public.post_reads as pr (post_id, compound_id, counts, model, read_at, serious)
      values (record_post_read.post_id, v_compound, false, record_post_read.model, now(), true)
      on conflict on constraint post_reads_pkey do update set serious = true, read_at = excluded.read_at;
    end if;
    return;
  end if;
  v_effects := private.clean_effects(record_post_read.side_effects);
  v_uses := case when v_counts then private.clean_uses(record_post_read.uses, v_outcome) else '[]'::jsonb end;
  insert into public.post_reads as pr (post_id, compound_id, counts, outcome, duration, side_effects, model,
                                       read_at, uses, weeks, serious)
  values (record_post_read.post_id, v_compound, v_counts, v_outcome, v_duration, v_effects,
          record_post_read.model, now(), v_uses, private.weeks_of(v_duration), coalesce(record_post_read.serious, false))
  on conflict on constraint post_reads_pkey do update
    set counts = excluded.counts, outcome = excluded.outcome, duration = excluded.duration,
        side_effects = excluded.side_effects, model = excluded.model, read_at = excluded.read_at,
        uses = excluded.uses, weeks = excluded.weeks, serious = excluded.serious
    where pr.confirmed_at is null;
  if not found then
    -- The author already said how it went, and that stands. The read can still say what the
    -- report was for (each use takes the author's answer), and that a reaction sounds serious.
    update public.post_reads pr
       set uses = case when pr.counts and pr.uses = '[]'::jsonb
                       then (select coalesce(jsonb_agg(jsonb_build_object('use', e->>'use', 'outcome', pr.outcome)), '[]'::jsonb)
                             from jsonb_array_elements(private.clean_uses(record_post_read.uses, pr.outcome)) e)
                       else pr.uses end,
           serious = pr.serious or coalesce(record_post_read.serious, false)
     where pr.post_id = record_post_read.post_id;
  end if;
end;
$$;

-- Comments: Miracle AI's reader says when one describes a reaction that sounds serious
alter table public.comments add column serious boolean not null default false;

create function private.record_comment_serious(p_comment uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_cm public.comments;
  v_compound text;
begin
  update public.comments set serious = true where id = p_comment and not serious
  returning * into v_cm;
  if v_cm.id is null then
    return;
  end if;
  select p.compound_id into v_compound from public.posts p where p.id = v_cm.post_id;
  perform private.notify(v_cm.author_id, 'safety', v_cm.post_id, v_cm.id, v_compound, '{}'::jsonb,
                         'safety:c:' || v_cm.id);
end;
$$;
create function public.record_comment_serious(comment_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.record_comment_serious(comment_id) $$;

create or replace view public.thread_comments with (security_invoker = true) as
select cm.id, cm.post_id, cm.body, cm.status, cm.status_reason, cm.score,
       cm.created_at, cm.edited_at, cm.author_id, a.handle as author_handle,
       (cm.author_id = (select auth.uid())) as is_mine,
       (select v.value from public.comment_votes v
        where v.comment_id = cm.id and v.user_id = (select auth.uid())) as my_vote,
       cm.parent_id, cm.depth, coalesce(ms.level, 1) as author_level,
       cm.serious
from public.comments cm
join public.profiles a on a.id = cm.author_id
left join public.member_scores ms on ms.user_id = cm.author_id;

-- For moderators: every post and comment of the last 60 days that describes a reaction that
-- sounds serious (they stay up unless they break a rule; moderators check the writer is pointed
-- to help)
create function private.serious_reads()
returns table (post_id uuid, comment_id uuid, compound_id text, compound_name text, title text,
               author_handle text, kind text, at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_moderator() then
    raise exception 'Moderators only.' using errcode = '42501';
  end if;
  return query
  select x.post_id, x.comment_id, x.compound_id, c.name, x.title, a.handle, x.kind, x.at
  from (
    select r.post_id, null::uuid as comment_id, p.compound_id, p.title, p.author_id,
           case when p.kind = 'experience' then 'report' else 'question' end as kind, r.read_at as at
    from public.post_reads r join public.posts p on p.id = r.post_id
    where r.serious and p.status = 'visible' and r.read_at > now() - interval '60 days'
    union all
    select cm.post_id, cm.id, p.compound_id, p.title, cm.author_id, 'comment', cm.created_at
    from public.comments cm join public.posts p on p.id = cm.post_id
    where cm.serious and cm.status = 'visible' and cm.created_at > now() - interval '60 days'
  ) x
  join public.compounds c on c.id = x.compound_id
  join public.profiles a on a.id = x.author_id
  order by x.at desc
  limit 100;
end;
$$;
create function public.serious_reads()
returns table (post_id uuid, comment_id uuid, compound_id text, compound_name text, title text,
               author_handle text, kind text, at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.serious_reads() $$;

-- ===========================================================================
-- 7. Check-ins: only the one that's due
-- ===========================================================================
create or replace function private.check_in(
  p_post uuid, p_week smallint, p_outcome text, p_still boolean, p_reason text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_post public.posts;
begin
  if v_uid is null or not private.can_write() then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into v_post from public.posts where id = p_post;
  if v_post.id is null or v_post.author_id <> v_uid then
    raise exception 'Only the author can say how it’s going.' using errcode = '42501';
  end if;
  if v_post.kind <> 'experience' or v_post.status <> 'visible'
     or not exists (select 1 from public.post_reads r where r.post_id = p_post and r.counts) then
    raise exception 'Only your first-hand reports that are up take check-ins.' using errcode = 'P0001';
  end if;
  if p_outcome is null or p_outcome not in ('better', 'same', 'worse') then
    raise exception 'Pick better, about the same or worse.' using errcode = 'P0001';
  end if;
  if p_still is null then
    raise exception 'Say whether you still take it.' using errcode = 'P0001';
  end if;
  -- Only the check-in that's due now: none after "I stopped", none 20 weeks on, none twice
  if p_week is null or p_week is distinct from private.checkin_due(p_post) then
    raise exception 'That check-in isn’t due.' using errcode = 'P0001';
  end if;
  insert into public.report_checkins (post_id, week, outcome, still_taking, stop_reason)
  values (p_post, p_week, p_outcome, p_still,
          case when not p_still and p_reason in ('done', 'no_effect', 'side_effects', 'cost', 'other') then p_reason end);
  perform private.award(v_uid, 'checkin', p_post, null, null, p_week::text, null, false, true);
  -- Answering clears every reminder for this report, earlier ones that were skipped too
  update public.notifications set read_at = coalesce(read_at, now())
   where user_id = v_uid and dedupe like 'checkin:' || p_post || ':%';
  perform private.signal_cause('checkin', p_post);
  perform private.signal_compute(v_post.compound_id);
end;
$$;

-- ===========================================================================
-- Access
-- ===========================================================================
revoke execute on function private.effect_known(text), private.effect_ok(text), private.duration_ok(text),
  private.side_effect_names(), private.record_comment_serious(uuid), private.serious_reads()
  from public, anon, authenticated;
revoke execute on function public.side_effect_names(), public.record_comment_serious(uuid), public.serious_reads()
  from public, anon, authenticated;
grant execute on function private.effect_ok(text) to service_role;
grant execute on function public.record_comment_serious(uuid), private.record_comment_serious(uuid) to service_role;
grant execute on function public.side_effect_names(), private.side_effect_names(),
  public.serious_reads(), private.serious_reads() to authenticated;
grant select on public.thread_comments to authenticated;

-- ===========================================================================
-- Every Signal recalculated with the fixes
-- ===========================================================================
do $$
declare
  v text;
begin
  for v in
    select c.id from public.compounds c
    where exists (select 1 from public.signal_snapshots s where s.compound_id = c.id)
       or exists (select 1 from public.signal_baseline b where b.compound_id = c.id)
    order by c.id
  loop
    perform private.signal_compute(v);
  end loop;
end $$;
