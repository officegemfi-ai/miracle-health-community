-- Preview only: a sample community of made-up members, loaded into the real
-- database schema running in the browser (see web/preview/engine.js). Never part
-- of a real build. Points, emblems, badges and Signal moves are not written here:
-- the database's own triggers produce them from this activity, as they would live.

create function pg_temp.u(p_handle text) returns uuid language sql immutable as $$ select md5('preview-user:' || p_handle)::uuid $$;
create function pg_temp.p(p_key text) returns uuid language sql immutable as $$ select md5('preview-post:' || p_key)::uuid $$;
create function pg_temp.c(p_key text) returns uuid language sql immutable as $$ select md5('preview-comment:' || p_key)::uuid $$;

insert into public.invites (code, note, trusted, max_uses, uses) values
  ('PREVIEW', 'Preview code: anyone with the preview can use it', true, 500, 0),
  ('7F3A9C21B4', 'Founding members', true, 15, 6),
  ('2D9E4B7A10', 'Wave 1: GLP-1 group', false, 20, 3)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, phone_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select pg_temp.u(handle), 'authenticated', 'authenticated', now(), now() - make_interval(days => days), now(), '{}', '{}'
from (values
  ('maya_mod', 60), ('stairs_again', 41), ('glp_journal', 38), ('sleepy_in_sd', 33), ('runner_mike', 29),
  ('desk_athlete', 26), ('scar_notes', 22), ('quiet_curious', 19), ('knee_rehab_jo', 16), ('focus_fern', 12),
  ('longevity_lab', 9), ('dawn_patrol', 8), ('fresh_acct_22', 1), ('reta_fan_88', 1)
) as t(handle, days);

insert into public.profiles (id, handle, role, trusted, adult_confirmed_at, rules_version, health_data_consent_at, created_at)
select pg_temp.u(handle), handle, role::public.member_role, trusted, now(), '2026-10-21', now(), now() - make_interval(days => days)
from (values
  ('maya_mod', 'moderator', 60, true), ('stairs_again', 'member', 41, true), ('glp_journal', 'member', 38, true),
  ('sleepy_in_sd', 'member', 33, false), ('runner_mike', 'member', 29, false), ('desk_athlete', 'member', 26, false),
  ('scar_notes', 'member', 22, false), ('quiet_curious', 'member', 19, false), ('knee_rehab_jo', 'member', 16, false),
  ('focus_fern', 'member', 12, false), ('longevity_lab', 'member', 9, false), ('dawn_patrol', 'member', 8, false),
  ('fresh_acct_22', 'member', 1, false), ('reta_fan_88', 'member', 1, false)
) as t(handle, role, days, trusted);

-- The spaces they follow
insert into public.space_members (compound_id, user_id)
select s, pg_temp.u(handle)
from (values
  ('maya_mod', array['bpc157', 'tirzepatide', 'semaglutide', 'retatrutide']),
  ('stairs_again', array['bpc157', 'tb500', 'creatine', 'ghkcu']),
  ('glp_journal', array['tirzepatide', 'semaglutide', 'retatrutide', 'mag']),
  ('sleepy_in_sd', array['ipamorelin', 'melatonin', 'mag', 'dsip']),
  ('runner_mike', array['bpc157', 'tb500', 'motsc', 'creatine']),
  ('desk_athlete', array['semax', 'selank', 'creatine', 'bpc157']),
  ('scar_notes', array['ghkcu', 'tirzepatide', 'collagen']),
  ('quiet_curious', array['semaglutide', 'mag', 'tirzepatide']),
  ('knee_rehab_jo', array['tb500', 'bpc157', 'creatine']),
  ('focus_fern', array['selank', 'semax', 'ltheanine']),
  ('longevity_lab', array['epithalon', 'nad', 'motsc', 'rapamycin', 'ss31']),
  ('dawn_patrol', array['semaglutide', 'tirzepatide']),
  ('reta_fan_88', array['retatrutide'])
) as t(handle, spaces), unnest(spaces) as s;

-- ---------------------------------------------------------------------------
-- Posts (the hours are how long ago)
-- ---------------------------------------------------------------------------
insert into public.posts (id, author_id, compound_id, kind, title, body, status, status_reason, created_at)
select pg_temp.p(k), pg_temp.u(author), compound, kind::public.post_kind, title, body,
       coalesce(status, 'visible')::public.content_status, reason, now() - make_interval(hours => hours)
from (values
  ('p1', 'glp_journal', 'tirzepatide', 'experience', 5, 'Month 3 on tirzepatide (prescribed): appetite, energy and one rough week',
   E'My doctor started me in July. The first two weeks I was noticeably less hungry and a bit nauseous after big meals. Week 6 was rough: tired and queasy for about four days. Since then it has settled. Evening cravings are mostly gone and I sleep better.\n\nCompared with before I started: better.', null, null),
  ('p2', 'stairs_again', 'bpc157', 'experience', 9, 'BPC-157 for tennis elbow: no change after 5 weeks',
   E'Tried it alongside the physio exercises. Five weeks in, the elbow feels about the same as before I started. Honestly the exercises probably did more than anything. Posting because the "didn''t work" reports matter too.\n\nCompared with before I started: the same.', null, null),
  ('p3', 'quiet_curious', 'semaglutide', 'question', 14, 'Anyone else get bad heartburn on semaglutide?',
   'Prescribed, week 4. Food sits in my stomach much longer and I get heartburn most evenings. I have already told my doctor; I am curious whether it eased up for others and how long it took.', null, null),
  ('p4', 'scar_notes', 'ghkcu', 'experience', 26, 'GHK-Cu cream on a surgery scar, 8 weeks',
   E'Using a topical cream on a one-year-old scar. Side-by-side photos show it slightly flatter and less red, but I am also eight weeks further from the surgery, so I cannot say how much was the cream.\n\nCompared with before I started: a little better.', null, null),
  ('p5', 'sleepy_in_sd', 'ipamorelin', 'experience', 31, 'Ipamorelin under a clinic: sleep was the only thing I noticed',
   E'Ten weeks, supervised by a clinic. Deeper sleep from about week two, and vivid dreams. No change in body composition that I could measure. I stopped last month and my sleep went back to normal within a week.\n\nCompared with before I started: better while I was on it.', null, null),
  ('p6', 'desk_athlete', 'semax', 'experience', 50, 'Semax nasal spray during exam season',
   E'Used it for three weeks while studying. Maybe slightly sharper in the mornings, but my sleep and coffee changed too, so I cannot separate it. Mild headache the first two days.\n\nCompared with before I started: about the same.', null, null),
  ('p7', 'runner_mike', 'motsc', 'question', 70, 'MOTS-c and running: did anyone measure VO2max or race times?',
   'Looking for people who tracked something, not just "more energy". If you raced or tested before and after, what did your numbers do?', null, null),
  ('p8', 'reta_fan_88', 'retatrutide', 'experience', 6, 'Retatrutide is the best thing I have ever tried',
   'Everyone should be on this. Week one and I already feel amazing. Seriously, don''t wait.', null, null),
  ('p9', 'fresh_acct_22', 'tirzepatide', 'experience', 2, 'Better prices than the pharmacy',
   'Found a much cheaper option than my pharmacy. Message me on telegram and I will explain.', 'held', 'Held for a moderator (watched term: telegram)'),
  ('p10', 'knee_rehab_jo', 'tb500', 'experience', 20, 'TB-500 alongside PT for a calf strain: back to running at week 5',
   E'Third calf strain in two years. Same PT plan as last time, plus TB-500 through a clinic. Last time it took 9 weeks to run again; this time 5. One data point, and the strain might have been milder.\n\nCompared with before I started: better.', null, null),
  ('p11', 'focus_fern', 'selank', 'experience', 40, 'Selank for exam anxiety: calmer, but tired in the afternoons',
   E'Two weeks before finals. I felt calmer walking into exams and slept fine, but afternoons felt flat and I was tired by 3pm. Stopped after the exams and the tiredness went away.\n\nCompared with before I started: better, with a trade-off.', null, null),
  ('p12', 'longevity_lab', 'epithalon', 'experience', 60, 'Epithalon, 20 days: honestly nothing I could measure',
   E'Tracked sleep, resting heart rate and HRV on a wearable for a month before and during. No change in any of it, and I did not feel different.\n\nCompared with before I started: the same.', null, null),
  ('p13', 'dawn_patrol', 'semaglutide', 'experience', 16, 'Semaglutide month 2: down 11 lb, but constipation is real',
   E'Prescribed for weight. Down 11 lb in two months, mostly from not snacking at night. Constipation the whole time, better with fiber and water.\n\nCompared with before I started: better.', null, null),
  ('p14', 'runner_mike', 'bpc157', 'experience', 30, 'BPC-157 for an Achilles flare-up: slow, then it settled',
   E'Six weeks. First two weeks nothing, some redness at the injection site. By week four I could run easy miles again without the morning stiffness. Also cut my mileage, so who knows.\n\nCompared with before I started: better.', null, null),
  ('p15', 'glp_journal', 'retatrutide', 'question', 8, 'Retatrutide trial participants: what was the first month like?',
   'If you were in one of the trials, what did the first month feel like? Trying to understand what to expect before I talk to my doctor.', null, null),
  ('p16', 'stairs_again', 'creatine', 'experience', 44, 'Creatine for 8 weeks: stronger on stairs, small water gain',
   E'Plain creatine monohydrate every day for 8 weeks. Stairs and squats feel noticeably easier. About 2 lb of water weight in the first two weeks.\n\nCompared with before I started: better.', null, null),
  ('p17', 'desk_athlete', 'creatine', 'experience', 52, 'Creatine and brain fog: no difference for me',
   E'Tried it for six weeks hoping for the cognitive effect people mention. Nothing I could notice at work.\n\nCompared with before I started: about the same.', null, null),
  ('p18', 'sleepy_in_sd', 'melatonin', 'experience', 28, 'Melatonin for jet lag on a work trip: worked, vivid dreams',
   E'Nine-hour time difference. Took it for a week on arrival and was sleeping on local time by day three. Very vivid dreams.\n\nCompared with before I started: better.', null, null),
  ('p19', 'quiet_curious', 'mag', 'experience', 36, 'Magnesium glycinate before bed: fewer leg cramps',
   E'Three weeks. Night leg cramps went from most nights to maybe once a week. Sleep about the same.\n\nCompared with before I started: better.', null, null),
  ('p20', 'scar_notes', 'tirzepatide', 'experience', 80, 'Stopped tirzepatide after 6 weeks: the nausea won',
   E'Prescribed. Nausea most days and I vomited twice in week 5. My doctor and I decided to stop. Appetite was lower, but I could not live with the nausea.\n\nCompared with before I started: worse.', null, null),
  ('p21', 'longevity_lab', 'nad', 'experience', 90, 'NAD+ precursors for 3 months: energy maybe, sleep no',
   E'Three months. Maybe a bit more energy in the mornings, nothing in my sleep data. Expensive for "maybe".\n\nCompared with before I started: about the same.', null, null),
  ('p22', 'focus_fern', 'semax', 'question', 24, 'Semax or Selank for focus: which did you prefer, and why?',
   'I have tried Selank (see my other post). Curious how people who tried both compare them for focus, not anxiety.', null, null)
) as t(k, author, compound, kind, hours, title, body, status, reason);

-- What Miracle AI read in each report (the real backend asks Claude)
select public.record_post_read(pg_temp.p(k), true, outcome, duration, effects, 'preview-reader')
from (values
  ('p20', 'worse', '6 weeks', array['Nausea', 'Vomiting']), ('p21', 'same', '3 months', array[]::text[]),
  ('p12', 'same', '20 days', array[]::text[]), ('p17', 'same', '6 weeks', array[]::text[]),
  ('p6', 'same', '3 weeks', array['Headache']), ('p16', 'better', '8 weeks', array['Water retention']),
  ('p11', 'better', '2 weeks', array['Fatigue']), ('p19', 'better', '3 weeks', array[]::text[]),
  ('p5', 'better', '10 weeks', array[]::text[]), ('p14', 'better', '6 weeks', array['Injection-site reaction']),
  ('p18', 'better', '1 week', array[]::text[]), ('p4', 'better', '8 weeks', array[]::text[]),
  ('p10', 'better', '5 weeks', array[]::text[]), ('p13', 'better', '2 months', array['Constipation']),
  ('p2', 'same', '5 weeks', array[]::text[]), ('p8', 'better', '1 week', array[]::text[]),
  ('p1', 'better', '3 months', array['Nausea', 'Fatigue'])
) as t(k, outcome, duration, effects);
update public.post_reads set confirmed_at = now() where post_id in (pg_temp.p('p1'), pg_temp.p('p10'), pg_temp.p('p20'));

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
insert into public.comments (id, post_id, parent_id, author_id, body, created_at)
select pg_temp.c(k), pg_temp.p(post), case when parent is null then null else pg_temp.c(parent) end, pg_temp.u(author), body,
       now() - hours * interval '1 hour'
from (values
  ('c1', 'p1', null, 'quiet_curious', 'The week after a dose increase was the hardest for me too. Smaller meals helped.', 4.5),
  ('c1a', 'p1', 'c1', 'glp_journal', 'Same. Eating dinner earlier helped more than anything else I tried.', 4.0),
  ('c1b', 'p1', 'c1a', 'quiet_curious', 'Good tip, trying that this week.', 3.5),
  ('c2', 'p1', null, 'runner_mike', 'Did your energy for workouts change at all? Mine dipped the first month.', 3.2),
  ('c2a', 'p1', 'c2', 'glp_journal', 'A little for the first three weeks, then back to normal.', 2.8),
  ('c3', 'p2', null, 'desk_athlete', 'Same experience with my shoulder. The rehab exercises were what moved the needle.', 8.0),
  ('c4', 'p2', null, 'fresh_acct_22', 'lol of course it didn''t work, you probably did it wrong', 7.0),
  ('c4a', 'p2', 'c4', 'stairs_again', 'Posting what didn''t work is the whole point. Thanks to everyone who does.', 6.5),
  ('c5', 'p3', null, 'glp_journal', 'Mine eased up around week 7. Not eating late made the biggest difference for me.', 12.0),
  ('c5a', 'p3', 'c5', 'quiet_curious', 'Thanks, that''s reassuring.', 11.0),
  ('c6', 'p5', null, 'stairs_again', 'Vivid dreams here too. Good to know it settled after stopping.', 29.0),
  ('c7', 'p7', null, 'sleepy_in_sd', 'No numbers from me, sorry. Following this one.', 66.0),
  ('c8', 'p10', null, 'runner_mike', 'Calf strains are brutal. Did you change anything else in your rehab?', 18.0),
  ('c8a', 'p10', 'c8', 'knee_rehab_jo', 'Same PT plan as my last strain, which took 9 weeks. So maybe it helped, maybe it was a milder strain.', 17.0),
  ('c8b', 'p10', 'c8a', 'runner_mike', 'Fair. Thanks for being straight about it.', 16.0),
  ('c9', 'p13', null, 'glp_journal', 'Constipation was my worst side effect too. Fiber and water helped.', 15.0),
  ('c10', 'p20', null, 'dawn_patrol', 'Sorry it didn''t work out. Glad you posted it, these matter.', 70.0),
  ('c11', 'p12', null, 'focus_fern', 'Did you track sleep at all? Some people mention sleep changes.', 58.0),
  ('c11a', 'p12', 'c11', 'longevity_lab', 'Wearable said nothing changed. Which is its own answer.', 57.0),
  ('c12', 'p16', null, 'knee_rehab_jo', 'About 2 lb of water for me too, and it went away when I stopped.', 40.0),
  ('c13', 'p22', null, 'desk_athlete', 'Semax felt sharper, Selank felt calmer. Different tools for different days.', 22.0),
  ('c14', 'p14', null, 'stairs_again', 'Cutting mileage at the same time makes it so hard to tell. Good on you for saying so.', 26.0)
) as t(k, post, parent, author, body, hours)
order by length(k) - length(rtrim(k, 'ab')), hours desc;  -- parents before their replies

-- Helpful votes
insert into public.post_votes (post_id, user_id, value)
select pg_temp.p(k), pg_temp.u(v), value
from (values
  ('p1', 1, array['quiet_curious', 'runner_mike', 'desk_athlete', 'scar_notes', 'stairs_again', 'sleepy_in_sd', 'focus_fern', 'dawn_patrol', 'maya_mod']),
  ('p2', 1, array['desk_athlete', 'runner_mike', 'sleepy_in_sd', 'quiet_curious', 'glp_journal', 'longevity_lab', 'knee_rehab_jo']),
  ('p3', 1, array['glp_journal', 'dawn_patrol', 'scar_notes']),
  ('p4', 1, array['quiet_curious', 'stairs_again', 'focus_fern', 'glp_journal']),
  ('p5', 1, array['stairs_again', 'desk_athlete', 'runner_mike', 'longevity_lab']),
  ('p6', 1, array['focus_fern', 'quiet_curious']),
  ('p7', 1, array['sleepy_in_sd', 'longevity_lab', 'knee_rehab_jo']),
  ('p8', -1, array['stairs_again', 'desk_athlete', 'glp_journal']),
  ('p10', 1, array['runner_mike', 'stairs_again', 'desk_athlete', 'glp_journal', 'scar_notes', 'focus_fern']),
  ('p11', 1, array['desk_athlete', 'quiet_curious', 'knee_rehab_jo']),
  ('p12', 1, array['focus_fern', 'runner_mike', 'stairs_again', 'dawn_patrol', 'desk_athlete']),
  ('p13', 1, array['glp_journal', 'quiet_curious', 'scar_notes', 'maya_mod']),
  ('p14', 1, array['knee_rehab_jo', 'stairs_again', 'desk_athlete']),
  ('p15', 1, array['dawn_patrol', 'quiet_curious']),
  ('p16', 1, array['knee_rehab_jo', 'runner_mike', 'desk_athlete', 'focus_fern']),
  ('p17', 1, array['stairs_again', 'longevity_lab']),
  ('p18', 1, array['quiet_curious', 'focus_fern']),
  ('p19', 1, array['sleepy_in_sd', 'glp_journal', 'dawn_patrol']),
  ('p20', 1, array['dawn_patrol', 'glp_journal', 'quiet_curious', 'stairs_again', 'runner_mike', 'longevity_lab']),
  ('p21', 1, array['focus_fern', 'runner_mike']),
  ('p22', 1, array['desk_athlete', 'longevity_lab'])
) as t(k, value, voters), unnest(voters) as v;

insert into public.comment_votes (comment_id, user_id, value)
select pg_temp.c(k), pg_temp.u(v), value
from (values
  ('c1', 1, array['glp_journal', 'runner_mike', 'dawn_patrol']), ('c1a', 1, array['quiet_curious', 'dawn_patrol']),
  ('c3', 1, array['stairs_again', 'runner_mike']), ('c4', -1, array['desk_athlete', 'stairs_again', 'glp_journal']),
  ('c4a', 1, array['desk_athlete', 'glp_journal', 'runner_mike', 'quiet_curious']), ('c5', 1, array['quiet_curious', 'dawn_patrol', 'scar_notes']),
  ('c8a', 1, array['runner_mike', 'stairs_again']), ('c9', 1, array['dawn_patrol']), ('c11a', 1, array['focus_fern', 'runner_mike']),
  ('c13', 1, array['focus_fern'])
) as t(k, value, voters), unnest(voters) as v;

-- "Same for me" on reports that matched people's own experience
insert into public.same_for_me (post_id, user_id)
select pg_temp.p(k), pg_temp.u(v)
from (values
  ('p1', array['quiet_curious', 'desk_athlete', 'runner_mike', 'scar_notes', 'dawn_patrol']),
  ('p2', array['desk_athlete', 'runner_mike', 'sleepy_in_sd']),
  ('p4', array['quiet_curious']), ('p5', array['stairs_again', 'desk_athlete']),
  ('p10', array['runner_mike', 'stairs_again']), ('p13', array['glp_journal', 'quiet_curious']),
  ('p14', array['knee_rehab_jo']), ('p16', array['knee_rehab_jo']), ('p19', array['sleepy_in_sd']),
  ('p12', array['runner_mike']), ('p20', array['glp_journal'])
) as t(k, tappers), unnest(tappers) as v;

-- Sig stickers
insert into public.post_reactions (post_id, user_id, sticker)
select pg_temp.p(k), pg_temp.u(v), sticker
from (values
  ('p1', 'cheer', array['quiet_curious', 'runner_mike']), ('p1', 'support', array['dawn_patrol']),
  ('p20', 'support', array['dawn_patrol', 'glp_journal', 'quiet_curious']), ('p10', 'cheer', array['runner_mike', 'stairs_again']),
  ('p12', 'curious', array['focus_fern']), ('p7', 'watching', array['sleepy_in_sd', 'longevity_lab', 'knee_rehab_jo']),
  ('p13', 'cheer', array['glp_journal']), ('p22', 'watching', array['desk_athlete'])
) as t(k, sticker, who), unnest(who) as v;

-- ---------------------------------------------------------------------------
-- Something for the moderators
-- ---------------------------------------------------------------------------
insert into public.reports (target_kind, target_id, reporter_id, reason, note, created_at)
values ('comment', pg_temp.c('c4'), pg_temp.u('desk_athlete'), 'harassment', null, now() - interval '6 hours'),
       ('comment', pg_temp.c('c4'), pg_temp.u('stairs_again'), 'harassment', 'Not helpful, just mocking', now() - interval '5 hours');
insert into public.signal_alerts (compound_id, new_accounts, events, new_account_events, window_start, window_end, created_at)
values ('retatrutide', 9, 40, 31, now() - interval '26 hours', now() - interval '2 hours', now() - interval '2 hours');
