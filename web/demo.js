// Preview mode: a stand-in for Supabase that runs entirely in this browser tab,
// with sample posts from made-up members. Nothing leaves the browser, and closing
// the tab resets it. This file is only kept in preview builds, where config.js says
// { demo: true } (see scripts/write_config.mjs); the real app never loads it.
(() => {
  const C = window.MH_CONFIG || {};
  if (!C.demo) return;

  const STORE = 'mh_preview_v2';
  const H = 3600e3;
  const D = 24 * H;
  let db = null;
  let loading = null;
  const listeners = [];

  const now = () => new Date().toISOString();
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `id${Math.random().toString(36).slice(2)}`);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(db)); } catch (_) { /* private mode */ } };
  const ok = (data) => ({ data, error: null });
  const err = (message, code) => ({ data: null, error: { message, code } });
  const pause = () => new Promise((r) => setTimeout(r, 40));

  async function load() {
    if (db) return db;
    if (!loading) {
      loading = (async () => {
        try {
          const saved = sessionStorage.getItem(STORE);
          if (saved) { db = JSON.parse(saved); return db; }
        } catch (_) { /* private mode */ }
        const ref = await fetch('demo-data.json').then((r) => r.json());
        db = seed(ref);
        save();
        return db;
      })();
    }
    return loading;
  }

  // -------------------------------------------------------------------------
  // Sample community
  // -------------------------------------------------------------------------
  function seed(ref) {
    const profiles = [
      ['u_maya', 'maya_mod', 'moderator', 60], ['u_stairs', 'stairs_again', 'member', 41],
      ['u_glp', 'glp_journal', 'member', 38], ['u_sleepy', 'sleepy_in_sd', 'member', 33],
      ['u_runner', 'runner_mike', 'member', 29], ['u_desk', 'desk_athlete', 'member', 26],
      ['u_scar', 'scar_notes', 'member', 22], ['u_quiet', 'quiet_curious', 'member', 19],
      ['u_new1', 'fresh_acct_22', 'member', 1], ['u_new2', 'reta_fan_88', 'member', 1],
    ].map(([id, handle, role, days]) => ({ id, handle, role, status: 'active', suspended_until: null, trusted: days > 30, created_at: ago(days * D) }));

    const post = (id, author, compound, kind, title, body, hours, base, extra = {}) => ({
      id, author_id: author, compound_id: compound, kind, title, body, status: 'visible', status_reason: null,
      created_at: ago(hours * H), edited_at: null, base, ...extra,
    });
    const posts = [
      post('p1', 'u_glp', 'tirzepatide', 'experience', 'Month 3 on tirzepatide (prescribed): appetite, energy and one rough week',
        'My doctor started me on the lowest dose in July. The first two weeks I was noticeably less hungry and a bit nauseous after big meals. Week 6, after the dose went up, was rough: tired and queasy for about four days. Since then it has settled. Evening cravings are mostly gone and I sleep better.\n\nCompared with before I started: better.', 5, 14),
      post('p2', 'u_stairs', 'bpc157', 'experience', 'BPC-157 for tennis elbow: no change after 5 weeks',
        'Tried it alongside the physio exercises. Five weeks in, the elbow feels about the same as before I started. Honestly the exercises probably did more than anything. Posting because the "didn\'t work" reports matter too.\n\nCompared with before I started: the same.', 9, 21),
      post('p3', 'u_quiet', 'semaglutide', 'question', 'Anyone else get bad heartburn on semaglutide?',
        'Prescribed, week 4. Food sits in my stomach much longer and I get heartburn most evenings. I have already told my doctor; I am curious whether it eased up for others and how long it took.', 14, 8),
      post('p4', 'u_scar', 'ghkcu', 'experience', 'GHK-Cu cream on a surgery scar, 8 weeks',
        'Using a topical cream on a one-year-old scar. Side-by-side photos show it slightly flatter and less red, but I am also eight weeks further from the surgery, so I cannot say how much was the cream.\n\nCompared with before I started: a little better.', 26, 11),
      post('p5', 'u_sleepy', 'ipamorelin', 'experience', 'Ipamorelin under a clinic: sleep was the only thing I noticed',
        'Ten weeks, supervised by a clinic. Deeper sleep from about week two, and vivid dreams. No change in body composition that I could measure. I stopped last month and my sleep went back to normal within a week.\n\nCompared with before I started: better while I was on it.', 31, 17),
      post('p6', 'u_desk', 'semax', 'experience', 'Semax nasal spray during exam season',
        'Used it for three weeks while studying. Maybe slightly sharper in the mornings, but my sleep and coffee changed too, so I cannot separate it. Mild headache the first two days.\n\nCompared with before I started: about the same.', 50, 6),
      post('p7', 'u_runner', 'motsc', 'question', 'MOTS-c and running: did anyone measure VO2max or race times?',
        'Looking for people who tracked something, not just "more energy". If you raced or tested before and after, what did your numbers do?', 70, 9),
      post('p8', 'u_new2', 'retatrutide', 'experience', 'Retatrutide is the best thing I have ever tried',
        'Everyone should be on this. Week one and I already feel amazing. Seriously, don\'t wait.', 6, 9),
      post('p9', 'u_new1', 'tirzepatide', 'experience', 'Better prices than the pharmacy',
        'Found a much cheaper option than my pharmacy. Message me on telegram and I will explain.', 2, 0,
        { status: 'held', status_reason: 'Held for a moderator (watched term: telegram)' }),
    ];

    const comment = (id, postId, author, body, hours, base) => ({
      id, post_id: postId, author_id: author, body, status: 'visible', status_reason: null, created_at: ago(hours * H), edited_at: null, base,
    });
    const comments = [
      comment('c1', 'p1', 'u_quiet', 'The week after a dose increase was the hardest for me too. Smaller meals helped.', 4, 5),
      comment('c2', 'p1', 'u_runner', 'Did your energy for workouts change at all? Mine dipped the first month.', 3, 2),
      comment('c3', 'p2', 'u_desk', 'Same experience with my shoulder. The rehab exercises were what moved the needle.', 8, 6),
      comment('c4', 'p2', 'u_new1', 'lol of course it didn\'t work, you probably did it wrong', 7, -3),
      comment('c5', 'p3', 'u_glp', 'Mine eased up around week 7. Not eating late made the biggest difference for me.', 12, 7),
      comment('c6', 'p5', 'u_stairs', 'Vivid dreams here too. Good to know it settled after stopping.', 29, 3),
      comment('c7', 'p7', 'u_sleepy', 'No numbers from me, sorry. Following this one.', 66, 1),
    ];

    const reports = [
      { id: 'r1', target_kind: 'comment', target_id: 'c4', reporter_id: 'u_desk', reason: 'harassment', note: null, status: 'open', created_at: ago(6 * H) },
      { id: 'r2', target_kind: 'comment', target_id: 'c4', reporter_id: 'u_stairs', reason: 'harassment', note: 'Not helpful, just mocking', status: 'open', created_at: ago(5 * H) },
    ];
    const alerts = [{
      id: 'a1', compound_id: 'retatrutide', status: 'open', new_accounts: 9, new_account_events: 31, events: 40,
      window_start: ago(26 * H), window_end: ago(2 * H), created_at: ago(2 * H),
    }];
    const invites = [
      { code: 'PREVIEW', note: 'Preview code: anyone with the preview can use it', trusted: false, max_uses: 500, uses: 9, expires_at: null, created_at: ago(40 * D) },
      { code: '7F3A9C21B4', note: 'Founding members', trusted: true, max_uses: 15, uses: 6, expires_at: null, created_at: ago(45 * D) },
      { code: '2D9E4B7A10', note: 'Wave 1: GLP-1 group', trusted: false, max_uses: 20, uses: 3, expires_at: null, created_at: ago(12 * D) },
    ];
    // What Miracle AI read in each sample post (the real backend asks Claude)
    const read = (counts, outcome, duration, effects = []) => ({ counts, outcome, duration, side_effects: effects });
    const reads = {
      p1: read(true, 'better', '3 months', ['Nausea', 'Fatigue']), p2: read(true, 'same', '5 weeks'),
      p3: read(false, null, '4 weeks', ['Reflux']), p4: read(true, 'better', '8 weeks'),
      p5: read(true, 'better', '10 weeks'), p6: read(true, 'same', '3 weeks', ['Headache']),
      p7: read(false, null, null), p8: read(true, 'better', '1 week'), p9: read(false, null, null),
    };
    const same = { p1: ['u_quiet', 'u_desk', 'u_runner', 'u_scar'], p2: ['u_desk', 'u_runner', 'u_sleepy'], p4: ['u_quiet'], p5: ['u_stairs', 'u_desk'] };
    const sameRows = Object.entries(same).flatMap(([postId, users]) => users.map((u) => ({ post_id: postId, user_id: u, created_at: ago(2 * H) })));
    const state = {
      compounds: ref.compounds, watch_terms: ref.watch_terms, link_domains: ref.link_domains,
      signal_baseline: ref.signal_baseline || [], reads, same_for_me: sameRows, signal: {},
      profiles, posts, comments, reports, alerts, invites,
      post_votes: [], comment_votes: [], mod_log: [], session: null,
    };
    // First the public-forum numbers alone, then with the community's reports: the
    // movement shown on day one is what this community added
    db = state;
    state.signal_baseline.forEach((b) => { state.signal[b.compound_id] = { version: 1, prev: null, cur: snapshotFrom(b, 1) }; });
    new Set(posts.map((p) => p.compound_id)).forEach(refreshSignal);
    db = null;
    return state;
  }

  // -------------------------------------------------------------------------
  // Miracle AI's read of a post (a quick stand-in for the Claude read the real
  // backend does): first-hand or not, how it went, how long, side effects
  // -------------------------------------------------------------------------
  const AI_POS = [/\bbetter\b/, /\bimprov/, /\bhelp(ed|s|ing)?\b/, /\bwork(ed|s|ing)\b/, /\blost \d/, /\bdown \d+\s?(lb|lbs|kg|pounds)\b/, /\bdropped\b/, /\bgone\b/, /\bhealed\b/, /\brecover(ed|ing)\b/, /\bgreat\b/, /\bnoticeabl/, /\bstronger\b/, /\bmore energy\b/, /\bsleeping better\b/, /\bless pain\b/, /\beased\b/];
  const AI_NEG = [/\bworse\b/, /\bdidn'?t work\b/, /\bdid not work\b/, /\bno effect\b/, /\bnothing (happened|changed)\b/, /\bgave up\b/, /\bmade me sick\b/, /\bterrible\b/, /\bwaste of\b/];
  const AI_NEU = [/\bno (real |clear )?(change|difference)\b/, /\b(about|roughly|pretty much|basically) the same\b/, /\btoo early\b/, /\bnot sure yet\b/, /\bhard to (say|tell)\b/];
  const SE_LEX = [['nausea', 'Nausea'], ['nauseous', 'Nausea'], ['queasy', 'Nausea'], ['vomit', 'Vomiting'], ['headache', 'Headache'], ['fatigue', 'Fatigue'], ['tired', 'Fatigue'], ['insomnia', 'Poor sleep'], ["couldn't sleep", 'Poor sleep'], ['injection site', 'Injection-site reaction'], ['dizz', 'Dizziness'], ['palpitation', 'Heart rate up'], ['constipat', 'Constipation'], ['diarrh', 'Diarrhea'], ['reflux', 'Reflux'], ['heartburn', 'Reflux'], ['bloat', 'Bloating'], ['water retention', 'Water retention'], ['tingl', 'Numbness or tingling'], ['hair loss', 'Hair loss']];
  function readPost(p) {
    const text = `${p.title}. ${p.body}`;
    const s = text.toLowerCase();
    const du = s.match(/\b(\d+)\s?(day|week|month|year)s?\b/);
    const wk = s.match(/\b(week|month) ?(\d+)\b/);
    const duration = du ? `${du[1]} ${du[2]}${du[1] === '1' ? '' : 's'}` : wk ? `${wk[1]} ${wk[2]}` : null;
    const hits = (list) => list.reduce((n, re) => n + (re.test(s) ? 1 : 0), 0);
    const pos = hits(AI_POS); const neg = hits(AI_NEG); const neu = hits(AI_NEU);
    const outcome = pos || neg || neu ? (pos > neg && pos >= neu ? 'better' : neg > pos && neg >= neu ? 'worse' : 'same') : null;
    const negated = (w) => new RegExp(`\\b(no|without|zero|not any)\\s+(\\w+\\s)?${escapeRe(w)}`).test(s);
    const effects = [];
    SE_LEX.forEach(([k, label]) => { if (s.includes(k) && !negated(k) && !effects.includes(label)) effects.push(label); });
    const firstHand = /\b(i|i'm|i've|i'd|my|me)\b/i.test(text);
    const counts = p.kind !== 'question' && firstHand && !!outcome;
    return { counts, outcome: counts ? outcome : null, duration, side_effects: effects.slice(0, 3) };
  }

  // -------------------------------------------------------------------------
  // The Community Signal: 65% reported efficacy, 15% consistency, 10% diversity
  // of voices, 10% confidence. It starts from the public-forum baseline and moves
  // toward this community's first-hand reports as they add up. New accounts count
  // half. The real backend runs the same math in the database (private.signal_compute).
  // -------------------------------------------------------------------------
  const EXTERNAL_WEIGHT = 50;   // how many first-hand reports the public baseline is worth
  const r1 = (x) => Math.round(x * 10) / 10;
  const confidenceLabel = (c) => (c >= 80 ? 'High' : c >= 60 ? 'Moderate' : c >= 40 ? 'Building' : 'Low');
  const summaryLabel = (e) => (e >= 75 ? 'Mostly positive' : e >= 60 ? 'Leaning positive' : e >= 45 ? 'Mixed' : 'Mostly negative');
  function snapshotFrom(base, version) {
    const score = r1(0.65 * base.efficacy + 0.15 * base.consistency + 0.10 * base.diversity + 0.10 * base.confidence);
    return {
      score, efficacy: base.efficacy, consistency: base.consistency, diversity: base.diversity, confidence: base.confidence,
      first_hand: 0, same_for_me: 0, voices: 0, internal_share: 0, version, computed_at: now(),
    };
  }
  function computeSignal(cid) {
    const base = db.signal_baseline.find((b) => b.compound_id === cid) || null;
    const V = { better: 1, same: 0.5, worse: 0 };
    const tally = { better: 0, same: 0, worse: 0 };
    const voices = new Set();
    let n = 0; let sum = 0; let reports = 0; let sames = 0;
    const weight = (uid) => { const p = db.profiles.find((x) => x.id === uid); return p && isNewMember(p) ? 0.5 : 1; };
    for (const p of db.posts) {
      const rd = db.reads[p.id];
      if (p.compound_id !== cid || p.status !== 'visible' || !rd?.counts || !rd.outcome) continue;
      const add = (uid) => { const w = weight(uid); n += w; sum += w * V[rd.outcome]; tally[rd.outcome] += w; voices.add(uid); };
      add(p.author_id); reports += 1;
      db.same_for_me.forEach((s) => { if (s.post_id === p.id) { add(s.user_id); sames += 1; } });
    }
    if (!base && n < 3) return null;
    const N = base ? EXTERNAL_WEIGHT : 0;
    const B = base || { efficacy: 0, consistency: 0, diversity: 0, confidence: 0 };
    let entropy = 0;
    Object.values(tally).forEach((x) => { if (x > 0) entropy -= (x / n) * Math.log(x / n); });
    const inEff = n ? (100 * sum) / n : 0;
    const inCons = n ? 100 * (1 - entropy / Math.log(3)) : 0;
    const comp = {
      efficacy: (N * B.efficacy + n * inEff) / (N + n || 1),
      consistency: (N * B.consistency + n * inCons) / (N + n || 1),
      diversity: 100 - (100 - B.diversity) * Math.exp(-voices.size / 40),
      confidence: 100 - (100 - B.confidence) * Math.exp(-n / 60),
    };
    return {
      score: r1(0.65 * comp.efficacy + 0.15 * comp.consistency + 0.10 * comp.diversity + 0.10 * comp.confidence),
      efficacy: Math.round(comp.efficacy), consistency: Math.round(comp.consistency),
      diversity: Math.round(comp.diversity), confidence: Math.round(comp.confidence),
      first_hand: reports, same_for_me: sames, voices: voices.size,
      internal_share: Math.round((100 * n) / (N + n || 1)), computed_at: now(),
    };
  }
  function refreshSignal(cid) {
    const cur = computeSignal(cid);
    const slot = db.signal[cid];
    if (!cur) { delete db.signal[cid]; return; }
    if (!slot) { db.signal[cid] = { version: 1, prev: null, cur: { ...cur, version: 1 } }; return; }
    if (slot.cur && slot.cur.score === cur.score) { slot.cur = { ...cur, version: slot.version }; return; }
    slot.version += 1;
    slot.prev = slot.cur;
    slot.cur = { ...cur, version: slot.version };
  }
  const refreshFor = (postIds) => new Set([...postIds].map((id) => db.posts.find((p) => p.id === id)?.compound_id).filter(Boolean)).forEach(refreshSignal);

  // -------------------------------------------------------------------------
  // Who is signed in
  // -------------------------------------------------------------------------
  const myId = () => db.session?.user?.id || null;
  const me = () => db.profiles.find((p) => p.id === myId()) || null;
  const isMod = () => ['moderator', 'admin'].includes(me()?.role);
  const isNewMember = (u) => !u.trusted && Date.now() - Date.parse(u.created_at) < 7 * D;
  const handleOf = (id) => db.profiles.find((p) => p.id === id)?.handle || 'deleted';
  const compoundName = (id) => db.compounds.find((c) => c.id === id)?.name || id;
  const score = (table, key, item) => (item.base || 0) + db[table].filter((v) => v[key] === item.id).reduce((a, v) => a + v.value, 0);
  const myVote = (table, key, id) => db[table].find((v) => v[key] === id && v.user_id === myId())?.value ?? null;

  // -------------------------------------------------------------------------
  // The same checks the database runs on every post, comment and edit
  // -------------------------------------------------------------------------
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const TLDS = 'com|net|org|io|co|shop|store|us|uk|ca|ru|cn|xyz|biz|info|me|ly|gg|app|to|link|site|online|pro|bio|health|club|vip|eu|de|au|in';
  function check(raw, newMember) {
    const text = raw.toLowerCase();
    let verdict = 'ok';
    let message = null;
    const terms = [...db.watch_terms].sort((a, b) => (b.action === 'block') - (a.action === 'block') || a.id - b.id);
    for (const t of terms) {
      if (!new RegExp(`(^|[^a-z0-9])${escapeRe(t.term.toLowerCase())}($|[^a-z0-9])`).test(text)) continue;
      if (t.action === 'block') {
        return {
          verdict: 'block',
          message: t.reason === 'sourcing' ? "Asking or telling where to buy isn't allowed here (rule 1). Nothing was posted; edit it and try again."
            : t.reason === 'dosing' ? "Telling other people what dose to take isn't allowed here (rule 2). Share what you did instead."
              : 'This breaks the community rules, so nothing was posted.',
        };
      }
      if (verdict === 'ok') { verdict = 'hold'; message = `Held for a moderator (watched term: ${t.term})`; }
    }
    const hosts = new Set();
    for (const m of text.matchAll(/(?:https?:\/\/|www\.)([a-z0-9-]+(?:\.[a-z0-9-]+)+)/g)) hosts.add(m[1].replace(/^www\./, ''));
    for (const m of text.matchAll(new RegExp(`(?:^|[^a-z0-9@./-])((?:[a-z0-9-]+\\.)+(?:${TLDS}))(?=$|[^a-z0-9-])`, 'g'))) hosts.add(m[1].replace(/^www\./, ''));
    for (const host of hosts) {
      if (db.link_domains.some((d) => host === d || host.endsWith(`.${d}`))) continue;
      if (newMember) return { verdict: 'block', message: 'In your first week you can link only to studies and health agencies (rule 6). Nothing was posted; take the link out and try again.' };
      if (verdict === 'ok') { verdict = 'hold'; message = `Held for a moderator (link to ${host})`; }
    }
    if (verdict === 'ok' && (/[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/.test(text)
      || /(^|[^0-9])\(?[0-9]{3}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}($|[^0-9])/.test(text))) {
      verdict = 'hold'; message = 'Held for a moderator (contact details)';
    }
    return { verdict, message };
  }
  function canWrite() {
    const u = me();
    if (!u) return err('Sign in first.');
    if (u.status !== 'active') return err('Your account can’t post right now.');
    return null;
  }
  function dailyLimit(rows, u, normal, first, noun) {
    const today = rows.filter((x) => x.author_id === u.id && Date.now() - Date.parse(x.created_at) < D).length;
    const limit = isNewMember(u) ? first : normal;
    return today >= limit ? err(`You can ${noun} ${limit} times a day${isNewMember(u) ? ' in your first week' : ''}. Try again tomorrow.`) : null;
  }

  // -------------------------------------------------------------------------
  // What members read (the database's views)
  // -------------------------------------------------------------------------
  function queue() {
    const open = db.reports.filter((r) => r.status === 'open');
    const items = [];
    const add = (kind, x, extra) => {
      const rs = open.filter((r) => r.target_kind === kind && r.target_id === x.id);
      if (kind !== 'member' && x.status !== 'held' && !rs.length) return;
      if (kind === 'member' && !rs.length) return;
      items.push({
        target_kind: kind, target_id: x.id, status: x.status ?? null, status_reason: x.status_reason ?? null,
        title: null, body: null, compound_id: null, author_id: x.author_id ?? x.id, author_handle: handleOf(x.author_id ?? x.id),
        reports: rs.length, reasons: rs.length ? [...new Set(rs.map((r) => r.reason))] : null,
        waiting_since: rs.length ? rs.map((r) => r.created_at).sort()[0] : x.created_at, ...extra(x),
      });
    };
    db.posts.forEach((p) => add('post', p, (x) => ({ title: x.title, body: x.body, compound_id: x.compound_id })));
    db.comments.forEach((c) => add('comment', c, (x) => ({ body: x.body })));
    db.profiles.forEach((p) => add('member', { id: p.id, created_at: p.created_at }, () => ({ status: null })));
    return items;
  }
  const VIEWS = {
    feed: () => db.posts.filter((p) => p.status === 'visible' || p.author_id === myId()).map((p) => ({
      id: p.id, author_id: p.author_id, author_handle: handleOf(p.author_id), compound_id: p.compound_id,
      compound_name: compoundName(p.compound_id), kind: p.kind, title: p.title, body: p.body, status: p.status,
      status_reason: p.author_id === myId() ? p.status_reason : null, created_at: p.created_at, edited_at: p.edited_at,
      score: score('post_votes', 'post_id', p), my_vote: myVote('post_votes', 'post_id', p.id), is_mine: p.author_id === myId(),
      comment_count: db.comments.filter((c) => c.post_id === p.id && c.status === 'visible').length,
      counts_for_signal: !!db.reads[p.id]?.counts && p.status === 'visible', outcome: db.reads[p.id]?.outcome ?? null,
      duration: db.reads[p.id]?.duration ?? null, side_effects: db.reads[p.id]?.side_effects ?? [],
      same_count: db.same_for_me.filter((x) => x.post_id === p.id).length,
      i_same: db.same_for_me.some((x) => x.post_id === p.id && x.user_id === myId()),
      signal_score: db.signal[p.compound_id]?.cur?.score ?? null,
    })),
    thread_comments: () => db.comments.filter((c) => c.status === 'visible' || c.author_id === myId()).map((c) => ({
      id: c.id, post_id: c.post_id, author_id: c.author_id, author_handle: handleOf(c.author_id), body: c.body,
      status: c.status, status_reason: c.author_id === myId() ? c.status_reason : null, created_at: c.created_at,
      edited_at: c.edited_at, score: score('comment_votes', 'comment_id', c), my_vote: myVote('comment_votes', 'comment_id', c.id),
      is_mine: c.author_id === myId(),
    })),
    compounds: () => db.compounds,
    signal_board: () => Object.entries(db.signal).map(([cid, slot]) => {
      const c = db.compounds.find((x) => x.id === cid) || { name: cid, category: '' };
      const b = db.signal_baseline.find((x) => x.compound_id === cid);
      const cur = slot.cur;
      return {
        compound_id: cid, compound_name: c.name, category: c.category, score: cur.score, prev_score: slot.prev?.score ?? null,
        efficacy: cur.efficacy, consistency: cur.consistency, diversity: cur.diversity, confidence: cur.confidence,
        confidence_label: confidenceLabel(cur.confidence), summary_label: summaryLabel(cur.efficacy),
        first_hand: cur.first_hand, same_for_me: cur.same_for_me, voices: cur.voices, internal_share: cur.internal_share,
        themes: b?.themes || [], source_families: b?.source_families || [], version: cur.version, computed_at: cur.computed_at,
      };
    }),
    mod_queue: () => (isMod() ? queue() : []),
    signal_alerts: () => (isMod() ? db.alerts : []),
    watch_terms: () => (isMod() ? db.watch_terms : []),
    invites: () => (isMod() ? db.invites : []),
  };

  // -------------------------------------------------------------------------
  // What members can change
  // -------------------------------------------------------------------------
  function voteTable(table, key, items) {
    return {
      insert(v) {
        const u = me();
        if (!u) return err('Sign in first.');
        const it = items().find((x) => x.id === v[key]);
        if (!it || it.status !== 'visible') return err('You can’t vote on that.');
        if (it.author_id === u.id) return err('You can’t vote on your own posts.');
        if (![1, -1].includes(v.value)) return err('A vote is up or down.');
        if (db[table].some((x) => x[key] === v[key] && x.user_id === u.id)) return err('duplicate key value', '23505');
        db[table].push({ [key]: v[key], user_id: u.id, value: v.value, created_at: now() });
        return ok([]);
      },
      update(v, match) {
        db[table].forEach((x) => { if (match(x) && x.user_id === myId()) x.value = v.value; });
        return ok([]);
      },
      delete(_, match) {
        db[table] = db[table].filter((x) => !(match(x) && x.user_id === myId()));
        return ok([]);
      },
    };
  }
  function dropContent(postIds, commentIds) {
    const touched = new Set(db.posts.filter((p) => postIds.has(p.id)).map((p) => p.compound_id));
    db.posts = db.posts.filter((p) => !postIds.has(p.id));
    db.same_for_me = db.same_for_me.filter((x) => !postIds.has(x.post_id));
    postIds.forEach((id) => delete db.reads[id]);
    touched.forEach(refreshSignal);
    db.comments = db.comments.filter((c) => !commentIds.has(c.id) && !postIds.has(c.post_id));
    const keep = new Set(db.comments.map((c) => c.id));
    db.post_votes = db.post_votes.filter((v) => !postIds.has(v.post_id));
    db.comment_votes = db.comment_votes.filter((v) => keep.has(v.comment_id));
  }
  const WRITES = {
    posts: {
      insert(v) {
        const stop = canWrite();
        if (stop) return stop;
        const u = me();
        const title = String(v.title || '').trim();
        const body = String(v.body || '').trim();
        if (!db.compounds.some((c) => c.id === v.compound_id)) return err('Choose a compound.');
        if (title.length < 5 || title.length > 140) return err('A title needs 5 to 140 characters.');
        if (!body || body.length > 10000) return err('A post needs some text, up to 10,000 characters.');
        const limited = dailyLimit(db.posts, u, 10, 3, 'post');
        if (limited) return limited;
        const c = check(`${title}\n${body}`, isNewMember(u));
        if (c.verdict === 'block') return err(c.message, 'P0001');
        const row = {
          id: newId(), author_id: u.id, compound_id: v.compound_id, kind: v.kind === 'question' ? 'question' : 'experience',
          title, body, status: c.verdict === 'hold' ? 'held' : 'visible', status_reason: c.verdict === 'hold' ? c.message : null,
          created_at: now(), edited_at: null, base: 0,
        };
        db.posts.push(row);
        db.reads[row.id] = readPost(row);
        refreshSignal(row.compound_id);
        return ok([{ id: row.id, status: row.status }]);
      },
      update(v, match) {
        const u = me();
        const rows = db.posts.filter((p) => match(p) && p.author_id === u?.id && p.status !== 'removed');
        for (const p of rows) {
          const title = String(v.title ?? p.title).trim();
          const body = String(v.body ?? p.body).trim();
          const c = check(`${title}\n${body}`, isNewMember(u));
          if (c.verdict === 'block') return err(c.message, 'P0001');
          Object.assign(p, { title, body, edited_at: now() });
          if (c.verdict === 'hold') Object.assign(p, { status: 'held', status_reason: c.message });
          db.reads[p.id] = readPost(p);
          refreshSignal(p.compound_id);
        }
        return ok(rows);
      },
      delete(_, match) {
        const ids = new Set(db.posts.filter((p) => match(p) && p.author_id === myId()).map((p) => p.id));
        dropContent(ids, new Set());
        return ok([]);
      },
    },
    comments: {
      insert(v) {
        const stop = canWrite();
        if (stop) return stop;
        const u = me();
        const p = db.posts.find((x) => x.id === v.post_id);
        if (!p || p.status !== 'visible') return err('You can only comment on visible posts.');
        const body = String(v.body || '').trim();
        if (!body || body.length > 5000) return err('A comment needs some text, up to 5,000 characters.');
        const limited = dailyLimit(db.comments, u, 100, 20, 'comment');
        if (limited) return limited;
        const c = check(body, isNewMember(u));
        if (c.verdict === 'block') return err(c.message, 'P0001');
        const row = {
          id: newId(), post_id: p.id, author_id: u.id, body, status: c.verdict === 'hold' ? 'held' : 'visible',
          status_reason: c.verdict === 'hold' ? c.message : null, created_at: now(), edited_at: null, base: 0,
        };
        db.comments.push(row);
        return ok([{ id: row.id, status: row.status, status_reason: row.status_reason }]);
      },
      update(v, match) {
        const u = me();
        const rows = db.comments.filter((x) => match(x) && x.author_id === u?.id && x.status !== 'removed');
        for (const x of rows) {
          const body = String(v.body ?? x.body).trim();
          const c = check(body, isNewMember(u));
          if (c.verdict === 'block') return err(c.message, 'P0001');
          Object.assign(x, { body, edited_at: now() });
          if (c.verdict === 'hold') Object.assign(x, { status: 'held', status_reason: c.message });
        }
        return ok(rows);
      },
      delete(_, match) {
        const ids = new Set(db.comments.filter((x) => match(x) && x.author_id === myId()).map((x) => x.id));
        dropContent(new Set(), ids);
        return ok([]);
      },
    },
    same_for_me: {
      insert(v) {
        const u = me();
        if (!u) return err('Sign in first.');
        const p = db.posts.find((x) => x.id === v.post_id);
        if (!p || p.status !== 'visible' || !db.reads[p.id]?.counts) return err('Only first-hand reports can take a Same for me.');
        if (p.author_id === u.id) return err('That’s your own report.');
        if (db.same_for_me.some((x) => x.post_id === p.id && x.user_id === u.id)) return err('duplicate key value', '23505');
        db.same_for_me.push({ post_id: p.id, user_id: u.id, created_at: now() });
        refreshSignal(p.compound_id);
        return ok([]);
      },
      delete(_, match) {
        const gone = db.same_for_me.filter((x) => match(x) && x.user_id === myId());
        db.same_for_me = db.same_for_me.filter((x) => !gone.includes(x));
        refreshFor(gone.map((x) => x.post_id));
        return ok([]);
      },
    },
    post_votes: voteTable('post_votes', 'post_id', () => db.posts),
    comment_votes: voteTable('comment_votes', 'comment_id', () => db.comments),
    reports: {
      insert(v) {
        const u = me();
        if (!u) return err('Sign in first.');
        if (db.reports.some((r) => r.reporter_id === u.id && r.target_kind === v.target_kind && r.target_id === v.target_id)) return err('duplicate key value', '23505');
        const row = { id: newId(), ...v, reporter_id: u.id, status: 'open', created_at: now() };
        db.reports.push(row);
        return ok([row]);
      },
    },
    watch_terms: {
      insert(v) {
        if (!isMod()) return err('permission denied for table watch_terms');
        const term = String(v.term || '').trim().toLowerCase();
        if (!term) return err('Type a word or phrase.');
        if (db.watch_terms.some((t) => t.term === term)) return err('duplicate key value', '23505');
        db.watch_terms.push({ id: Math.max(0, ...db.watch_terms.map((t) => t.id)) + 1, term, action: v.action === 'block' ? 'block' : 'hold', reason: v.reason || 'other' });
        return ok([]);
      },
      delete(_, match) {
        if (!isMod()) return err('permission denied for table watch_terms');
        db.watch_terms = db.watch_terms.filter((t) => !match(t));
        return ok([]);
      },
    },
    invites: {
      insert(v) {
        if (!isMod()) return err('permission denied for table invites');
        const code = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        db.invites.unshift({ code, note: v.note || null, trusted: !!v.trusted, max_uses: Math.min(500, Math.max(1, Number(v.max_uses) || 1)), uses: 0, expires_at: null, created_at: now() });
        return ok([]);
      },
    },
  };

  class Query {
    constructor(table) {
      Object.assign(this, { table, op: 'select', filters: [], sortBy: null, max: null, payload: null, returning: false });
    }
    select() { if (this.op !== 'select') this.returning = true; return this; }
    insert(v) { this.op = 'insert'; this.payload = v; return this; }
    update(v) { this.op = 'update'; this.payload = v; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(col, val) { this.filters.push([col, val]); return this; }
    order(col, opts = {}) { this.sortBy = [col, opts.ascending !== false]; return this; }
    limit(n) { this.max = n; return this; }
    then(resolve, reject) { return this.run().then(resolve, reject); }
    async run() {
      await load();
      await pause();
      try { return this.exec(); } catch (e) { return err(String(e?.message || e)); } finally { save(); }
    }
    exec() {
      const match = (row) => this.filters.every(([c, v]) => String(row[c]) === String(v));
      if (this.op === 'select') {
        const view = VIEWS[this.table];
        if (!view) return err(`relation "${this.table}" does not exist`);
        let rows = clone(view()).filter(match);
        if (this.sortBy) {
          const [c, asc] = this.sortBy;
          rows.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
        }
        if (this.max != null) rows = rows.slice(0, this.max);
        return ok(rows);
      }
      const table = WRITES[this.table];
      if (!table?.[this.op]) return err(`permission denied for table ${this.table}`, '42501');
      const res = table[this.op](this.payload, match);
      if (res.error) return res;
      return ok(this.returning ? clone(res.data) : null);
    }
  }

  // -------------------------------------------------------------------------
  // The database functions the app calls
  // -------------------------------------------------------------------------
  const RPCS = {
    me: () => { const u = me(); return ok(u ? [clone(u)] : []); },
    complete_signup: (a) => {
      if (!db.session) return err('Sign in first.');
      if (me()) return err('You already have a profile.');
      const handle = String(a.handle || '').trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(handle)) return err('A handle is 3 to 20 letters, numbers or _.');
      if (db.profiles.some((p) => p.handle.toLowerCase() === handle.toLowerCase())) return err('That handle is taken. Try another.');
      const inv = db.invites.find((i) => i.code === String(a.invite_code || '').trim().toUpperCase());
      if (!inv || inv.uses >= inv.max_uses) return err('That invite code doesn’t work. In the preview, use PREVIEW.');
      if (!a.confirm_adult) return err('Miracle Health is for adults 18 and over.');
      if (!a.health_data_consent) return err('To join, agree to how what you post about your health is collected and shown.');
      inv.uses += 1;
      // In the preview everyone joins as a moderator, so every screen can be seen
      db.profiles.push({ id: myId(), handle, role: 'moderator', status: 'active', suspended_until: null, trusted: inv.trusted, created_at: now() });
      return ok(null);
    },
    moderate: (a) => {
      if (!isMod()) return err('Only moderators can do that.');
      if (a.target_kind === 'member') {
        const p = db.profiles.find((x) => x.id === a.target_id);
        if (!p) return err('That member no longer exists.');
        if (p.id === myId()) return err('You can’t moderate your own account.');
        if (a.action === 'suspend') Object.assign(p, { status: 'suspended', suspended_until: new Date(Date.now() + (a.days || 7) * D).toISOString() });
        if (a.action === 'ban') {
          p.status = 'banned';
          [...db.posts, ...db.comments].forEach((x) => { if (x.author_id === p.id) Object.assign(x, { status: 'removed', status_reason: a.reason }); });
        }
      } else {
        const x = (a.target_kind === 'post' ? db.posts : db.comments).find((r) => r.id === a.target_id);
        if (!x) return err('That is gone already.');
        if (a.action === 'remove') Object.assign(x, { status: 'removed', status_reason: a.reason });
        if (a.action === 'restore') Object.assign(x, { status: 'visible', status_reason: null });
        if (a.action === 'hold') Object.assign(x, { status: 'held', status_reason: a.reason });
        if (['remove', 'restore', 'dismiss'].includes(a.action)) {
          db.reports.forEach((r) => {
            if (r.target_kind === a.target_kind && r.target_id === a.target_id && r.status === 'open') {
              Object.assign(r, { status: a.action === 'dismiss' ? 'dismissed' : 'actioned', resolved_at: now() });
            }
          });
        }
      }
      db.mod_log.push({ ...a, moderator_id: myId(), created_at: now() });
      new Set(db.posts.map((p) => p.compound_id)).forEach(refreshSignal);
      return ok(null);
    },
    review_alert: (a) => {
      if (!isMod()) return err('Only moderators can do that.');
      const al = db.alerts.find((x) => x.id === a.alert_id);
      if (al) al.status = 'reviewed';
      return ok(null);
    },
    beta_metrics: () => {
      if (!isMod()) return err('Only moderators can do that.');
      const uses = db.invites.reduce((s, i) => s + i.uses, 0);
      const places = db.invites.reduce((s, i) => s + i.max_uses, 0);
      return ok([
        { metric: 'members', value: db.profiles.length, detail: 'Signed up with an invite' },
        { metric: 'invites_redeemed', value: uses, detail: `${places} places on ${db.invites.length} codes` },
        { metric: 'week1_contributors_pct', value: 64, detail: 'Sample: posted or commented in their first 7 days (target 60)' },
        { metric: 'week2_return_pct', value: 45, detail: 'Sample: active again in days 8 to 14 (target 40)' },
        { metric: 'median_hours_to_first_contribution', value: 19, detail: 'Sample: from joining to a first post or comment' },
        { metric: 'reports_open', value: db.reports.filter((r) => r.status === 'open').length, detail: 'Waiting for a moderator' },
        { metric: 'report_resolution_median_minutes', value: 95, detail: 'Sample: half of reports are decided faster' },
        { metric: 'report_resolution_p90_minutes', value: 610, detail: 'Sample: 9 in 10 reports are decided faster (target 720)' },
        { metric: 'held_waiting', value: [...db.posts, ...db.comments].filter((x) => x.status === 'held').length, detail: 'Held posts and comments not yet reviewed' },
        { metric: 'signal_alerts_open', value: db.alerts.filter((x) => x.status === 'open').length, detail: 'New accounts piling onto one compound' },
      ]);
    },
  };

  // -------------------------------------------------------------------------
  // Sign-in and the server function
  // -------------------------------------------------------------------------
  const tell = (event, session) => listeners.forEach((f) => { try { f(event, session); } catch (_) { /* listener */ } });
  const auth = {
    async getSession() { await load(); return { data: { session: db.session }, error: null }; },
    onAuthStateChange(cb) {
      listeners.push(cb);
      return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } } } };
    },
    async signInWithOtp({ phone }) {
      await load(); await pause();
      if (!/^\+\d{8,15}$/.test(phone || '')) return { data: null, error: { message: 'Enter a valid phone number.' } };
      return { data: {}, error: null };
    },
    async verifyOtp({ phone, token }) {
      await load(); await pause();
      if (token !== '123456') return { data: { session: null, user: null }, error: { message: 'That code isn’t right. In the preview the code is 123456.' } };
      const session = { access_token: 'preview', user: { id: `u_${String(phone).replace(/\D/g, '')}`, phone } };
      db.session = session; save(); tell('SIGNED_IN', session);
      return { data: { session, user: session.user }, error: null };
    },
    async signOut() { await load(); db.session = null; save(); tell('SIGNED_OUT', null); return { error: null }; },
  };
  const functions = {
    async invoke(name, opts = {}) {
      await load(); await pause();
      if (name !== 'delete-account') return { data: null, error: { message: 'No such function' } };
      if (!me()) return { data: null, error: { message: 'Sign in first' } };
      if (opts.body?.confirm !== 'DELETE') return { data: null, error: { message: 'Confirm with DELETE' } };
      const id = myId();
      dropContent(new Set(db.posts.filter((p) => p.author_id === id).map((p) => p.id)), new Set(db.comments.filter((c) => c.author_id === id).map((c) => c.id)));
      db.post_votes = db.post_votes.filter((v) => v.user_id !== id);
      db.comment_votes = db.comment_votes.filter((v) => v.user_id !== id);
      db.same_for_me = db.same_for_me.filter((x) => x.user_id !== id);
      db.reports.forEach((r) => { if (r.reporter_id === id) r.reporter_id = null; });
      db.profiles = db.profiles.filter((p) => p.id !== id);
      new Set(db.posts.map((p) => p.compound_id)).forEach(refreshSignal);
      save();
      return { data: { deleted: true }, error: null };
    },
  };

  const client = {
    auth,
    functions,
    from: (table) => new Query(table),
    async rpc(name, args = {}) {
      await load(); await pause();
      const f = RPCS[name];
      const out = f ? f(args) : err(`function ${name} does not exist`);
      save();
      return out;
    },
  };
  window.supabase = { createClient: () => client };

  // A note on every screen, so nobody mistakes the sample posts for real ones
  const banner = () => {
    const b = document.createElement('div');
    b.className = 'demo-banner';
    b.setAttribute('role', 'note');
    b.textContent = 'Preview: sample posts from made-up members, reset when you close the tab. '
      + 'Sign in with any number, code 123456, invite PREVIEW.';
    document.body.prepend(b);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner);
  else banner();
})();
