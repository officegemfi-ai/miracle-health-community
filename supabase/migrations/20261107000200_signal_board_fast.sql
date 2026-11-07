-- The Signal board and the public snapshot read each compound's newest versions through the
-- (compound_id, version) index, instead of numbering every version ever saved.
--
-- Every report adds a version to public.signal_snapshots, so the history only grows. The board
-- numbered all of it with a window function to find each compound's newest and second-newest
-- versions, and sorted all of it twice more for the week-old and first scores. The snapshot did the
-- same for each Signal's last 40 points. Since the snapshot is now published every minute
-- (migration 20261107000100), that cost is paid every minute. With 2,000 versions per Signal
-- (102,000 rows) it took 5.4 seconds; with these lookups it takes 84 ms, for exactly the same
-- result. At today's size it costs about the same (23 ms before, 27 ms after).
--
-- The snapshot also turns JIT compilation off. The planner's estimates for these per-compound
-- lookups cross its JIT threshold, and compiling the plan took 175 ms, longer than running it.

-- ===========================================================================
-- 1. The board: each compound's newest version, the one before it, the newest a week old, and
--    the first, each found through the index
-- ===========================================================================
create or replace view public.signal_board with (security_invoker = true) as
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
       cur.went_better as reports_better, cur.went_same as reports_same, cur.went_worse as reports_worse,
       w.ci[1] as better_pct, w.ci[2] as better_low, w.ci[3] as better_high,
       cur.side_effects as side_effects_top,
       cur.by_use,
       cur.watch, cur.serious as serious_reports, cur.checkins, cur.held as held_reports,
       coalesce(wk.score, fs.score) as week_score
from public.compounds c
cross join lateral (
  select s.* from public.signal_snapshots s
  where s.compound_id = c.id order by s.version desc limit 1) cur
left join lateral (
  select s.score from public.signal_snapshots s
  where s.compound_id = c.id order by s.version desc offset 1 limit 1) prev on true
left join lateral (
  select s.score from public.signal_snapshots s
  where s.compound_id = c.id and s.score is not null and s.computed_at <= now() - interval '7 days'
  order by s.version desc limit 1) wk on true
left join lateral (
  select s.score from public.signal_snapshots s
  where s.compound_id = c.id and s.score is not null
  order by s.version asc limit 1) fs on true
cross join lateral (select private.wilson(cur.went_better, cur.went_better + cur.went_same + cur.went_worse) as ci) w;

-- ===========================================================================
-- 2. The public snapshot: each Signal's last 40 points through the index; no JIT
-- ===========================================================================
create or replace function private.public_snapshot() returns jsonb
language sql stable security definer set search_path = '' set jit = off
as $$
  with board as (
    select b.*, (b.reports_better + b.reports_same + b.reports_worse) as reports_read
    from public.signal_board b where b.score is not null
  ), hist as (
    select c.id as compound_id,
           jsonb_agg(jsonb_build_array(h.version, h.score, h.internal_share) order by h.version) as points
    from public.compounds c
    cross join lateral (
      select s.version, s.score, s.internal_share from public.signal_snapshots s
      where s.compound_id = c.id and s.score is not null
      order by s.version desc limit 40) h
    group by c.id
  ), spaces as (
    select c.id, c.members_count,
           (select count(*) from public.posts p where p.compound_id = c.id and p.status = 'visible') as posts
    from public.compounds c where c.kind <> 'stack'
  ), counts as (
    select fc.compound_id,
           jsonb_agg(jsonb_build_object(
             'source', fc.source, 'use', fc.use_id, 'posts', fc.posts,
             'positive_pct', case when fc.posts > 0 then round(100.0 * fc.positive / fc.posts)::integer end,
             'mixed_pct', case when fc.posts > 0 then round(100.0 * fc.mixed / fc.posts)::integer end,
             'negative_pct', case when fc.posts > 0 then round(100.0 * fc.negative / fc.posts)::integer end,
             'from', fc.period_start, 'to', fc.period_end, 'method', fc.method)
             order by fc.posts desc) as list
    from private.forum_counts fc
    where fc.terms_ok and fc.posts > 0
    group by fc.compound_id
  ), moves as (
    select b.compound_id, b.compound_name, b.week_score, b.score
    from board b
    where b.week_score is not null and b.score is distinct from b.week_score
    order by abs(b.score - b.week_score) desc, b.compound_name
    limit 8
  ), mm as (
    select private.setting_int('public_min_mentions') as n
  )
  select jsonb_build_object(
    'generated_at', now(),
    'community', (select to_jsonb(x) from (
      select p.members, p.reports, p.reports_week, p.same_total, p.moves_today, p.signals, p.community_signals,
             p.community_share, p.external_weight, p.cert_forum, p.cert_early, p.cert_backed, p.cert_verified, p.cert_certified
      from public.community_pulse p) x),
    'uses', (select jsonb_object_agg(u.id, jsonb_build_array(u.label, u.goal)) from public.signal_uses u),
    'signals', coalesce((select jsonb_object_agg(b.compound_id, jsonb_build_object(
        'name', b.compound_name, 'kind', b.kind, 'score', b.score, 'prev', b.prev_score, 'week', b.week_score,
        'efficacy', b.efficacy, 'consistency', b.consistency, 'diversity', b.diversity, 'confidence', b.confidence,
        'confidence_label', b.confidence_label, 'summary_label', b.summary_label,
        'first_hand', b.first_hand, 'same_for_me', b.same_for_me, 'voices', b.voices, 'internal_share', b.internal_share,
        'certification', b.certification, 'themes', b.themes, 'source_families', b.source_families,
        'outcomes', case when b.reports_read >= 3 then jsonb_build_object(
            'better', b.reports_better, 'same', b.reports_same, 'worse', b.reports_worse,
            'better_pct', b.better_pct, 'better_low', b.better_low, 'better_high', b.better_high) end,
        'side_effects', coalesce((select jsonb_agg(e) from jsonb_array_elements(b.side_effects_top) e
                                  where (e->>'n')::integer >= mm.n), '[]'::jsonb),
        'watch', coalesce((select jsonb_agg(e) from jsonb_array_elements(b.watch) e
                           where (e->>'n')::integer >= mm.n), '[]'::jsonb),
        'serious', case when b.serious_reports >= mm.n then b.serious_reports end,
        'checkins', case when coalesce((b.checkins->>'reports')::integer, 0) >= 3 then b.checkins end,
        'by_use', coalesce((select jsonb_agg(case when u->>'rating' is not null then u
                                                  else jsonb_build_object('use', u->'use', 'forum', u->'forum') end)
                            from jsonb_array_elements(b.by_use) u
                            where u->>'rating' is not null or u->>'forum' is not null), '[]'::jsonb),
        'forum_counts', ct.list,
        'history', coalesce(h.points, '[]'::jsonb)))
      from board b cross join mm
      left join hist h on h.compound_id = b.compound_id
      left join counts ct on ct.compound_id = b.compound_id), '{}'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('id', m.compound_id, 'name', m.compound_name,
                                                           'from', m.week_score, 'to', m.score))
                       from moves m), '[]'::jsonb),
    'focus', coalesce((select jsonb_agg(jsonb_build_object('id', f.compound_id, 'name', f.compound_name,
                                                           'use', f.use_id, 'label', f.use_label, 'goal', f.goal,
                                                           'reports', f.reports) order by f.sort)
                       from public.focus_progress f), '[]'::jsonb),
    'spaces', coalesce((select jsonb_object_agg(s.id, jsonb_build_array(s.members_count, s.posts))
                        from spaces s where s.members_count > 0 or s.posts > 0), '{}'::jsonb)
  )
$$;
