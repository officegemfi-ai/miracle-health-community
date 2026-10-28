-- Miracle Health community: the Signal as a certificate of human anecdotal data.
--
-- Every Signal starts from public forums and moves toward first-hand reports from members
-- here (signal_external_weight: the forums count as 50 reports). Each Signal now says how
-- far along that line it is, and earns a level for it:
--   forum      Forum data           mostly public forums so far
--   early      Early signal         members' reports only, still few of them
--   backed     Community-backed     25% or more from members, 10+ first-hand reports
--   verified   Community-verified   50% or more, 25+ reports from 15+ independent members
--   certified  Signal Certified     75% or more, 50+ reports, 30+ members, confidence 60+
-- The thresholds are settings, so moderators can tune them without a code change.
--
-- The board also carries the measuring tools: how first-hand reports split (better, about
-- the same, worse), a 95% interval for the share that went better, and the side effects
-- people mention most. And a snapshot function gathers community totals for the public
-- library (no names, no posts; a side effect has to come up in three reports first).
-- All of it is counted here; the app and the library only show it.

insert into private.settings (key, value, note) values
  ('cert_backed_share', '25', 'Share of a Signal from members here (%) for Community-backed'),
  ('cert_backed_reports', '10', 'First-hand reports for Community-backed'),
  ('cert_verified_share', '50', 'Share from members (%) for Community-verified'),
  ('cert_verified_reports', '25', 'First-hand reports for Community-verified'),
  ('cert_verified_voices', '15', 'Independent members for Community-verified'),
  ('cert_certified_share', '75', 'Share from members (%) for Signal Certified'),
  ('cert_certified_reports', '50', 'First-hand reports for Signal Certified'),
  ('cert_certified_voices', '30', 'Independent members for Signal Certified'),
  ('cert_certified_confidence', '60', 'Confidence (0-100) for Signal Certified'),
  ('public_min_mentions', '3', 'Reports that must mention a side effect before the public library shows it')
on conflict (key) do nothing;

create function private.certification(p_share integer, p_reports integer, p_voices integer, p_confidence integer)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when coalesce(p_share, 0) >= private.setting_int('cert_certified_share')
     and coalesce(p_reports, 0) >= private.setting_int('cert_certified_reports')
     and coalesce(p_voices, 0) >= private.setting_int('cert_certified_voices')
     and coalesce(p_confidence, 0) >= private.setting_int('cert_certified_confidence') then 'certified'
    when coalesce(p_share, 0) >= private.setting_int('cert_verified_share')
     and coalesce(p_reports, 0) >= private.setting_int('cert_verified_reports')
     and coalesce(p_voices, 0) >= private.setting_int('cert_verified_voices') then 'verified'
    when coalesce(p_share, 0) >= private.setting_int('cert_backed_share')
     and coalesce(p_reports, 0) >= private.setting_int('cert_backed_reports') then 'backed'
    when coalesce(p_share, 0) >= private.setting_int('cert_backed_share') then 'early'
    else 'forum'
  end
$$;

-- What the public forums are worth, in first-hand reports (members can read this one setting)
create function private.external_weight() returns integer
language sql stable security definer set search_path = ''
as $$ select private.setting_int('signal_external_weight') $$;

-- A 95% Wilson interval for k of n, in whole percent: [estimate, low, high]
create function private.wilson(p_k integer, p_n integer) returns integer[]
language sql immutable set search_path = ''
as $$
  select case when coalesce(p_n, 0) <= 0 then null else array[
    round(100.0 * p_k / p_n)::integer,
    round(100 * greatest(0, ((p_k::numeric / p_n + 1.9208 / p_n)
      - 1.96 * sqrt((p_k::numeric / p_n) * (1 - p_k::numeric / p_n) / p_n + 0.9604 / (p_n::numeric * p_n)))
      / (1 + 3.8416 / p_n)))::integer,
    round(100 * least(1, ((p_k::numeric / p_n + 1.9208 / p_n)
      + 1.96 * sqrt((p_k::numeric / p_n) * (1 - p_k::numeric / p_n) / p_n + 0.9604 / (p_n::numeric * p_n)))
      / (1 + 3.8416 / p_n)))::integer] end
$$;

-- ---------------------------------------------------------------------------
-- The board gains the level and the measuring tools
-- ---------------------------------------------------------------------------
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
       coalesce(ef.list, '[]'::jsonb) as side_effects_top
from ranked cur
join public.compounds c on c.id = cur.compound_id
left join ranked prev on prev.compound_id = cur.compound_id and prev.rn = 2
left join outcomes o on o.compound_id = cur.compound_id
left join effects ef on ef.compound_id = cur.compound_id
cross join lateral (select private.wilson(coalesce(o.better, 0), coalesce(o.better, 0) + coalesce(o.same, 0) + coalesce(o.worse, 0)) as ci) w
where cur.rn = 1;

-- How far each version had moved from the forums to members
create or replace view public.signal_history with (security_invoker = true) as
select s.compound_id, s.version, s.score, s.cause, s.computed_at,
       s.score - lag(s.score) over (partition by s.compound_id order by s.version) as delta,
       s.internal_share
from public.signal_snapshots s;

-- The pulse gains the whole community's share, the forums' weight and the levels
create or replace view public.community_pulse with (security_invoker = true) as
with counted as (
  select r.post_id, p.created_at
  from public.post_reads r join public.posts p on p.id = r.post_id
  where r.counts and p.status = 'visible'
), season as (
  select s.* from public.seasons s
  where (now() at time zone 'utc')::date between s.starts and s.ends
  order by s.n desc limit 1
), board as (
  select b.internal_share, b.certification from public.signal_board b where b.score is not null
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
        where c.created_at >= s.starts and c.created_at < s.ends + 1) as season_reports,
       (select coalesce(round(avg(internal_share))::integer, 0) from board) as community_share,
       private.external_weight() as external_weight,
       (select count(*) from board where certification = 'forum') as cert_forum,
       (select count(*) from board where certification = 'early') as cert_early,
       (select count(*) from board where certification = 'backed') as cert_backed,
       (select count(*) from board where certification = 'verified') as cert_verified,
       (select count(*) from board where certification = 'certified') as cert_certified;

-- ---------------------------------------------------------------------------
-- Community totals for the public library (run by the site build, as the owner)
-- ---------------------------------------------------------------------------
create function private.public_snapshot() returns jsonb
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
        'history', coalesce(h.points, '[]'::jsonb)))
      from board b left join hist h on h.compound_id = b.compound_id), '{}'::jsonb),
    'spaces', coalesce((select jsonb_object_agg(s.id, jsonb_build_array(s.members_count, s.posts))
                        from spaces s where s.members_count > 0 or s.posts > 0), '{}'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
revoke execute on function private.certification(integer, integer, integer, integer) from public, anon;
revoke execute on function private.wilson(integer, integer) from public, anon;
revoke execute on function private.external_weight() from public, anon;
revoke execute on function private.public_snapshot() from public, anon, authenticated;
grant execute on function private.certification(integer, integer, integer, integer) to authenticated;
grant execute on function private.wilson(integer, integer) to authenticated;
grant execute on function private.external_weight() to authenticated;
grant select on public.signal_board, public.signal_history, public.community_pulse to authenticated;
