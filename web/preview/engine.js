// Preview mode: the real database, in this browser tab.
//
// PGlite (Postgres compiled to WebAssembly) runs the very same migrations as the
// live Supabase project: every access rule, trigger, point and Signal
// calculation is the production code. This file stands in only for what lives
// outside the database: the API layer, sign-in by text message, live updates,
// Claude's read of each post, and other members. It stays in this tab (kept
// while you reload, gone when the tab closes) and is never part of a real build.

const BASE = new URL('./', import.meta.url);
// PGlite's IndexedDB storage rejects one harmless "no such file" (errno 44) while
// it creates a fresh database. It isn't an error, so it stays out of the console.
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.name === 'ErrnoError' && e.reason?.errno === 44) e.preventDefault(); });
const SESSION_KEY = 'mh_preview_session';
const SID_KEY = 'mh_preview_sid';
const listeners = new Set();
let db = null;
let fnMeta = null;
let enumArrays = new Set();   // arrays of our own types (e.g. report reasons) come back as text
let session = null;
try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { session = null; }

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const pill = document.createElement('div');
function progress(text) {
  if (!pill.isConnected) {
    pill.className = 'preview-boot';
    pill.setAttribute('role', 'status');
    document.body?.append(pill);
  }
  pill.textContent = text;
}

async function fetchBytes(path, onBytes) {
  const res = await fetch(new URL(path, BASE));
  if (!res.ok) throw new Error(`Couldn't load ${path}`);
  const reader = res.body.getReader();
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onBytes(value.length);
  }
  let bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  // Shipped gzipped; the host may already have unzipped it
  if (bytes[0] === 0x1f && bytes[1] === 0x8b && 'DecompressionStream' in window) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
    bytes = new Uint8Array(await out.arrayBuffer());
  }
  return bytes;
}

async function boot() {
  const manifest = await fetch(new URL('manifest.json', BASE)).then((r) => r.json());
  progress('Starting the preview…');
  const total = manifest.assets.reduce((n, a) => n + a.bytes, 0);
  let loaded = 0;
  const tick = (n) => { loaded += n; progress(`Loading the preview database · ${Math.min(99, Math.round((100 * loaded) / total))}%`); };
  const gz = 'DecompressionStream' in window;
  const pick = (name) => manifest.assets.find((a) => a.name === name);
  const file = (name) => (gz ? pick(name).gz : pick(name).raw);
  const [{ PGlite }, wasm, initdb, data] = await Promise.all([
    import(new URL('pglite/index.js', BASE).href),
    fetchBytes(file('pglite.wasm'), tick).then((b) => WebAssembly.compile(b)),
    fetchBytes(file('initdb.wasm'), tick).then((b) => WebAssembly.compile(b)),
    fetchBytes(file('pglite.data'), tick).then((b) => new Blob([b])),
  ]);
  progress('Setting up the sample community…');

  let sid = null;
  try { sid = sessionStorage.getItem(SID_KEY); } catch (_) { /* private mode */ }
  if (!sid) {
    sid = Math.random().toString(36).slice(2, 10);
    try { sessionStorage.setItem(SID_KEY, sid); } catch (_) { /* private mode */ }
  }
  const name = `mh-preview-${manifest.version}-${sid}`;
  const opts = {
    relaxedDurability: true, pgliteWasmModule: wasm, initdbWasmModule: initdb, fsBundle: data,
    parsers: {
      1700: (v) => Number(v), 20: (v) => Number(v),
      1184: (v) => v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'),
      1114: (v) => v.replace(' ', 'T'), 1082: (v) => v,
    },
  };
  try {
    db = await PGlite.create({ ...opts, dataDir: `idb://${name}` });
  } catch (_) {
    db = await PGlite.create(opts);   // no IndexedDB (private window): memory only
  }
  const { rows } = await db.query("select to_regclass('public.signal_snapshots') is not null as ok");
  if (!rows[0].ok) {
    for (const f of manifest.sql) {
      const sql = await fetch(new URL(`sql/${f}`, BASE)).then((r) => r.text());
      await db.exec(sql);
    }
    // Sample members' Signal moves look recent, but not all at the same second
    await db.exec(`update public.signal_snapshots set computed_at = computed_at - (random() * interval '20 hours') where version > 1;`);
  }
  await db.exec("set timezone to 'UTC'");
  const meta = await db.query(`select p.proname, p.proretset, t.typtype, t.typname from pg_proc p join pg_type t on t.oid = p.prorettype
                               where p.pronamespace = 'public'::regnamespace`);
  fnMeta = Object.fromEntries(meta.rows.map((r) => [r.proname, r]));
  const arr = await db.query("select t.oid from pg_type t join pg_type e on e.oid = t.typelem where e.typtype = 'e'");
  enumArrays = new Set(arr.rows.map((r) => r.oid));
  pill.remove();
  cleanup(name);
  setInterval(pump, 2500);
  setTimeout(simulate, 15000);
  return db;
}
const ready = boot().catch((e) => { progress(`The preview couldn’t start: ${e.message}. Try a current Chrome, Safari or Firefox.`); throw e; });

// Old preview databases from closed tabs
async function cleanup(keep) {
  try {
    const dbs = await indexedDB.databases?.();
    (dbs || []).forEach((d) => { if (d.name && d.name.includes('mh-preview-') && !d.name.includes(keep)) indexedDB.deleteDatabase(d.name); });
  } catch (_) { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Running SQL as a role, the way Supabase's API does
// ---------------------------------------------------------------------------
async function as(role, uid, fn) {
  await ready;
  return db.transaction(async (tx) => {
    const claims = JSON.stringify(uid ? { sub: uid, role, aud: 'authenticated' } : { role });
    await tx.query(`select set_config('role', $1, true), set_config('request.jwt.claims', $2, true),
                           set_config('request.jwt.claim.sub', $3, true), set_config('request.jwt.claim.role', $1, true)`,
    [role, claims, uid || '']);
    return fn(tx);
  });
}
const asMe = (fn) => (session?.user?.id ? as('authenticated', session.user.id, fn) : as('anon', null, fn));
const asOwner = async (fn) => { await ready; return fn(db); };
// Postgres array text ({a,b}) to a JS array, the way the real API returns it
const parseArray = (v) => (typeof v !== 'string' ? v : v === '{}' ? []
  : v.replace(/^\{|\}$/g, '').split(',').map((x) => (x === 'NULL' ? null : x.replace(/^"|"$/g, ''))));
function tidy(res) {
  const cols = (res.fields || []).filter((f) => enumArrays.has(f.dataTypeID)).map((f) => f.name);
  if (cols.length) res.rows.forEach((r) => cols.forEach((c) => { r[c] = parseArray(r[c]); }));
  return res;
}
const toErr = (e) => ({ message: e?.message || String(e), code: e?.code || null, details: e?.detail || null, hint: e?.hint || null });
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Bad identifier ${s}`);
  return `"${s}"`;
};

// ---------------------------------------------------------------------------
// The query builder (the slice of supabase-js the app uses)
// ---------------------------------------------------------------------------
class Query {
  constructor(table) {
    Object.assign(this, { table, op: 'select', cols: '*', returning: null, wheres: [], orders: [], max: null, offset: null, payload: null, single: null });
  }
  select(cols = '*') { if (this.op === 'select') this.cols = cols; else this.returning = cols; return this; }
  insert(v) { this.op = 'insert'; this.payload = v; return this; }
  update(v) { this.op = 'update'; this.payload = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.wheres.push([c, '=', v]); return this; }
  neq(c, v) { this.wheres.push([c, '<>', v]); return this; }
  gt(c, v) { this.wheres.push([c, '>', v]); return this; }
  gte(c, v) { this.wheres.push([c, '>=', v]); return this; }
  lt(c, v) { this.wheres.push([c, '<', v]); return this; }
  lte(c, v) { this.wheres.push([c, '<=', v]); return this; }
  ilike(c, v) { this.wheres.push([c, 'ilike', v]); return this; }
  like(c, v) { this.wheres.push([c, 'like', v]); return this; }
  in(c, list) { this.wheres.push([c, 'in', list]); return this; }
  contains(c, list) { this.wheres.push([c, 'contains', list]); return this; }
  is(c, v) { this.wheres.push([c, 'is', v]); return this; }
  order(c, o = {}) { this.orders.push([c, o.ascending !== false, o.nullsFirst]); return this; }
  limit(n) { this.max = n; return this; }
  range(a, b) { this.offset = a; this.max = b - a + 1; return this; }
  maybeSingle() { this.single = 'maybe'; return this; }
  then(resolve, reject) { return this.run().then(resolve, reject); }

  sql() {
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    const cols = (s) => (s.trim() === '*' ? '*' : s.split(',').map((c) => ident(c.trim())).join(', '));
    const where = this.wheres.length ? ` where ${this.wheres.map(([c, op, v]) => {
      if (op === 'is') return `${ident(c)} is ${v === null ? 'null' : v ? 'true' : 'false'}`;
      if (op === 'in') return `${ident(c)} = any(${p(v)})`;
      if (op === 'contains') return `${ident(c)} @> ${p(v)}::text[]`;
      return `${ident(c)} ${op} ${p(v)}`;
    }).join(' and ')}` : '';
    const t = `public.${ident(this.table)}`;
    const ret = this.returning ? ` returning ${cols(this.returning)}` : this.table === 'posts' ? ' returning id' : '';
    if (this.op === 'select') {
      const order = this.orders.length ? ` order by ${this.orders.map(([c, asc, nf]) => `${ident(c)} ${asc ? 'asc' : 'desc'}${nf === undefined ? '' : nf ? ' nulls first' : ' nulls last'}`).join(', ')}` : '';
      return [`select ${cols(this.cols)} from ${t}${where}${order}${this.max != null ? ` limit ${Number(this.max)}` : ''}${this.offset != null ? ` offset ${Number(this.offset)}` : ''}`, params];
    }
    if (this.op === 'insert') {
      const rows = [this.payload].flat();
      const keys = Object.keys(rows[0]);
      const values = rows.map((r) => `(${keys.map((k) => p(r[k])).join(', ')})`).join(', ');
      return [`insert into ${t} (${keys.map(ident).join(', ')}) values ${values}${ret}`, params];
    }
    if (this.op === 'update') {
      const sets = Object.entries(this.payload).map(([k, v]) => `${ident(k)} = ${p(v)}`).join(', ');
      return [`update ${t} set ${sets}${where}${ret}`, params];
    }
    return [`delete from ${t}${where}${ret}`, params];
  }

  async run() {
    try {
      const [text, params] = this.sql();
      const res = tidy(await asMe((tx) => tx.query(text, params)));
      if (this.op !== 'select') {
        if (this.table === 'posts' && this.op !== 'delete') res.rows.forEach((r) => r.id && aiRead(r.id));
        soon();
      }
      const data = this.op === 'select' || this.returning ? res.rows : null;
      if (this.single) return { data: data?.[0] ?? null, error: null };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: toErr(e) };
    }
  }
}

// ---------------------------------------------------------------------------
// Database functions
// ---------------------------------------------------------------------------
async function rpc(name, args = {}) {
  try {
    await ready;
    const meta = fnMeta[name];
    if (!meta) return { data: null, error: { message: `function ${name} does not exist`, code: '42883' } };
    const keys = Object.keys(args || {});
    const call = `public.${ident(name)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')})`;
    const res = tidy(await asMe((tx) => tx.query(`select * from ${call}`, keys.map((k) => args[k]))));
    soon();
    if (name === 'complete_signup' && session?.user?.id) {
      // In the preview everyone joins as a moderator, so every screen can be seen
      await asOwner((d) => d.query(`update public.profiles set role = 'moderator' where id = $1`, [session.user.id]));
    }
    let data;
    if (name === 'create_post' && res.rows[0]) aiRead(Object.values(res.rows[0])[0]);
    if (meta.proretset) data = res.rows;
    else if (meta.typname === 'void') data = null;
    else if (meta.typtype === 'c') data = res.rows[0] ?? null;
    else data = res.rows[0] ? Object.values(res.rows[0])[0] : null;
    return { data, error: null };
  } catch (e) {
    return { data: null, error: toErr(e) };
  }
}

// ---------------------------------------------------------------------------
// Sign-in: any number, code 123456
// ---------------------------------------------------------------------------
async function userIdFor(phone) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`preview-phone:${phone}`))).slice(0, 16);
  d[6] = (d[6] & 0x0f) | 0x40; d[8] = (d[8] & 0x3f) | 0x80;
  const x = [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const tell = (event) => listeners.forEach((f) => { try { f(event, session); } catch (_) { /* listener */ } });
const saveSession = () => { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) { /* private mode */ } };
const auth = {
  async getSession() { await ready; return { data: { session }, error: null }; },
  onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
  async signInWithOtp({ phone }) {
    await ready;
    if (!/^\+\d{8,15}$/.test(phone || '')) return { data: null, error: { message: 'Enter a valid phone number.' } };
    return { data: {}, error: null };
  },
  async verifyOtp({ phone, token }) {
    await ready;
    if (String(token).trim() !== '123456') return { data: { session: null, user: null }, error: { message: 'That code isn’t right. In the preview the code is 123456.' } };
    const id = await userIdFor(phone);
    await asOwner((d) => d.query(`insert into auth.users (id, aud, role, phone, phone_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
                                  values ($1, 'authenticated', 'authenticated', $2, now(), now(), now(), '{}', '{}') on conflict (id) do nothing`, [id, phone.replace('+', '')]));
    session = { access_token: 'preview', user: { id, phone } };
    saveSession(); tell('SIGNED_IN');
    return { data: { session, user: session.user }, error: null };
  },
  async signOut() { session = null; saveSession(); tell('SIGNED_OUT'); return { error: null }; },
};

const functions = {
  async invoke(name, opts = {}) {
    await ready;
    if (name !== 'delete-account') return { data: null, error: { message: 'No such function' } };
    if (!session?.user?.id) return { data: null, error: { message: 'Sign in first' } };
    if (opts.body?.confirm !== 'DELETE') return { data: null, error: { message: 'Confirm with DELETE' } };
    await asOwner((d) => d.query('delete from auth.users where id = $1', [session.user.id]));
    soon();
    return { data: { deleted: true }, error: null };
  },
};

// ---------------------------------------------------------------------------
// Live updates (Supabase Realtime): new rows, checked against the access rules
// by reading them as the signed-in member
// ---------------------------------------------------------------------------
const channels = new Set();
const marks = { snap: null, notifAt: null, notifId: null, postAt: null };
async function initMarks() {
  const r = await asOwner((d) => d.query(`select (select coalesce(max(id), 0) from public.signal_snapshots) as snap,
    (select coalesce(max(created_at), now()) from public.notifications) as nat, (select coalesce(max(id), 0) from public.notifications) as nid,
    (select coalesce(max(created_at), now()) from public.posts) as pat`));
  const m = r.rows[0];
  Object.assign(marks, { snap: m.snap, notifAt: m.nat, notifId: m.nid, postAt: m.pat });
}
function channel() {
  const ch = {
    subs: [],
    on(_type, filter, cb) { this.subs.push({ ...filter, cb }); return this; },
    subscribe(cb) { channels.add(this); if (marks.snap == null) ready.then(initMarks); cb?.('SUBSCRIBED'); return this; },
    unsubscribe() { channels.delete(this); return Promise.resolve('ok'); },
  };
  return ch;
}
const emit = (table, eventType, row) => channels.forEach((ch) => ch.subs.forEach((s) => {
  if (s.table === table && (s.event === '*' || s.event === eventType)) { try { s.cb({ eventType, table, schema: 'public', new: row, old: {} }); } catch (e) { console.error(e); } }
}));
let pumping = false;
async function pump() {
  if (pumping || !channels.size || marks.snap == null || !session?.user?.id) return;
  pumping = true;
  try {
    const [snaps, notifs, posts] = await asMe(async (tx) => [
      await tx.query('select * from public.signal_snapshots where id > $1 order by id', [marks.snap]),
      await tx.query('select * from public.notifications where created_at > $1 order by created_at', [marks.notifAt]),
      await tx.query('select * from public.posts where created_at > $1 order by created_at', [marks.postAt]),
    ]);
    snaps.rows.forEach((r) => { marks.snap = Math.max(marks.snap, r.id); emit('signal_snapshots', 'INSERT', r); });
    notifs.rows.forEach((r) => {
      marks.notifAt = r.created_at > marks.notifAt ? r.created_at : marks.notifAt;
      emit('notifications', r.id > marks.notifId ? 'INSERT' : 'UPDATE', r);
      marks.notifId = Math.max(marks.notifId, r.id);
    });
    posts.rows.forEach((r) => { marks.postAt = r.created_at > marks.postAt ? r.created_at : marks.postAt; emit('posts', 'INSERT', r); });
  } catch (_) { /* next time */ } finally { pumping = false; }
}
let soonTimer = null;
function soon() { clearTimeout(soonTimer); soonTimer = setTimeout(pump, 60); }

// ---------------------------------------------------------------------------
// Miracle AI's read, in the preview: a quick word-list stand-in for the Claude
// read the real backend does. It records the read the same way (record_post_read).
// ---------------------------------------------------------------------------
const AI_POS = [/\bbetter\b/, /\bimprov/, /\bhelp(ed|s|ing)?\b/, /\bwork(ed|s|ing)\b/, /\blost \d/, /\bdown \d+\s?(lb|lbs|kg|pounds)\b/, /\bdropped\b/, /\bgone\b/, /\bhealed\b/, /\brecover(ed|ing)\b/, /\bgreat\b/, /\bnoticeabl/, /\bstronger\b/, /\bmore energy\b/, /\bsleeping better\b/, /\bless pain\b/, /\beased\b/, /\bcalmer\b/, /\beasier\b/];
const AI_NEG = [/\bworse\b/, /\bdidn'?t work\b/, /\bdid not work\b/, /\bno effect\b/, /\bnothing (happened|changed)\b/, /\bgave up\b/, /\bmade me sick\b/, /\bterrible\b/, /\bwaste of\b/, /\bstopped because\b/];
const AI_NEU = [/\bno (real |clear )?(change|difference)\b/, /\b(about|roughly|pretty much|basically) the same\b/, /\bthe same\b/, /\btoo early\b/, /\bnot sure yet\b/, /\bhard to (say|tell)\b/];
const SE_LEX = [['nausea', 'Nausea'], ['nauseous', 'Nausea'], ['queasy', 'Nausea'], ['vomit', 'Vomiting'], ['headache', 'Headache'], ['fatigue', 'Fatigue'], ['tired', 'Fatigue'], ['insomnia', 'Poor sleep'], ["couldn't sleep", 'Poor sleep'], ['injection site', 'Injection-site reaction'], ['dizz', 'Dizziness'], ['palpitation', 'Heart rate up'], ['constipat', 'Constipation'], ['diarrh', 'Diarrhea'], ['reflux', 'Reflux'], ['heartburn', 'Reflux'], ['bloat', 'Bloating'], ['water retention', 'Water retention'], ['water weight', 'Water retention'], ['tingl', 'Numbness or tingling'], ['hair loss', 'Hair loss']];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// What a report was for: the first words that name a use (shared/uses.json), up to three
const USE_LEX = [
  [/\b(injur\w*|strain\w*|sprain\w*|tear|torn|surgery|heal(ing|ed)?)\b/, 'injury'],
  [/\b(knee|joint\w*|shoulder|hip|elbow|back pain|arthritis)\b/, 'joints'],
  [/\b(tendon\w*|ligament\w*|tendinitis|impingement)\b/, 'tendons'],
  [/\b(recovery|sore(ness)?|doms)\b/, 'training_recovery'],
  [/\b(weight|lbs?|pounds|kg|fat)\b/, 'fat_loss'],
  [/\b(appetite|craving\w*|snacking|food noise|hunger)\b/, 'appetite'],
  [/\b(blood sugar|glucose|a1c)\b/, 'blood_sugar'],
  [/\b(muscle|lean mass)\b/, 'muscle'],
  [/\b(reps|strength|stronger|lifts?|bench|squat)\b/, 'strength'],
  [/\b(energy|energetic)\b/, 'energy'],
  [/\b(10k|5k|running|endurance|cardio|marathon)\b/, 'endurance'],
  [/\b(sleep\w*|insomnia)\b/, 'sleep'],
  [/\b(focus\w*|memory|brain fog|concentrat\w*)\b/, 'focus'],
  [/\b(mood|motivat\w*|depress\w*)\b/, 'mood'],
  [/\b(stress\w*|anxi\w*|calm\w*|presentations?|nervous)\b/, 'anxiety'],
  [/\b(skin|wrinkle\w*|acne|serum)\b/, 'skin'],
  [/\b(hair|scalp)\b/, 'hair'],
  [/\b(tan|tanning)\b/, 'tanning'],
  [/\b(libido|erection\w*|sex drive)\b/, 'libido'],
  [/\b(gut|ibs|digest\w*|stomach)\b/, 'gut'],
  [/\b(inflammation|inflamed)\b/, 'inflammation'],
  [/\b(immune|sick less|colds?)\b/, 'immune'],
  [/\b(testosterone|trt)\b/, 'testosterone'],
  [/\b(hot flash\w*|menopaus\w*|perimenopaus\w*)\b/, 'menopause'],
  [/\b(fertility|sperm)\b/, 'fertility'],
  [/\b(aging|longevity|lifespan)\b/, 'aging'],
  [/\b(blood pressure|cholesterol)\b/, 'heart'],
];
function readPost(p) {
  const text = `${p.title}. ${p.body}`;
  const s = text.toLowerCase();
  const du = s.match(/\b(\d+)\s?(day|week|month|year)s?\b/);
  const wk = s.match(/\b(week|month) ?(\d+)\b/);
  const duration = du ? `${du[1]} ${du[2]}${du[1] === '1' ? '' : 's'}` : wk ? `${wk[1]} ${wk[2]}` : null;
  const hits = (list) => list.reduce((n, re) => n + (re.test(s) ? 1 : 0), 0);
  const pos = hits(AI_POS); const neg = hits(AI_NEG); const neu = hits(AI_NEU);
  const outcome = pos || neg || neu ? (pos > neg && pos >= neu ? 'better' : neg > pos && neg >= neu ? 'worse' : 'same') : null;
  const negated = (w) => new RegExp(`\\b(no|without|zero|not any)\\s+(\\w+\\s)?${esc(w)}`).test(s);
  const effects = [];
  SE_LEX.forEach(([k, label]) => { if (s.includes(k) && !negated(k) && !effects.includes(label)) effects.push(label); });
  const firstHand = /\b(i|i'm|i've|i'd|my|me)\b/i.test(text);
  const uses = USE_LEX.map(([re, use]) => [s.search(re), use]).filter(([at]) => at >= 0)
    .sort((a, b) => a[0] - b[0]).slice(0, 3).map(([, use]) => ({ use, outcome }));
  return { counts: firstHand && !!outcome, outcome, duration, side_effects: effects.slice(0, 3), uses: outcome ? uses : [] };
}
function aiRead(postId) {
  setTimeout(async () => {
    try {
      const r = await asOwner((d) => d.query('select id, kind, title, body, status from public.posts where id = $1', [postId]));
      const p = r.rows[0];
      if (!p || p.kind !== 'experience' || p.status !== 'visible') return;
      const read = readPost(p);
      await as('service_role', null, (tx) => tx.query('select public.record_post_read($1, $2, $3, $4, $5, $6, $7::jsonb)',
        [p.id, read.counts, read.outcome, read.duration, read.side_effects, 'preview-reader', JSON.stringify(read.uses)]));
      soon();
    } catch (_) { /* the post stays up either way */ }
  }, 3200);
}

// ---------------------------------------------------------------------------
// Other members, so the preview feels like a community: every so often a sample
// member backs up a report, votes, replies, sends a sticker or shares a report.
// Labelled as sample members in the preview banner.
// ---------------------------------------------------------------------------
const SAMPLE = ['stairs_again', 'glp_journal', 'sleepy_in_sd', 'runner_mike', 'desk_athlete', 'scar_notes', 'quiet_curious', 'knee_rehab_jo', 'focus_fern', 'longevity_lab', 'dawn_patrol'];
const POSTS = [
  ['semaglutide', 'Week 10 on semaglutide (prescribed): cravings way down', 'Ten weeks in. Evening snacking is basically gone and I am down 9 lb. Some nausea after big meals. Compared with before I started: better.'],
  ['bpc157', 'BPC-157 for a hamstring strain, 3 weeks in', 'Three weeks alongside rehab. Hard to say yet; sprinting still hurts. Compared with before I started: about the same so far.'],
  ['creatine', 'Creatine, 6 weeks: more reps, no bloating', 'Six weeks of plain creatine. I can do two more reps on most sets and I did not get the water weight people mention. Compared with before I started: better.'],
  ['mag', 'Magnesium glycinate for sleep: no difference for me', 'Four weeks at night. My sleep tracker shows no change and I do not feel different. Compared with before I started: the same.'],
  ['tirzepatide', 'Tirzepatide month 2: energy dipped, appetite way down', 'Prescribed. Appetite is much lower and I am down 12 lb, but my energy dipped for about two weeks. Compared with before I started: better overall.'],
  ['motsc', 'MOTS-c and my 10k time: nothing measurable', 'Ran the same 10k course before and after six weeks. Same time within 20 seconds. Compared with before I started: the same.'],
  ['ghkcu', 'GHK-Cu serum, 6 weeks: skin feels smoother', 'Topical only. Skin feels smoother and a bit less dry. No irritation. Compared with before I started: a little better.'],
  ['ashwagandha', 'Ashwagandha for stress: calmer, but tired', 'Five weeks. I feel calmer at work, but I am tired in the afternoons. Compared with before I started: better, with a trade-off.'],
  ['tb500', 'TB-500 for a shoulder impingement: slow progress', 'Eight weeks with physio. Range of motion is better than before I started, still not pain-free. Compared with before I started: better.'],
  ['selank', 'Selank before presentations: worked for me', 'Used it before three presentations over two weeks. Noticeably less shaky. Compared with before I started: better.'],
];
const COMMENTS = [
  'Thanks for writing this up, that’s really useful.', 'Same timeline here, almost exactly.', 'Did anything else change at the same time?',
  'This matches what my doctor told me to expect.', 'Following, curious how week 8 goes.', 'Appreciate the honest update, including the side effects.',
  'Good to hear a “no change” report, those are rare.', 'How did you track it?', 'That trade-off is real for me too.',
];
let simCount = 0;
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
async function simulate() {
  const next = () => setTimeout(simulate, 20000 + Math.random() * 25000);
  if (simCount >= 60 || document.hidden || !session?.user?.id) { next(); return; }
  simCount += 1;
  const handle = pickOne(SAMPLE);
  try {
    const uid = (await asOwner((d) => d.query('select id from public.profiles where handle = $1', [handle]))).rows[0]?.id;
    if (!uid) { next(); return; }
    const roll = Math.random();
    await as('authenticated', uid, async (tx) => {
      if (roll < 0.34) {
        const t = await tx.query(`select f.id from public.feed f where f.counts_for_signal and not f.is_mine and not f.i_same and f.status = 'visible' order by random() limit 1`);
        if (t.rows[0]) await tx.query('insert into public.same_for_me (post_id) values ($1)', [t.rows[0].id]);
      } else if (roll < 0.58) {
        const t = await tx.query(`select f.id from public.feed f where not f.is_mine and f.my_vote is null and f.status = 'visible' order by random() limit 1`);
        if (t.rows[0]) await tx.query('insert into public.post_votes (post_id, value) values ($1, 1)', [t.rows[0].id]);
      } else if (roll < 0.74) {
        const t = await tx.query(`select f.id from public.feed f where f.status = 'visible' and not f.is_mine order by f.created_at desc limit 8`);
        const target = pickOne(t.rows);
        if (target) await tx.query('insert into public.comments (post_id, body) values ($1, $2)', [target.id, pickOne(COMMENTS)]);
      } else if (roll < 0.84) {
        const t = await tx.query(`select f.id from public.feed f where f.status = 'visible' and not f.is_mine order by random() limit 1`);
        if (t.rows[0]) await tx.query('insert into public.post_reactions (post_id, sticker) values ($1, $2) on conflict do nothing', [t.rows[0].id, pickOne(['cheer', 'support', 'curious', 'watching'])]);
      } else {
        const [cid, title, body] = POSTS[simCount % POSTS.length];
        const r = await tx.query(`insert into public.posts (compound_id, kind, title, body) values ($1, 'experience', $2, $3) returning id`, [cid, title, body]);
        if (r.rows[0]) aiRead(r.rows[0].id);
      }
    });
    soon();
  } catch (_) { /* a sample member hit a limit; fine */ }
  next();
}

// ---------------------------------------------------------------------------
// The client the app gets instead of supabase-js
// ---------------------------------------------------------------------------
const client = {
  auth, functions, rpc,
  from: (table) => new Query(table),
  channel,
  removeChannel: (ch) => { channels.delete(ch); return Promise.resolve('ok'); },
};
window.supabase = { createClient: () => client };

// A note on every screen, so nobody mistakes the sample members for real ones
function banner() {
  const b = document.createElement('div');
  b.className = 'demo-banner';
  b.setAttribute('role', 'note');
  const long = document.createElement('span');
  long.className = 'long';
  const open = !!window.MH_CONFIG?.skipSignIn;   // the one-file preview signs you in by itself
  long.textContent = 'Preview: the real community software with sample posts from made-up members, who stay active in the background. '
    + (open ? 'You’re in as a new member; it starts fresh when you close the tab.' : 'It resets when you close the tab. Sign in with any number, code 123456, invite PREVIEW.');
  const short = document.createElement('span');
  short.className = 'short';
  short.textContent = open ? 'Preview with made-up members · starts fresh when you close the tab' : 'Preview with made-up members · any number · code 123456 · invite PREVIEW';
  b.append(long, short);
  document.body.prepend(b);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
