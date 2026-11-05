-- Miracle Health community: reports checked, followed up and weighted (pgTAP)
-- The author's check on the read, check-ins at 2, 6 and 12 weeks, weights and holds, pooled
-- ratings with ranges, the side-effect watch, focus pairs and the snapshot. Rolls back at the end.

begin;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'no_plan') then
    create extension if not exists pgtap with schema extensions;
  end if;
end $$;
set local search_path = public, extensions, tests;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Test helpers (the same as community.test.sql; they live only in this transaction)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;
create table tests.ids (name text primary key, id uuid not null);
grant all on tests.ids to anon, authenticated, service_role;

create function tests.remember(p_name text, p_id uuid) returns uuid
language sql as $$ insert into tests.ids values (p_name, p_id) on conflict (name) do update set id = excluded.id returning id $$;
create function tests.id(p_name text) returns uuid
language sql stable as $$ select id from tests.ids where name = p_name $$;
create function tests.auth_user(p_name text) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, phone, phone_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'authenticated', 'authenticated', '1556' || lpad((abs(hashtext(p_name)) % 10000000)::text, 7, '0'),
          now(), now(), now(), '{}', '{}');
  return tests.remember(p_name, v);
end $$;
create function tests.member(
  p_name text, p_role public.member_role default 'member', p_trusted boolean default false,
  p_age interval default interval '30 days', p_status public.member_status default 'active'
) returns uuid
language plpgsql as $$
declare v uuid := tests.auth_user(p_name);
begin
  insert into public.profiles (id, handle, role, status, suspended_until, trusted,
                               adult_confirmed_at, rules_version, created_at, health_data_consent_at)
  values (v, p_name, p_role, p_status, null, p_trusted, now(), '2026-10-21', now() - p_age, now());
  return v;
end $$;
create function tests.as_user(p_name text) returns void
language plpgsql as $$
declare v uuid := tests.id(p_name);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
end $$;
create function tests.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;
create function tests.as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;
create function tests.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- A post written straight into the table (as the owner), with its own words and time
create function tests.post(p_name text, p_author text, p_compound text, p_body text default null,
                           p_ago interval default interval '0 seconds')
returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.posts (author_id, compound_id, kind, title, body, created_at)
  values (tests.id(p_author), p_compound, 'experience', 'Sample title for ' || p_name,
          coalesce(p_body, 'Sample body for ' || p_name), now() - p_ago)
  returning id into v;
  return tests.remember(p_name, v);
end $$;
create function tests.read(p_post text, p_outcome text, p_duration text default null, p_uses jsonb default '[]',
                           p_effects text[] default null, p_serious boolean default false)
returns void
language plpgsql as $$
begin
  perform tests.as_service();
  perform public.record_post_read(tests.id(p_post), true, p_outcome, p_duration, p_effects, 'claude', p_uses, p_serious);
  perform tests.as_owner();
end $$;
create function tests.board(p_compound text) returns public.signal_board
language sql stable as $$ select * from public.signal_board where compound_id = p_compound $$;
create function tests.use_of(p_compound text, p_use text) returns jsonb
language sql stable as $$
  select u from public.signal_board b, jsonb_array_elements(b.by_use) u
  where b.compound_id = p_compound and u->>'use' = p_use $$;
create function tests.held(p_post text) returns text
language sql stable as $$
  select r.held from private.signal_rows((select compound_id from public.posts where id = tests.id(p_post))) r
  where r.post_id = tests.id(p_post) and r.kind = 'report' $$;
create function tests.weight(p_post text) returns numeric
language sql stable as $$
  select r.w from private.signal_rows((select compound_id from public.posts where id = tests.id(p_post))) r
  where r.post_id = tests.id(p_post) and r.kind = 'report' $$;

select tests.member('alice', 'member', true, interval '60 days');
select tests.member('bob');
select tests.member('carol');
select tests.member('dave');
select tests.member('erin');
select tests.member('mia', 'moderator', false, interval '90 days');
select tests.member('nb_1', 'member', false, interval '1 day');
select tests.member('nb_2', 'member', false, interval '1 day');
select tests.member('nb_3', 'member', false, interval '2 days');
select tests.member('nb_4', 'member', false, interval '2 days');
select tests.member('nb_5', 'member', false, interval '3 days');

-- ===========================================================================
-- 1. How long, and side effects by one name
-- ===========================================================================
select tests.as_owner();
select is(private.weeks_of('6 weeks'), 6.0, 'How long: "6 weeks" is 6 weeks');
select is(private.weeks_of('about 10 days'), 1.4, '"about 10 days" is 1.4');
select is(private.weeks_of('a few months'), 13.0, '"a few months" is 13');
select is(private.weeks_of('1–3 months'), 8.7, 'a range counts as its middle: "1–3 months" is 8.7');
select is(private.weeks_of('Under a week'), 0.5, '"Under a week" is half a week');
select is(private.weeks_of('3 months or more'), 13.0, '"3 months or more" is 13');
select is(private.weeks_of('two years'), 104.4, '"two years" is 104.4');
select is(private.weeks_of('since January'), null, 'and when it can''t tell, nothing');
select is(private.effect_name('mild nausea'), 'Nausea', 'Side effects take one name: "mild nausea" is Nausea');
select is(private.effect_name('Nauseous'), 'Nausea', '"Nauseous" too');
select is(private.effect_name('injection site redness'), 'Injection site reaction', 'and site redness is an injection site reaction');
select is(private.effect_name('weird taste'), 'Weird taste', 'an effect with no one name keeps its words');
select is(private.clean_effects(array['nausea', 'Nausea', 'headaches', 'tired', 'acne']),
  array['Nausea', 'Headache', 'Fatigue'], 'At most three, once each, in the order given');

-- ===========================================================================
-- 2. A serious reaction
-- ===========================================================================
select tests.post('sev', 'erin', 'semaglutide', 'Ended up in the ER with severe stomach pain after week three, doctors said pancreatitis');
select tests.read('sev', 'worse', '3 weeks', '[{"use": "fat_loss", "outcome": "worse"}]', array['severe stomach pain'], true);
select is((select (serious, weeks) from public.post_reads where post_id = tests.id('sev'))::text, '(t,3.0)',
  'The read keeps that a reaction sounded serious, and how long in weeks');
select is((select count(*)::integer from public.notifications where user_id = tests.id('erin') and kind = 'safety'), 1,
  'and the author gets a note pointing to medical help and MedWatch, once');
select tests.read('sev', 'worse', '3 weeks', '[{"use": "fat_loss", "outcome": "worse"}]', array['severe stomach pain'], true);
select is((select count(*)::integer from public.notifications where user_id = tests.id('erin') and kind = 'safety'), 1,
  'A second read doesn''t send it again');
select tests.as_user('bob');
select is((select read_serious from public.feed where id = tests.id('sev')), true, 'The post shows it');
-- A question, or a comment, that describes a reaction that sounds serious gets the same note
select tests.as_owner();
insert into public.posts (author_id, compound_id, kind, title, body)
values (tests.id('carol'), 'bpc157', 'question', 'Throat swelling?', 'My throat has been swelling since my injection yesterday, is this normal?')
returning tests.remember('q_sev', id);
select tests.as_service();
select public.record_post_read(tests.id('q_sev'), true, 'worse', '1 day', array['Rash'], 'claude', '[]', true);
select tests.as_owner();
select is((select (counts, outcome, serious)::text from public.post_reads where post_id = tests.id('q_sev')), '(f,,t)',
  'A question that describes a serious reaction is marked, and still counts for nothing');
select is((select count(*)::integer from public.notifications where user_id = tests.id('carol') and kind = 'safety'), 1,
  'its writer gets the note');
select tests.as_user('bob');
select is((select read_serious from public.feed where id = tests.id('q_sev')), true, 'and the question shows it');
select tests.as_owner();
insert into public.comments (post_id, author_id, body)
values (tests.id('sev'), tests.id('dave'), 'Same thing happened to me, I ended up in the ER with chest pain')
returning tests.remember('c_sev', id);
select tests.as_user('dave');
select throws_ok($$ select public.record_comment_serious(tests.id('c_sev')) $$, '42501', null,
  'Members can''t mark comments themselves');
select tests.as_service();
select public.record_comment_serious(tests.id('c_sev'));
select public.record_comment_serious(tests.id('c_sev'));
select tests.as_owner();
select is((select count(*)::integer from public.notifications where user_id = tests.id('dave') and kind = 'safety' and comment_id = tests.id('c_sev')), 1,
  'A comment that describes one gets its writer the note, once');
select tests.as_user('bob');
select is((select serious from public.thread_comments where id = tests.id('c_sev')), true, 'and the comment shows it');
select throws_ok($$ select * from public.serious_reads() $$, '42501', null, 'Only moderators see the list');
select tests.as_user('mia');
select is((select array_agg(kind order by kind) from public.serious_reads() where post_id in (tests.id('sev'), tests.id('q_sev'))),
  array['comment', 'question', 'report'], 'Moderators see every post and comment that describes one');

-- ===========================================================================
-- 3. "Did we read you right?"
-- ===========================================================================
select tests.as_owner();
select tests.post('fx', 'bob', 'bpc157', 'Knee is much better, I took it for a while and had some headaches early on');
select tests.read('fx', 'better', null, '[{"use": "joints", "outcome": "better"}]', array['headaches']);
select is((select (weeks, side_effects, confirmed_at is null) from public.post_reads where post_id = tests.id('fx'))::text,
  '(,{Headache},t)', 'A read with no "how long" waits for the author');
select tests.as_user('carol');
select throws_ok($$ select public.fix_read(tests.id('fx'), null, '6 weeks') $$, '42501', null,
  'Only the author can fix the read');
select tests.as_user('bob');
select lives_ok($$ select public.fix_read(tests.id('fx'), duration => '1–3 months', confirm => false) $$,
  'The author answers the one question asked: how long');
select is((select (duration, weeks, confirmed_at is null, corrected) from public.post_reads where post_id = tests.id('fx'))::text,
  '("1–3 months",8.7,t,t)', 'which fills in how long without confirming the rest');
select is((select count(*)::integer from public.points where user_id = tests.id('bob') and reason = 'confirm'), 0,
  'and earns nothing yet');
select lives_ok($$ select public.fix_read(tests.id('fx'), 'better', null, '["joints", "injury"]'::jsonb, array['Headache', 'nauseous']) $$,
  'Then they fix what it was for and the side effects, and confirm');
select is((select (outcome, uses, side_effects, confirmed_at is not null)::text from public.post_reads where post_id = tests.id('fx')),
  (select ('better', '[{"use": "joints", "outcome": "better"}, {"use": "injury", "outcome": "better"}]'::jsonb,
           array['Headache', 'Nausea'], true)::text),
  'The read takes their answers: a use they kept keeps its answer, a new one takes theirs');
select is((select count(*)::integer from public.points where user_id = tests.id('bob') and reason = 'confirm'), 1,
  'Confirming earns the points once');
select lives_ok($$ select public.fix_read(tests.id('fx'), 'better') $$, 'Confirming again is fine');
select is((select count(*)::integer from public.points where user_id = tests.id('bob') and reason = 'confirm'), 1, 'but pays once');
select throws_ok($$ select public.fix_read(tests.id('fx'), 'sideways') $$, 'P0001', 'Pick better, about the same or worse.',
  'An answer it can''t use is refused');
select throws_ok($$ select public.confirm_read(tests.id('fx'), null) $$, 'P0001', 'Pick better, about the same or worse.',
  'The one-tap check still needs an answer');
-- What an author writes into the read is checked: no doses, sellers or links by that route
select throws_ok($$ select public.fix_read(tests.id('fx'), 'better', '250mcg 2x daily from acmepeps.com') $$, 'P0001',
  'Pick how long from the list.', 'How long must be a length of time, not a dose or a seller');
select throws_ok($$ select public.fix_read(tests.id('fx'), 'better', null, null, array['Get it at acmepeps dot com code SAVE20']) $$, 'P0001',
  'Pick side effects from the list.', 'A side effect must be one of the names on the list');
select throws_ok($$ select public.fix_read(tests.id('fx'), 'better', null, null, array['Acmepeps']) $$, 'P0001',
  'Pick side effects from the list.', 'even a single word that isn''t one');
select lives_ok($$ select public.fix_read(tests.id('fx'), 'better', '1–3 months', null, array['Headache', 'Nausea', 'Dizziness']) $$,
  'What they had stays, names on the list are fine, and so is a length of time');
select is((select (duration, side_effects)::text from public.post_reads where post_id = tests.id('fx')),
  (select ('1–3 months', array['Headache', 'Nausea', 'Dizziness'])::text), 'and they''re kept');
select tests.as_owner();
select ok(private.duration_ok('6 months or more') and private.duration_ok('Under a week') and private.duration_ok('8 weeks')
          and not private.duration_ok('250 mcg') and not private.duration_ok('2x daily'), 'How long: lengths of time only');
select is(private.clean_effects(array['Nausea', 'www.acmepeps.com', 'code SAVE20', '5mg crash', 'Metallic taste']),
  array['Nausea', 'Metallic taste'], 'From Sig''s read too, only a few plain words are kept');
select tests.as_user('bob');
select ok((select count(*) from public.side_effect_names()) >= 30
          and not exists (select 1 from public.side_effect_names() n where n = 'Lethargy after dosing'),
  'Members pick side effects from the list of names');
select tests.as_owner();
select ok(tests.weight('fx') = 1.25, 'A confirmed read, 1-3 months: 1.25');

-- ===========================================================================
-- 4. Weights and holds
-- ===========================================================================
select tests.post('w1', 'carol', 'bpc157', 'Took BPC for my shoulder, a little better after a month of use', interval '2 days');
select tests.read('w1', 'better', 'a month', '[{"use": "injury", "outcome": "better"}]');
select tests.post('w2', 'carol', 'bpc157', 'Update on the shoulder: plateaued now, about the same as before', interval '1 day');
select tests.read('w2', 'same', '7 weeks', '[{"use": "injury", "outcome": "same"}]');
select is(tests.held('w1'), 'repeat', 'An account counts once per compound: its earlier report is held');
select is(tests.held('w2'), null, 'and its latest counts');
select is((select b.first_hand from tests.board('bpc157') b), 2, 'The board counts the reports that count');

-- A copy of someone else's words counts nothing
select tests.post('orig', 'dave', 'tb500', 'My hamstring healed noticeably faster this time, around three weeks to jog again without pain', interval '3 days');
select tests.read('orig', 'better', '3 weeks', '[{"use": "injury", "outcome": "better"}]');
select tests.post('copy', 'erin', 'tb500', 'My hamstring healed noticeably faster this time; around three weeks to jog again, without pain!', interval '1 day');
select tests.read('copy', 'better', '3 weeks', '[{"use": "injury", "outcome": "better"}]');
select is(tests.held('copy'), 'copy', 'A post with the same words as an earlier one is held out');
select is(tests.held('orig'), null, 'the first one stands');
select is(tests.weight('copy'), 0::numeric, 'and the copy weighs nothing');
-- An old post edited to match a newer report is the copy, not the newer report
select tests.post('newer', 'carol', 'tb500', 'Calf strain from sprinting, back to running in two weeks and the tightness is gone now', interval '2 hours');
select tests.read('newer', 'better', '2 weeks', '[{"use": "injury", "outcome": "better"}]');
select tests.post('older', 'bob', 'tb500', 'Something else entirely, my elbow felt a bit better after a month or so of this', interval '10 days');
select tests.read('older', 'same', 'a month', '[{"use": "injury", "outcome": "same"}]');
update public.posts set body = 'Calf strain from sprinting, back to running in two weeks and the tightness is gone now', edited_at = now()
 where id = tests.id('older');
select tests.read('older', 'better', '2 weeks', '[{"use": "injury", "outcome": "better"}]');
select is(tests.held('newer'), null, 'An older post edited to copy a newer report doesn''t knock the newer one out');
select is(tests.held('older'), 'copy', 'the edited one is the copy');
-- Posting your own report again is a repeat, not a copy
select tests.post('again1', 'alice', 'bpc157', 'Elbow tendon pain finally easing after six weeks, I can lift the kettle without wincing', interval '3 days');
select tests.read('again1', 'better', '6 weeks', '[{"use": "tendons", "outcome": "better"}]');
select tests.post('again2', 'alice', 'bpc157', 'Elbow tendon pain finally easing after six weeks, I can lift the kettle without wincing', interval '1 day');
select tests.read('again2', 'better', '6 weeks', '[{"use": "tendons", "outcome": "better"}]');
select is(tests.held('again1'), 'repeat', 'Posting the same report twice: the earlier is a repeat');
select ok(tests.held('again2') is null and tests.weight('again2') > 0, 'and the latest counts');

-- "Same for me" counts half a report, once per person per compound, and not on top of your own
select tests.as_user('alice');
insert into public.same_for_me (post_id) values (tests.id('orig'));
select tests.as_owner();
select is((select r.w from private.signal_rows('tb500') r where r.kind = 'same' and r.uid = tests.id('alice')), 0.5,
  '"Same for me" counts half a report');
select tests.as_user('dave');
select throws_like($$ insert into public.same_for_me (post_id) values (tests.id('orig')) $$, '%your own report%',
  'Not on your own report');
select tests.as_user('erin');
insert into public.same_for_me (post_id) values (tests.id('orig'));
select tests.as_owner();
select is((select r.held from private.signal_rows('tb500') r where r.kind = 'same' and r.uid = tests.id('erin')), 'own_report',
  'A "same for me" from someone whose own report on it counts (or is held) adds nothing more');

-- A burst of week-old accounts on one compound counts a quarter, until a moderator clears it
select tests.post('b1', 'nb_1', 'dsip', 'Slept deeper from the first night, every night since then, really good stuff', interval '30 hours');
select tests.post('b2', 'nb_2', 'dsip', 'Falling asleep is so much faster for me now and I wake up rested, two weeks in', interval '20 hours');
select tests.post('b3', 'nb_3', 'dsip', 'Deep sleep tracking went up on my watch, feeling more rested than in years honestly', interval '10 hours');
select tests.post('b4', 'nb_4', 'dsip', 'Better sleep for me as well, fewer wake-ups during the night and better mornings', interval '5 hours');
select tests.post('b5', 'nb_5', 'dsip', 'Night one I was out cold, still sleeping better a week later, no grogginess at all', interval '1 hour');
select tests.read('b1', 'better', '1 week', '[{"use": "sleep", "outcome": "better"}]');
select tests.read('b2', 'better', '2 weeks', '[{"use": "sleep", "outcome": "better"}]');
select tests.read('b3', 'better', '10 days', '[{"use": "sleep", "outcome": "better"}]');
select tests.read('b4', 'better', '1 week', '[{"use": "sleep", "outcome": "better"}]');
select tests.read('b5', 'better', '1 week', '[{"use": "sleep", "outcome": "better"}]');
select is(tests.held('b3'), 'burst', 'Five reports from week-old accounts within 48 hours make a burst');
select is(tests.weight('b3'), 0.1125, 'each counts a quarter (new account half, 1-4 weeks 0.9, a quarter: 0.1125)');
select tests.as_user('bob');
select throws_ok($$ select * from public.signal_holds() $$, '42501', null, 'Only moderators see what''s held');
select tests.as_user('mia');
select is((select count(*)::integer from public.signal_holds() where held = 'burst'), 5, 'A moderator sees the burst');
select is((select count(*)::integer from public.signal_holds() where held = 'copy'), 2, 'and the two copies');
select lives_ok($$ select public.clear_signal_hold(tests.id('b3')) $$, 'and can clear one');
select tests.as_owner();
select is(tests.held('b3'), null, 'which then counts in full');
select is(tests.weight('b3'), 0.45, 'at its usual weight');
-- A wave of week-old accounts tapping "same for me" is a burst too, counted by accounts
select tests.member('nt_1', 'member', false, interval '1 day');
select tests.member('nt_2', 'member', false, interval '1 day');
select tests.member('nt_3', 'member', false, interval '2 days');
select tests.member('nt_4', 'member', false, interval '2 days');
select tests.member('nt_5', 'member', false, interval '3 days');
select tests.post('tapme', 'dave', 'ipamorelin', 'Sleeping more deeply and recovering faster between sessions, about two months in now', interval '5 days');
select tests.read('tapme', 'better', '2 months', '[{"use": "sleep", "outcome": "better"}]');
do $$
declare i integer;
begin
  for i in 1..5 loop
    perform set_config('request.jwt.claims', json_build_object('sub', tests.id('nt_' || i), 'role', 'authenticated')::text, true);
    insert into public.same_for_me (post_id, user_id, created_at) values (tests.id('tapme'), tests.id('nt_' || i), now() - make_interval(hours => i));
  end loop;
end $$;
select tests.as_owner();
select is((select count(*)::integer from private.signal_rows('ipamorelin') r where r.kind = 'same' and r.held = 'burst'), 5,
  'Five week-old accounts tapping "same for me" within 48 hours are a burst');
select is((select r.w from private.signal_rows('ipamorelin') r where r.kind = 'same' and r.uid = tests.id('nt_1')), 0.0625,
  'each counts a quarter of its quarter (0.0625)');
select is(tests.held('tapme'), null, 'and the report they tapped stands');

-- ===========================================================================
-- 5. Check-ins at 2, 6 and 12 weeks
-- ===========================================================================
select tests.post('ci', 'dave', 'ghkcu', 'Six weeks of GHK-Cu on my skin, it looks clearer and less dull than before', interval '43 days');
select tests.read('ci', 'better', '6 weeks', '[{"use": "skin", "outcome": "better"}]');
select tests.post('fresh', 'dave', 'motsc', 'Just started this one, more energy in the afternoons so far, will report back', interval '3 days');
select tests.read('fresh', 'better', '3 days', '[{"use": "energy", "outcome": "better"}]');
select tests.as_user('dave');
select is((select array_agg(week order by week) from public.my_checkins), array[6]::smallint[],
  'Six weeks on, the 6-week check-in is due (the 2-week one is skipped), and nothing for a 3-day-old report');
select is((select checkin_due from public.feed where id = tests.id('ci')), 6::smallint, 'The author''s post says so');
select tests.as_user('bob');
select is((select checkin_due from public.feed where id = tests.id('ci')), null::smallint, 'nobody else''s');
select tests.as_user('dave');
select is(public.checkin_reminders(), 1, 'Opening the app leaves a note in the bell');
select is(public.checkin_reminders(), 1, 'once');
select is((select count(*)::integer from public.notifications where user_id = tests.id('dave') and kind = 'checkin'), 1, 'just one note');
select throws_ok($$ select public.check_in(tests.id('fresh'), 2::smallint, 'better', true) $$, 'P0001', 'That check-in isn’t due.',
  'A check-in can''t come early');
select throws_ok($$ select public.check_in(tests.id('ci'), 2::smallint, 'better', true) $$, 'P0001', 'That check-in isn’t due.',
  'nor for a week that isn''t the one due (6 weeks on, the 2-week one is past)');
select throws_ok($$ select public.check_in(tests.id('ci'), 12::smallint, 'better', true) $$, 'P0001', 'That check-in isn’t due.',
  'nor for one still to come');
select tests.as_user('bob');
select throws_ok($$ select public.check_in(tests.id('ci'), 6::smallint, 'better', true) $$, '42501', null,
  'Only the author checks in');
select tests.as_owner();
create temp table before_ci as select score from tests.board('ghkcu');
select tests.as_user('dave');
select lives_ok($$ select public.check_in(tests.id('ci'), 6::smallint, 'worse', false, 'side_effects') $$,
  'The author checks in with two taps: worse now, stopped because of side effects');
select is((select (week, outcome, still_taking, stop_reason) from public.report_checkins where post_id = tests.id('ci'))::text,
  '(6,worse,f,side_effects)', 'The check-in is kept');
select is((select count(*)::integer from public.points where user_id = tests.id('dave') and reason = 'checkin'), 1, 'and earns points');
select is((select read_at is not null from public.notifications where user_id = tests.id('dave') and kind = 'checkin'), true,
  'and the note is marked read');
select tests.as_owner();
select is((select r.outcome from private.signal_rows('ghkcu') r where r.post_id = tests.id('ci') and r.kind = 'report'), 'worse',
  'The latest check-in is what counts for the Signal');
select ok((select b.score < (select score from before_ci) and b.reports_worse = 1 from tests.board('ghkcu') b),
  'so the number moves with it');
select is((select cause from public.signal_snapshots where compound_id = 'ghkcu' order by version desc limit 1), 'checkin',
  'and the version says why');
select tests.as_user('dave');
select is((select count(*)::integer from public.my_checkins where post_id = tests.id('ci')), 0, 'After "I stopped", nothing more is due');
select tests.as_owner();
update public.posts set created_at = now() - interval '13 weeks' where id = tests.id('ci');
select tests.as_user('dave');
select throws_ok($$ select public.check_in(tests.id('ci'), 12::smallint, 'better', true) $$, 'P0001', 'That check-in isn’t due.',
  'not even 12 weeks on: no points for checking in again after stopping');
select is((select count(*)::integer from public.points where user_id = tests.id('dave') and reason = 'checkin'), 1, 'still one lot of points');
select tests.as_user('bob');
select is((select checkin->>'stop_reason' from public.feed where id = tests.id('ci')), 'side_effects',
  'Everyone sees the latest check-in on the post');
select tests.as_owner();
select is((select checkins->>'stopped' from tests.board('ghkcu')), '1', 'The Signal counts who stopped');
select is((select checkins->'reasons'->>'side_effects' from tests.board('ghkcu')), '1', 'and why');

-- ===========================================================================
-- 6. Pooling: three glowing reports can't outrank many good ones
-- ===========================================================================
select tests.post('g1', 'alice', 'glycine', 'Glycine before bed and I sleep through the night now, first time in ages');
select tests.post('g2', 'bob', 'glycine', 'Sleeping better on glycine, easy to fall asleep, no morning grogginess for me');
select tests.post('g3', 'carol', 'glycine', 'Best sleep I have had in years with glycine, really noticeable difference');
select tests.read('g1', 'better', null, '[{"use": "sleep", "outcome": "better"}]');
select tests.read('g2', 'better', null, '[{"use": "sleep", "outcome": "better"}]');
select tests.read('g3', 'better', null, '[{"use": "sleep", "outcome": "better"}]');
do $$
declare i integer;
begin
  for i in 1..30 loop
    perform tests.member('mm_' || i);
    perform tests.post('mel' || i, 'mm_' || i, 'melatonin', 'Melatonin report number ' || i || ' about how my sleep went on it over the weeks');
    perform tests.read('mel' || i, case when i <= 24 then 'better' else 'same' end, null,
                       ('[{"use": "sleep", "outcome": "' || case when i <= 24 then 'better' else 'same' end || '"}]')::jsonb);
  end loop;
end $$;
select tests.as_owner();
select ok((tests.use_of('glycine', 'sleep')->>'own')::integer = 100 and (tests.use_of('melatonin', 'sleep')->>'own')::integer = 90,
  'Three reports all better (100) against thirty mostly better (90)');
select ok((tests.use_of('glycine', 'sleep')->>'low')::integer < (tests.use_of('melatonin', 'sleep')->>'low')::integer,
  'The three glowing reports have the wider range: their low end sits below the thirty''s');
select ok((tests.use_of('glycine', 'sleep')->>'rating')::integer < 100,
  'and their rating is pulled toward what members report for sleep everywhere');

-- ===========================================================================
-- 7. The side-effect watch
-- ===========================================================================
update private.settings set value = '5' where key = 'watch_min_others';
select tests.post('h1', 'alice', 'kpv', 'KPV for my gut, a bit better overall but I got headaches most days with it');
select tests.post('h2', 'bob', 'kpv', 'Gut is calmer on KPV, though the headaches were annoying in the first weeks');
select tests.post('h3', 'carol', 'kpv', 'Some improvement in bloating with KPV, mild headache almost every afternoon');
select tests.post('h4', 'erin', 'kpv', 'KPV did nothing much for me, stomach about the same, felt a little nauseous');
select tests.read('h1', 'better', '4 weeks', '[{"use": "gut", "outcome": "better"}]', array['headaches']);
select tests.read('h2', 'better', '5 weeks', '[{"use": "gut", "outcome": "better"}]', array['Headache']);
select tests.read('h3', 'better', '3 weeks', '[{"use": "gut", "outcome": "better"}]', array['mild headache']);
select tests.read('h4', 'same', '2 weeks', '[{"use": "gut", "outcome": "same"}]', array['nauseous']);
select is((select jsonb_agg(e->>'effect') from tests.board('kpv') b, jsonb_array_elements(b.watch) e), '["Headache"]'::jsonb,
  'The watch flags a side effect reported far more often for one compound than for others');
select is((select (e->>'n', e->>'of') from tests.board('kpv') b, jsonb_array_elements(b.watch) e)::text, '(3,4)',
  'with how many of its reports mention it');
select is((select jsonb_agg(e->>'effect') from tests.board('kpv') b, jsonb_array_elements(b.side_effects_top) e
           where e->>'effect' = 'Nausea'), '["Nausea"]'::jsonb, 'A side effect mentioned once is listed, not flagged');

-- ===========================================================================
-- 8. Focus pairs, and the public snapshot
-- ===========================================================================
select tests.as_user('bob');
select is((select (reports, goal)::text from public.focus_progress where compound_id = 'bpc157' and use_id = 'injury'), '(2,10)',
  'The focus pairs count reports toward their goal, one per member (BPC-157 for injury: 2 of 10)');
select tests.as_owner();
insert into private.forum_counts (compound_id, use_id, source, posts, positive, mixed, negative, method, terms_ok)
values ('tb500', 'injury', 'A licensed forum', 412, 251, 100, 61, 'Every post naming TB-500 in 2026, read by Sig', true),
       ('tb500', null, 'Reddit', 900, 600, 200, 100, 'Not allowed: no agreement for commercial use', false);
update public.signal_snapshots set computed_at = now() - interval '8 days' where compound_id = 'bpc157' and version = 1;
create temp table snap as select private.public_snapshot() as j;
select is((select j->'signals'->'tb500'->'forum_counts' from snap),
  '[{"to": null, "use": "injury", "from": null, "posts": 412, "method": "Every post naming TB-500 in 2026, read by Sig", "source": "A licensed forum", "mixed_pct": 24, "negative_pct": 15, "positive_pct": 61}]'::jsonb,
  'Counted forum data shows only from sources whose terms allow it');
select is((select jsonb_array_length(j->'signals'->'kpv'->'watch') from snap), 1, 'The snapshot carries the watch');
select ok((select (u->>'low') is not null and (u->>'high') is not null from snap, jsonb_array_elements(j->'signals'->'melatonin'->'by_use') u
           where u->>'use' = 'sleep'), 'and each rated use''s range');
select ok((select (j->'signals'->'ghkcu'->>'checkins') is null from snap), 'Check-ins show once three reports have them');
select ok((select (j->'signals'->'bpc157'->>'week')::numeric = 91.9 from snap), 'Each Signal says where it stood a week ago');
select ok((select exists (select 1 from jsonb_array_elements(j->'moves') m where m->>'id' = 'bpc157' and (m->>'from')::numeric = 91.9) from snap),
  'and the week''s moves list it');
select is((select j->'focus'->0->>'id' from snap), 'tirzepatide', 'The snapshot lists the focus pairs, in order (GLP-1s first)');
select is((select j->'signals'->'semaglutide'->>'serious' from snap), null, 'One serious reaction isn''t shown on its own');

-- ===========================================================================
-- 9. Who can do what
-- ===========================================================================
select tests.as_user('bob');
select throws_ok($$ insert into public.report_checkins (post_id, week, outcome, still_taking) values (tests.id('fx'), 2, 'better', true) $$,
  '42501', null, 'Nobody writes a check-in straight into the table');
select throws_ok($$ select * from private.signal_rows('bpc157') $$, '42501', null, 'Members can''t read who weighed in');
select throws_ok($$ select * from private.forum_counts $$, '42501', null, 'or the forum counts table');
select throws_ok($$ insert into public.focus_pairs (compound_id, use_id) values ('nad', 'energy') $$, '42501', null,
  'or change the focus pairs');
select throws_ok($$ select public.ask_count_site() $$, '42501', null, 'Members can''t use the test set''s budget');
select tests.as_service();
select is(public.ask_count_site(), '{"ok": true}'::jsonb, 'A test-set message counts against the site''s daily budget only');
select tests.as_owner();
update private.settings set value = '0' where key = 'ask_per_day';
select tests.as_service();
select is(public.ask_count_site()->>'reason', 'site_day', 'and stops when the site''s budget is spent');
select tests.as_anon();
select throws_ok($$ select * from public.focus_progress $$, '42501', null, 'Signed out, nothing');

select * from finish();
rollback;
