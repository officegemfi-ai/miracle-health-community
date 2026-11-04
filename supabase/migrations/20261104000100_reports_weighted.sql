-- Miracle Health community: reports checked, followed up and weighted.
--
-- 1. "Did we read you right?" The author confirms or fixes every part of Miracle AI's read of
--    their report in one place: how it went, for how long, what for, side effects. When the
--    read is missing how long they took it, the app asks that one thing (and nothing else).
-- 2. "How is it now?" One-tap check-ins 2, 6 and 12 weeks after a first-hand report: how it is
--    now, whether they still take it, and why they stopped. The latest check-in is what counts.
-- 3. Reports are weighted, never people. A read the author confirmed, longer use and check-ins
--    count more; each account counts once per compound (its latest report); a "same for me"
--    counts half a report; copied posts are held out; a burst of brand-new accounts on one
--    compound counts a quarter until a moderator clears it. No member gets a credibility score.
-- 4. Ratings by use are pooled: each starts from what members report for that use across every
--    compound and moves toward the compound's own reports as they come in, so three glowing
--    reports can't outrank two hundred good ones. Each comes with a likely range (90%).
-- 5. The side-effect watch: a side effect reported unusually often for one compound compared
--    with every other compound (three reports or more, at least twice as often, and unlikely to
--    be chance). Serious reactions are counted, and the author is pointed to medical help and
--    FDA MedWatch.
-- 6. Built ahead: each Signal version keeps how its reports went (with check-ins), its side
--    effects, its watch and its check-ins, so every screen reads the same numbers. The public
--    snapshot adds the week's moves, the focus pairs (the compound-and-use pairs the community
--    fills first) and forum counts from sources whose terms allow them.

-- ===========================================================================
-- 0. Settings, points, causes and notes
-- ===========================================================================
insert into private.settings (key, value, note) values
  ('pool_strength', '8', 'Reports a rating by use starts with, at what members report for that use across compounds'),
  ('burst_reports', '5', 'Reports on one compound from accounts under a week old within 48 hours that make a burst (each counts a quarter until a moderator clears it)'),
  ('watch_min_reports', '3', 'Reports that must mention a side effect before the side-effect watch can flag it'),
  ('watch_ratio', '2', 'How many times more often than for other compounds before the watch flags a side effect'),
  ('watch_min_others', '20', 'Reports on other compounds the side-effect watch needs to compare against')
on conflict (key) do nothing;

insert into public.point_rules (reason, points, label) values
  ('checkin', 10, 'Saying how it’s going 2, 6 or 12 weeks after your report')
on conflict (reason) do nothing;

alter table public.signal_snapshots drop constraint signal_snapshots_cause_check;
alter table public.signal_snapshots add constraint signal_snapshots_cause_check
  check (cause in ('report', 'same', 'removed', 'restored', 'edit', 'deleted', 'checkin'));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('welcome', 'comment', 'reply', 'same_for_me', 'counted',
                  'milestone', 'level_up', 'badge', 'mod', 'library', 'checkin', 'safety'));

-- ===========================================================================
-- 1. What the read holds: how long in weeks, serious reactions, side effects by one name
-- ===========================================================================
alter table public.post_reads
  add column weeks numeric(5, 1) check (weeks is null or weeks between 0 and 520),
  add column serious boolean not null default false;

-- How long, in weeks, from the words people use ("6 weeks", "a few months", "1–3 months",
-- "under a week"); a range counts as its middle; null when it can't tell
create function private.weeks_of(p text) returns numeric
language plpgsql immutable set search_path = ''
as $$
declare
  t text := lower(btrim(coalesce(p, '')));
  m text[];
  a numeric;
  v numeric;
  unit numeric;
begin
  if t = '' then
    return null;
  end if;
  t := replace(replace(t, '–', '-'), '—', '-');
  if t ~ '(under|less than|not even|not quite) (a|one) week' then
    return 0.5;
  end if;
  m := regexp_match(t, '(\d+(?:\.\d+)?|half an?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a few|few|a couple(?: of)?|couple(?: of)?|several)\s*(?:(?:-|to)\s*(\d+(?:\.\d+)?))?\s*\+?\s*(days?|weeks?|wks?|months?|mos?|years?|yrs?)\M');
  if m is null then
    return null;
  end if;
  if m[1] ~ '^\d' then
    a := m[1]::numeric;
  elsif m[1] like 'half%' then
    a := 0.5;
  elsif m[1] in ('a', 'an', 'one') then
    a := 1;
  elsif m[1] like '%couple%' then
    a := 2;
  elsif m[1] in ('a few', 'few') then
    a := 3;
  elsif m[1] = 'several' then
    a := 4;
  else
    a := array_position(array['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'], m[1]);
  end if;
  v := case when m[2] is not null then (a + m[2]::numeric) / 2 else a end;
  unit := case when m[3] like 'd%' then 1 / 7.0 when m[3] like 'w%' then 1 when m[3] like 'm%' then 4.345 else 52.18 end;
  return least(round(v * unit, 1), 520);
end;
$$;

-- One name per side effect, so the watch counts "nauseous" and "mild nausea" together
create table private.effect_terms (
  term text primary key check (term = lower(term)),
  effect text not null check (length(effect) between 2 and 40)
);
revoke all on private.effect_terms from public, anon, authenticated;
insert into private.effect_terms (term, effect)
select t, e from (values
  ('Nausea', array['nausea', 'nauseous', 'nauseated', 'feeling sick', 'queasy', 'queasiness', 'sick to my stomach']),
  ('Vomiting', array['vomiting', 'threw up', 'throwing up', 'puking']),
  ('Stomach upset', array['stomach upset', 'upset stomach', 'stomach pain', 'stomach ache', 'stomachache', 'stomach cramps', 'indigestion', 'heartburn', 'acid reflux', 'reflux', 'gi upset', 'gi issues', 'gut issues']),
  ('Constipation', array['constipation', 'constipated']),
  ('Diarrhea', array['diarrhea', 'diarrhoea', 'loose stools', 'the runs']),
  ('Bloating', array['bloating', 'bloated', 'gas']),
  ('Headache', array['headache', 'headaches', 'head ache', 'head aches']),
  ('Migraine', array['migraine', 'migraines']),
  ('Injection site reaction', array['injection site reaction', 'injection site pain', 'injection site redness', 'injection site swelling', 'injection site itching', 'injection site bruising', 'sore injection site', 'site reaction', 'site reactions', 'redness at the injection site', 'lump at injection site', 'red bump', 'welts']),
  ('Fatigue', array['fatigue', 'tired', 'tiredness', 'lethargy', 'lethargic', 'exhaustion', 'exhausted', 'low energy', 'drowsiness', 'drowsy', 'sleepy']),
  ('Trouble sleeping', array['trouble sleeping', 'insomnia', 'poor sleep', 'bad sleep', 'can''t sleep', 'cannot sleep', 'sleeplessness', 'sleep problems']),
  ('Vivid dreams', array['vivid dreams', 'nightmares', 'weird dreams', 'strange dreams', 'intense dreams']),
  ('Dizziness', array['dizziness', 'dizzy', 'lightheaded', 'light-headed', 'lightheadedness', 'vertigo']),
  ('Flushing', array['flushing', 'flushed', 'red face', 'facial flushing', 'face flushing', 'hot flush']),
  ('Fast heartbeat', array['fast heartbeat', 'racing heart', 'heart racing', 'palpitations', 'heart palpitations', 'rapid heart rate', 'tachycardia', 'high heart rate', 'elevated heart rate']),
  ('Water retention', array['water retention', 'fluid retention', 'puffiness', 'puffy', 'swelling', 'edema', 'oedema', 'swollen ankles']),
  ('Increased hunger', array['increased hunger', 'hunger', 'increased appetite', 'more hungry', 'ravenous', 'hungry']),
  ('Low appetite', array['low appetite', 'loss of appetite', 'reduced appetite', 'no appetite', 'appetite loss']),
  ('Numbness or tingling', array['numbness or tingling', 'numbness', 'tingling', 'pins and needles', 'numb hands', 'tingling hands', 'carpal tunnel']),
  ('Acne', array['acne', 'breakouts', 'breakout', 'pimples', 'spots']),
  ('Hair loss', array['hair loss', 'hair shedding', 'thinning hair', 'shedding', 'hair thinning']),
  ('Low mood', array['low mood', 'depression', 'depressed', 'sadness', 'feeling down']),
  ('Mood swings', array['mood swings', 'moodiness', 'emotional']),
  ('Irritability', array['irritability', 'irritable', 'short temper', 'angry']),
  ('Anxiety', array['anxiety', 'anxious', 'jittery', 'jitters', 'nervousness', 'restlessness', 'restless', 'panic']),
  ('Low libido', array['low libido', 'reduced libido', 'lower libido', 'lower sex drive', 'low sex drive', 'loss of libido']),
  ('Joint pain', array['joint pain', 'achy joints', 'joint aches', 'aching joints', 'sore joints']),
  ('Muscle aches', array['muscle aches', 'muscle pain', 'muscle ache', 'body aches', 'myalgia', 'sore muscles']),
  ('Rash', array['rash', 'hives', 'itching', 'itchy skin', 'itchiness', 'skin rash']),
  ('Darker skin or moles', array['darker skin or moles', 'darker moles', 'new moles', 'darkened moles', 'darker freckles', 'skin darkening', 'freckles']),
  ('Low blood sugar', array['low blood sugar', 'hypoglycemia', 'hypoglycaemia', 'blood sugar crash', 'shaky']),
  ('High blood pressure', array['high blood pressure', 'raised blood pressure', 'elevated blood pressure', 'hypertension']),
  ('Brain fog', array['brain fog', 'foggy', 'fogginess', 'trouble concentrating', 'mental fog']),
  ('Sweating', array['sweating', 'night sweats', 'sweats', 'excessive sweating']),
  ('Breast tenderness', array['breast tenderness', 'sore nipples', 'nipple sensitivity', 'gyno', 'gynecomastia']),
  ('Lethargy after dosing', array['crash'])
) as v (e, terms)
cross join lateral unnest(v.terms) as t
on conflict (term) do nothing;

create function private.effect_name(p text) returns text
language sql stable security definer set search_path = ''
as $$
  with t as (
    select regexp_replace(lower(btrim(coalesce(p, ''))),
             '^((very|really|quite|pretty) )?(mild|slight|some|minor|light|occasional|bad|severe|intense|a little|a bit of|frequent|constant|terrible|strong|extreme)\s+', '') as k
  )
  select case when t.k = '' then null
              else left(coalesce((select e.effect from private.effect_terms e where e.term = t.k),
                                 upper(left(t.k, 1)) || substr(t.k, 2)), 40) end
  from t
$$;

-- At most three, once each, by their one name, in the order given
create function private.clean_effects(p text[]) returns text[]
language sql stable set search_path = ''
as $$
  select coalesce(array_agg(y.effect order by y.o), '{}')
  from (
    select x.effect, x.o
    from (
      select distinct on (private.effect_name(t.e)) private.effect_name(t.e) as effect, t.o
      from unnest(coalesce(p, '{}'::text[])) with ordinality as t (e, o)
      where private.effect_name(t.e) is not null
      order by private.effect_name(t.e), t.o
    ) x
    order by x.o
    limit 3
  ) y
$$;

-- Miracle AI's read now also says whether a reaction sounds serious; how long becomes weeks,
-- and side effects take their one name
drop function public.record_post_read(uuid, boolean, text, text, text[], text, jsonb);
create function public.record_post_read(
  post_id uuid, counts boolean, outcome text, duration text, side_effects text[], model text,
  uses jsonb default '[]'::jsonb, serious boolean default false
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_compound text;
  v_outcome text := case when record_post_read.outcome in ('better', 'same', 'worse') then record_post_read.outcome end;
  v_counts boolean := coalesce(record_post_read.counts, false) and v_outcome is not null;
  v_duration text := nullif(left(btrim(coalesce(record_post_read.duration, '')), 40), '');
  v_effects text[];
  v_uses jsonb;
begin
  select p.compound_id into v_compound from public.posts p
  where p.id = record_post_read.post_id and p.kind = 'experience';
  if v_compound is null then
    return;  -- gone, or a question: nothing to count
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

-- A reaction that sounds serious: the author is pointed to medical help and FDA MedWatch
create function private.post_reads_safety() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_author uuid;
begin
  if new.serious and (tg_op = 'INSERT' or not old.serious) then
    select p.author_id into v_author from public.posts p where p.id = new.post_id;
    perform private.notify(v_author, 'safety', new.post_id, null, new.compound_id, '{}'::jsonb, 'safety:' || new.post_id);
  end if;
  return null;
end;
$$;
create trigger post_reads_safety after insert or update of serious on public.post_reads
  for each row execute function private.post_reads_safety();

-- ===========================================================================
-- 2. "Did we read you right?": the author confirms or fixes the whole read
-- ===========================================================================
-- Any part left null stays as read. p_uses: the use ids they picked (a use they kept keeps its
-- own answer; a new one takes theirs). p_confirm: false when they only answered the one
-- question the app asked (how long), without checking the rest.
create function private.fix_read(
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

-- The one-tap check on how it went, as before: now the same path as a full fix
create or replace function private.confirm_read(p_post uuid, p_outcome text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_outcome is null or p_outcome not in ('better', 'same', 'worse') then
    raise exception 'Pick better, about the same or worse.' using errcode = 'P0001';
  end if;
  perform private.fix_read(p_post, p_outcome, null, null, null, true);
end;
$$;

create function public.fix_read(
  post_id uuid, outcome text default null, duration text default null, uses jsonb default null,
  side_effects text[] default null, confirm boolean default true
) returns void
language sql security invoker set search_path = ''
as $$ select private.fix_read(post_id, outcome, duration, uses, side_effects, confirm) $$;

-- ===========================================================================
-- 3. "How is it now?": check-ins at 2, 6 and 12 weeks
-- ===========================================================================
create table public.report_checkins (
  post_id uuid not null references public.posts (id) on delete cascade,
  week smallint not null check (week in (2, 6, 12)),
  outcome text not null check (outcome in ('better', 'same', 'worse')),
  still_taking boolean not null,
  stop_reason text check (stop_reason in ('done', 'no_effect', 'side_effects', 'cost', 'other')),
  created_at timestamptz not null default now(),
  primary key (post_id, week),
  check (stop_reason is null or not still_taking)
);

-- The check-in due now for a report, if any: the latest of 2, 6 and 12 weeks whose time has
-- come and that isn't answered. None after "I stopped", and none 20 weeks on.
create function private.checkin_due(p_post uuid) returns smallint
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_post public.posts;
  v_week smallint;
begin
  select * into v_post from public.posts where id = p_post;
  if v_post.id is null or v_post.kind <> 'experience' or v_post.status <> 'visible'
     or v_post.created_at < now() - interval '20 weeks'
     or not exists (select 1 from public.post_reads r where r.post_id = p_post and r.counts)
     or exists (select 1 from public.report_checkins c where c.post_id = p_post and not c.still_taking) then
    return null;
  end if;
  select max(w) into v_week from unnest(array[2, 6, 12]::smallint[]) as w
  where v_post.created_at + make_interval(weeks => w) <= now();
  if v_week is null or exists (select 1 from public.report_checkins c where c.post_id = p_post and c.week >= v_week) then
    return null;
  end if;
  return v_week;
end;
$$;

create function private.check_in(
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
  if p_week is null or p_week not in (2, 6, 12) or v_post.created_at + make_interval(weeks => p_week) > now() then
    raise exception 'That check-in isn’t due yet.' using errcode = 'P0001';
  end if;
  insert into public.report_checkins (post_id, week, outcome, still_taking, stop_reason)
  values (p_post, p_week, p_outcome, p_still,
          case when not p_still and p_reason in ('done', 'no_effect', 'side_effects', 'cost', 'other') then p_reason end)
  on conflict (post_id, week) do update
    set outcome = excluded.outcome, still_taking = excluded.still_taking,
        stop_reason = excluded.stop_reason, created_at = now();
  perform private.award(v_uid, 'checkin', p_post, null, null, p_week::text, null, false, true);
  update public.notifications set read_at = coalesce(read_at, now())
   where user_id = v_uid and dedupe = 'checkin:' || p_post || ':' || p_week;
  perform private.signal_cause('checkin', p_post);
  perform private.signal_compute(v_post.compound_id);
end;
$$;

-- A note in the bell for each check-in that's due (the app asks when someone opens it, so no
-- scheduled job is needed); returns how many are due
create function private.checkin_reminders() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_n integer := 0;
  r record;
begin
  if v_uid is null then
    return 0;
  end if;
  for r in
    select p.id, p.compound_id, private.checkin_due(p.id) as week
    from public.posts p
    where p.author_id = v_uid and p.kind = 'experience' and p.status = 'visible'
      and p.created_at > now() - interval '20 weeks' and p.created_at <= now() - interval '2 weeks'
  loop
    if r.week is not null then
      perform private.notify(v_uid, 'checkin', r.id, null, r.compound_id, jsonb_build_object('week', r.week),
                             'checkin:' || r.id || ':' || r.week);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

create function public.check_in(post_id uuid, week smallint, outcome text, still_taking boolean, stop_reason text default null)
returns void
language sql security invoker set search_path = ''
as $$ select private.check_in(post_id, week, outcome, still_taking, stop_reason) $$;

create function public.checkin_reminders() returns integer
language sql security invoker set search_path = ''
as $$ select private.checkin_reminders() $$;

-- Your check-ins that are due now
create view public.my_checkins with (security_invoker = true) as
select p.id as post_id, p.compound_id, c.name as compound_name, p.title, p.created_at, d.week,
       r.outcome as read_outcome
from public.posts p
join public.compounds c on c.id = p.compound_id
join public.post_reads r on r.post_id = p.id and r.counts
cross join lateral (select private.checkin_due(p.id) as week) d
where p.author_id = (select auth.uid()) and p.kind = 'experience' and p.status = 'visible'
  and p.created_at <= now() - interval '2 weeks' and p.created_at > now() - interval '20 weeks'
  and d.week is not null;

-- ===========================================================================
-- 4. Weighting reports, and holding out copies
-- ===========================================================================
-- The words of each post, so a copied post can be told apart (a short post can't)
alter table public.posts
  add column fingerprint text generated always as (
    case when length(btrim(regexp_replace(lower(body), '[^a-z0-9]+', ' ', 'g'))) >= 40
         then md5(btrim(regexp_replace(lower(body), '[^a-z0-9]+', ' ', 'g'))) end) stored,
  add column fingerprint_head text generated always as (
    case when length(btrim(regexp_replace(lower(body), '[^a-z0-9]+', ' ', 'g'))) >= 200
         then md5(left(btrim(regexp_replace(lower(body), '[^a-z0-9]+', ' ', 'g')), 160)) end) stored;
create index posts_fingerprint_idx on public.posts (fingerprint) where fingerprint is not null;
create index posts_fingerprint_head_idx on public.posts (fingerprint_head) where fingerprint_head is not null;

-- Reports a moderator looked at and let count in full
create table private.signal_clears (
  post_id uuid primary key references public.posts (id) on delete cascade,
  cleared_by uuid references public.profiles (id) on delete set null,
  cleared_at timestamptz not null default now()
);
create index signal_clears_by_idx on private.signal_clears (cleared_by);
revoke all on private.signal_clears from public, anon, authenticated;

-- Every contribution to a compound's Signal, with its weight (w) and, when it's held out or
-- turned down, why (held):
--   a first-hand report: 1, half for an account in its first days (new_account_days);
--     x1.25 when the author confirmed or fixed the read;
--     how long: unknown x0.85, under a week x0.6, 1-4 weeks x0.9, 1-3 months x1, 3 months+ x1.15;
--     x1.1 for each check-in, up to three;
--     outcome and uses: the latest check-in's answer, when there is one
--   a "same for me": half a report (half again for a new account)
--   held: 'repeat'      an earlier report by the same account on this compound (its latest counts)
--         'copy'        the same words as an earlier post (counts nothing)
--         'burst'       one of 5+ reports from week-old accounts within 48 hours (counts a quarter)
--         'own_report'  a "same for me" from someone whose own report on it already counts
-- A moderator can clear a copy or a burst (private.signal_clears).
create function private.signal_rows(p_compound text)
returns table (post_id uuid, uid uuid, kind text, outcome text, uses jsonb, w numeric, held text, fresh boolean)
language sql stable security definer set search_path = ''
as $$
  with reads as (
    select r.post_id, p.author_id as uid, p.created_at, a.created_at as joined,
           p.fingerprint, p.fingerprint_head, r.outcome as read_outcome, r.uses as read_uses,
           r.confirmed_at, r.weeks,
           (select c.outcome from public.report_checkins c where c.post_id = r.post_id order by c.week desc limit 1) as now_outcome,
           (select count(*) from public.report_checkins c where c.post_id = r.post_id) as checkins,
           private.is_new_member(p.author_id) as fresh
    from public.post_reads r
    join public.posts p on p.id = r.post_id
    join public.profiles a on a.id = p.author_id
    where r.compound_id = p_compound and r.counts and p.status = 'visible'
  ), marked as (
    select x.*,
           row_number() over (partition by x.uid order by x.created_at desc, x.post_id) as nth,
           exists (select 1 from public.posts q
                   where q.id <> x.post_id and q.created_at < x.created_at
                     and (q.fingerprint = x.fingerprint
                          or (x.fingerprint_head is not null and q.fingerprint_head = x.fingerprint_head))) as copied,
           (x.created_at - x.joined < interval '7 days'
            and (select count(*) from reads y
                 where y.created_at - y.joined < interval '7 days'
                   and y.created_at between x.created_at - interval '48 hours' and x.created_at + interval '48 hours')
                >= private.setting_int('burst_reports')) as burst,
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
    select s.post_id, s.user_id as uid, 'same'::text as kind, r.outcome, r.uses,
           case when exists (select 1 from reports o where o.uid = s.user_id) then 'own_report'
                when row_number() over (partition by s.user_id order by s.created_at desc, s.post_id) > 1 then 'repeat' end as held,
           private.is_new_member(s.user_id) as fresh,
           0.5 * (case when private.is_new_member(s.user_id) then 0.5 else 1.0 end) as base
    from public.same_for_me s
    join reports r on r.post_id = s.post_id and (r.held is null or r.held = 'burst')
  )
  select x.post_id, x.uid, x.kind, x.outcome, x.uses,
         round(case when x.held is null then x.base when x.held = 'burst' then x.base * 0.25 else 0 end, 4) as w,
         x.held, x.fresh
  from (select post_id, uid, kind, outcome, uses, held, fresh, base from reports
        union all
        select post_id, uid, kind, outcome, uses, held, fresh, base from sames) x
$$;

-- What members report for each use across every compound (two even reports to start), the
-- starting point each compound's rating for that use is pooled toward
create function private.use_priors() returns table (use_id text, mean numeric)
language sql stable security definer set search_path = ''
as $$
  select u->>'use' as use_id,
         (1.0 + sum(case u->>'outcome' when 'better' then 1 when 'same' then 0.5 else 0 end)) / (2 + count(*)) as mean
  from public.post_reads r
  join public.posts p on p.id = r.post_id
  cross join lateral jsonb_array_elements(r.uses) u
  where r.counts and p.status = 'visible' and u->>'outcome' in ('better', 'same', 'worse')
  group by u->>'use'
$$;

-- ===========================================================================
-- 5. Ratings by use, pooled, with a likely range
-- ===========================================================================
-- rating: pooled 0-100 (better 1, about the same 0.5, worse 0), starting from pool_strength
--   reports at the average for that use and moving toward the compound's own weighted reports;
--   shown once use_min_reports reports name the use
-- low, high: its 90% range; own: the compound's reports alone, unpooled
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
           sum(pu.w * case pu.outcome when 'better' then 1 when 'same' then 0.5 else 0 end) as total
    from per_use pu
    group by pu.use_id
  ), rows as (
    select su.id, su.sort, f.label as forum,
           coalesce(m.reports, 0) as reports, coalesce(m.voices, 0) as voices,
           coalesce(m.better, 0) as better, coalesce(m.same, 0) as same, coalesce(m.worse, 0) as worse,
           m.n, m.total, coalesce(pr.mean, 0.5) as prior
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
           'low', case when r.mean is not null then greatest(0, round(100 * (r.mean - 1.645 * sqrt(r.mean * (1 - r.mean) / (r.k + r.n + 1)))))::integer end,
           'high', case when r.mean is not null then least(100, round(100 * (r.mean + 1.645 * sqrt(r.mean * (1 - r.mean) / (r.k + r.n + 1)))))::integer end,
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
-- 6. How reports went, side effects, the watch and check-ins, kept on each version
-- ===========================================================================
alter table public.signal_snapshots
  add column went_better integer not null default 0,
  add column went_same integer not null default 0,
  add column went_worse integer not null default 0,
  add column held integer not null default 0,
  add column side_effects jsonb not null default '[]'::jsonb,
  add column watch jsonb not null default '[]'::jsonb,
  add column serious integer not null default 0,
  add column checkins jsonb not null default '{}'::jsonb;

-- For one compound, from the reports that count (each at its latest answer):
--   better / same / worse, reports held out, the six side effects mentioned most,
--   the watch: side effects reported unusually often compared with every other compound
--     (a PRR, the ratio of the two shares with half a report added to each, of watch_ratio or
--     more; a Yates chi-square of 3.84 or more; watch_min_reports reports; watch_min_others
--     reports on other compounds to compare with),
--   reactions Miracle AI read as serious, and what check-ins say (still taking, stopped, why)
create function private.signal_extras(p_compound text) returns jsonb
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
    select private.effect_name(e) as effect, count(distinct rd.post_id)::integer as n
    from reads rd cross join lateral unnest(rd.side_effects) as e
    where private.effect_name(e) is not null
    group by 1
  ), others as (
    select pr.post_id, pr.side_effects
    from public.post_reads pr join public.posts p on p.id = pr.post_id
    where pr.compound_id <> p_compound and pr.counts and p.status = 'visible'
  ), other_effects as (
    select private.effect_name(e) as effect, count(distinct o.post_id)::numeric as c
    from others o cross join lateral unnest(o.side_effects) as e
    where private.effect_name(e) is not null
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

-- The Signal's calculation (65% efficacy, 15% consistency, 10% diversity, 10% confidence, as
-- before), now from weighted reports, keeping the extras on each version
create or replace function private.signal_compute(p_compound text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  b public.signal_baseline;
  v_prev public.signal_snapshots;
  v_n numeric; v_sum numeric; v_better numeric; v_same numeric; v_worse numeric; v_unlock numeric;
  v_reports integer; v_sames integer; v_voices integer;
  v_ext numeric; v_entropy numeric := 0; v_in_eff numeric := 0; v_in_cons numeric := 0;
  v_eff numeric; v_cons numeric; v_div numeric; v_conf numeric; v_score numeric; v_share smallint;
  v_by_use jsonb; v_x jsonb;
  v_cause text := nullif(current_setting('mh.signal_cause', true), '');
  v_cause_post uuid := nullif(current_setting('mh.signal_cause_post', true), '')::uuid;
begin
  if p_compound is null then
    return;
  end if;
  -- One change at a time per compound, so versions never collide
  perform pg_advisory_xact_lock(hashtext('signal:' || p_compound));
  select * into b from public.signal_baseline where compound_id = p_compound;

  select coalesce(sum(r.w), 0),
         coalesce(sum(r.w * case r.outcome when 'better' then 1 when 'same' then 0.5 else 0 end), 0),
         coalesce(sum(r.w) filter (where r.outcome = 'better'), 0),
         coalesce(sum(r.w) filter (where r.outcome = 'same'), 0),
         coalesce(sum(r.w) filter (where r.outcome = 'worse'), 0),
         -- what unlocks a number for a compound with no forum baseline: as before, contributions
         -- with new accounts at half
         coalesce(sum(case when r.fresh then 0.5 else 1 end) filter (where r.w > 0), 0),
         count(*) filter (where r.kind = 'report' and r.w > 0),
         count(*) filter (where r.kind = 'same' and r.w > 0),
         count(distinct r.uid) filter (where r.w > 0)
    into v_n, v_sum, v_better, v_same, v_worse, v_unlock, v_reports, v_sames, v_voices
  from private.signal_rows(p_compound) r;

  select * into v_prev from public.signal_snapshots
  where compound_id = p_compound order by version desc limit 1;

  if b.compound_id is null and v_unlock < private.setting_int('signal_min_reports') then
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
  v_x := private.signal_extras(p_compound);

  if v_prev.id is not null and v_prev.score is not distinct from v_score then
    update public.signal_snapshots
       set efficacy = round(v_eff), consistency = round(v_cons), diversity = round(v_div),
           confidence = round(v_conf), first_hand = v_reports, same_for_me = v_sames,
           voices = v_voices, internal_share = v_share, by_use = v_by_use,
           went_better = (v_x->>'better')::integer, went_same = (v_x->>'same')::integer,
           went_worse = (v_x->>'worse')::integer, held = (v_x->>'held')::integer,
           side_effects = v_x->'effects', watch = v_x->'watch', serious = (v_x->>'serious')::integer,
           checkins = v_x->'checkins'
     where id = v_prev.id;
    return;
  end if;
  insert into public.signal_snapshots (compound_id, version, score, efficacy, consistency, diversity,
                                       confidence, first_hand, same_for_me, voices, internal_share,
                                       themes, source_families, cause, cause_post, by_use,
                                       went_better, went_same, went_worse, held, side_effects, watch,
                                       serious, checkins)
  values (p_compound, coalesce(v_prev.version, 0) + 1, v_score, round(v_eff), round(v_cons),
          round(v_div), round(v_conf), v_reports, v_sames, v_voices, v_share,
          coalesce(b.themes, '[]'), coalesce(b.source_families, '{}'), v_cause, v_cause_post, v_by_use,
          (v_x->>'better')::integer, (v_x->>'same')::integer, (v_x->>'worse')::integer, (v_x->>'held')::integer,
          v_x->'effects', v_x->'watch', (v_x->>'serious')::integer, v_x->'checkins');
end;
$$;

-- ===========================================================================
-- 7. Moderators: reports held out of the Signal, and clearing them
-- ===========================================================================
create function private.signal_holds()
returns table (post_id uuid, compound_id text, compound_name text, title text, author_handle text,
               held text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_moderator() then
    raise exception 'Moderators only.' using errcode = '42501';
  end if;
  return query
  select r.post_id, c.id, c.name, p.title, a.handle, r.held, p.created_at
  from (select x.id, x.name from public.compounds x
        where exists (select 1 from public.post_reads pr where pr.compound_id = x.id and pr.counts)) c
  cross join lateral private.signal_rows(c.id) r
  join public.posts p on p.id = r.post_id
  join public.profiles a on a.id = p.author_id
  where r.kind = 'report' and r.held in ('copy', 'burst')
  order by p.created_at desc
  limit 100;
end;
$$;

create function private.clear_signal_hold(p_post uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_compound text;
begin
  if not private.is_moderator() then
    raise exception 'Moderators only.' using errcode = '42501';
  end if;
  select p.compound_id into v_compound from public.posts p where p.id = p_post;
  if v_compound is null then
    raise exception 'That post is gone.' using errcode = 'P0001';
  end if;
  insert into private.signal_clears (post_id, cleared_by) values (p_post, (select auth.uid()))
  on conflict (post_id) do nothing;
  perform private.signal_cause('report', p_post);
  perform private.signal_compute(v_compound);
end;
$$;

create function public.signal_holds()
returns table (post_id uuid, compound_id text, compound_name text, title text, author_handle text,
               held text, created_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from private.signal_holds() $$;

create function public.clear_signal_hold(post_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.clear_signal_hold(post_id) $$;

-- ===========================================================================
-- 8. The compound-and-use pairs the community fills first
-- ===========================================================================
-- Until a pair has goal reports (10: what the community's ranking needs), the app and the
-- library ask for it first. Moderators change the list here, not in code.
create table public.focus_pairs (
  compound_id text not null references public.compounds (id) on delete cascade,
  use_id text not null references public.signal_uses (id),
  goal smallint not null default 10 check (goal between 3 and 500),
  sort smallint not null default 0,
  primary key (compound_id, use_id)
);
create index focus_pairs_use_idx on public.focus_pairs (use_id);
insert into public.focus_pairs (compound_id, use_id, goal, sort)
select v.c, v.u, 10, v.s
from (values ('bpc157', 'injury', 1), ('tb500', 'injury', 2), ('semaglutide', 'fat_loss', 3),
             ('tirzepatide', 'fat_loss', 4), ('mag', 'sleep', 5)) as v (c, u, s)
where exists (select 1 from public.compounds c where c.id = v.c);

-- reports: first-hand reports that name the use, one per member (each account counts once
-- per compound)
create view public.focus_progress with (security_invoker = true) as
select f.compound_id, c.name as compound_name, f.use_id, u.label as use_label, f.goal, f.sort,
       coalesce(x.reports, 0)::integer as reports
from public.focus_pairs f
join public.compounds c on c.id = f.compound_id
join public.signal_uses u on u.id = f.use_id
left join lateral (
  select count(distinct p.author_id) as reports
  from public.post_reads r
  join public.posts p on p.id = r.post_id
  where r.compound_id = f.compound_id and r.counts and p.status = 'visible'
    and exists (select 1 from jsonb_array_elements(r.uses) e where e->>'use' = f.use_id)
) x on true;

-- ===========================================================================
-- 9. Forum counts, only from sources whose terms allow it
-- ===========================================================================
-- Counted forum data ("412 posts read, 61% positive"), loaded by the owner from a source
-- whose terms allow counting and showing it (terms_ok). Nothing is shown from a source until
-- then: Reddit, for one, doesn't allow commercial use of its data without an agreement.
create table private.forum_counts (
  id bigint generated always as identity primary key,
  compound_id text not null references public.compounds (id) on delete cascade,
  use_id text references public.signal_uses (id),
  source text not null check (length(source) between 2 and 60),
  posts integer not null check (posts >= 0),
  positive integer not null default 0 check (positive >= 0),
  mixed integer not null default 0 check (mixed >= 0),
  negative integer not null default 0 check (negative >= 0),
  period_start date,
  period_end date,
  method text not null check (length(method) between 10 and 400),
  terms_ok boolean not null default false,
  collected_at timestamptz not null default now(),
  check (positive + mixed + negative <= posts)
);
create unique index forum_counts_one on private.forum_counts (compound_id, coalesce(use_id, ''), source);
create index forum_counts_use_idx on private.forum_counts (use_id);
revoke all on private.forum_counts from public, anon, authenticated;

-- ===========================================================================
-- 10. What members read: the board, the feed
-- ===========================================================================
-- The board reads each Signal's latest version (built ahead), plus where it stood a week ago
create or replace view public.signal_board with (security_invoker = true) as
with ranked as (
  select s.*, row_number() over (partition by s.compound_id order by s.version desc) as rn
  from public.signal_snapshots s
), week as (
  select distinct on (s.compound_id) s.compound_id, s.score
  from public.signal_snapshots s
  where s.score is not null and s.computed_at <= now() - interval '7 days'
  order by s.compound_id, s.version desc
), first as (
  select distinct on (s.compound_id) s.compound_id, s.score
  from public.signal_snapshots s
  where s.score is not null
  order by s.compound_id, s.version asc
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
       cur.went_better as reports_better, cur.went_same as reports_same, cur.went_worse as reports_worse,
       w.ci[1] as better_pct, w.ci[2] as better_low, w.ci[3] as better_high,
       cur.side_effects as side_effects_top,
       cur.by_use,
       cur.watch, cur.serious as serious_reports, cur.checkins, cur.held as held_reports,
       coalesce(wk.score, fs.score) as week_score
from ranked cur
join public.compounds c on c.id = cur.compound_id
left join ranked prev on prev.compound_id = cur.compound_id and prev.rn = 2
left join week wk on wk.compound_id = cur.compound_id
left join first fs on fs.compound_id = cur.compound_id
cross join lateral (select private.wilson(cur.went_better, cur.went_better + cur.went_same + cur.went_worse) as ci) w
where cur.rn = 1;

-- Each post shows a serious reaction, its latest check-in, and (to its author) the check-in due
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
       coalesce(r.uses, '[]'::jsonb) as read_uses,
       coalesce(r.serious, false) as read_serious,
       (select jsonb_build_object('week', k.week, 'outcome', k.outcome, 'still_taking', k.still_taking,
                                  'stop_reason', k.stop_reason, 'at', k.created_at)
        from public.report_checkins k where k.post_id = p.id order by k.week desc limit 1) as checkin,
       case when p.author_id = (select auth.uid()) and p.kind = 'experience'
                 and p.created_at <= now() - interval '2 weeks'
            then private.checkin_due(p.id) end as checkin_due
from public.posts p
join public.profiles a on a.id = p.author_id
join public.compounds c on c.id = p.compound_id
left join public.post_reads r on r.post_id = p.id
left join public.member_scores ms on ms.user_id = p.author_id;

-- ===========================================================================
-- 11. The public library's snapshot: ranges, the watch, check-ins, the week's moves, the
--     focus pairs and counted forum data
-- ===========================================================================
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

-- ===========================================================================
-- 12. Miracle AI's test set: its messages count against the site's daily budget only
-- ===========================================================================
-- Called by the ask function (service role only) for a request carrying the test-set key, which
-- is set on the test project only while scripts/ask_eval.py runs. Answers as public.ask_take does.
create function public.ask_count_site() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  if coalesce(private.setting('ask_enabled'), 'on') <> 'on' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  insert into private.ask_usage as u (bucket, slot, n) values ('site', date_trunc('day', now(), 'UTC'), 1)
    on conflict (bucket, slot) do update set n = u.n + 1 returning u.n into v_n;
  if v_n > coalesce(private.setting_int('ask_per_day'), 1000) then
    return jsonb_build_object('ok', false, 'reason', 'site_day');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.ask_count_site() from public, anon, authenticated;
grant execute on function public.ask_count_site() to service_role;

-- ===========================================================================
-- 13. Access
-- ===========================================================================
revoke all on public.report_checkins, public.focus_pairs from anon, authenticated;
revoke all on public.my_checkins, public.focus_progress from anon, authenticated;
grant select on public.report_checkins, public.focus_pairs to authenticated;
grant select on public.my_checkins, public.focus_progress, public.signal_board, public.feed to authenticated;

alter table public.report_checkins enable row level security;
alter table public.focus_pairs enable row level security;
-- A check-in is part of the report: members read those of posts they can see; only the
-- author writes one, through check_in
create policy "members read check-ins" on public.report_checkins
  for select to authenticated
  using ((select private.can_read()) and exists (select 1 from public.posts p where p.id = report_checkins.post_id));
create policy "members read the focus pairs" on public.focus_pairs
  for select to authenticated using ((select private.can_read()));

revoke execute on function private.weeks_of(text), private.effect_name(text), private.clean_effects(text[]),
  private.fix_read(uuid, text, text, jsonb, text[], boolean), private.checkin_due(uuid),
  private.check_in(uuid, smallint, text, boolean, text), private.checkin_reminders(),
  private.signal_rows(text), private.use_priors(), private.signal_extras(text),
  private.signal_holds(), private.clear_signal_hold(uuid), private.post_reads_safety()
  from public, anon, authenticated;
revoke execute on function public.record_post_read(uuid, boolean, text, text, text[], text, jsonb, boolean),
  public.fix_read(uuid, text, text, jsonb, text[], boolean),
  public.check_in(uuid, smallint, text, boolean, text), public.checkin_reminders(),
  public.signal_holds(), public.clear_signal_hold(uuid)
  from public, anon, authenticated;

grant execute on function private.weeks_of(text), private.effect_name(text), private.clean_effects(text[]),
  private.clean_uses(jsonb, text) to service_role;
grant execute on function public.record_post_read(uuid, boolean, text, text, text[], text, jsonb, boolean) to service_role;
grant execute on function public.fix_read(uuid, text, text, jsonb, text[], boolean),
  public.check_in(uuid, smallint, text, boolean, text), public.checkin_reminders(),
  public.signal_holds(), public.clear_signal_hold(uuid) to authenticated;
grant execute on function private.fix_read(uuid, text, text, jsonb, text[], boolean),
  private.check_in(uuid, smallint, text, boolean, text), private.checkin_reminders(),
  private.checkin_due(uuid), private.signal_holds(), private.clear_signal_hold(uuid) to authenticated;

-- ===========================================================================
-- 14. Every Signal recalculated once, so its version carries the extras
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
