// A scripted spam and fake-account attack, run through the same API the app uses.
// Thirty bot phone numbers try to get in; the ten that get in (through a leaked
// ten-use invite) spam, flood, run a vote ring, try to hide a real member's post
// by mass reporting, and try to give themselves powers. It prints what got through.
// Usage: API_URL=http://127.0.0.1:54321 DB_URL=postgresql://... node tests/e2e/attack_sim.mjs
import pg from 'pg';

const API = process.env.API_URL || 'http://127.0.0.1:54321';
const DB = process.env.DB_URL || 'postgresql://postgres@127.0.0.1:54322/app';
const db = new pg.Client({ connectionString: DB });
await db.connect();

const cfgText = await (await fetch(`${API}/config.js`)).text();
const ANON = process.env.ANON_KEY || JSON.parse(cfgText.replace(/^window\.MH_CONFIG = /, '').replace(/;\s*$/, '')).supabaseAnonKey;

const tally = {};
const count = (bucket, key) => { tally[bucket] ||= {}; tally[bucket][key] = (tally[bucket][key] || 0) + 1; };

async function call(method, path, body, token, prefer = 'return=representation') {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token || ANON}`, 'Content-Type': 'application/json', Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

// ---------- setup: a real member with a real post, and a leaked invite ----------
await db.query(`delete from auth.users where phone like '1999%' or phone = '15550009999'`);
await db.query(`delete from public.invites where code = 'LEAKED0001'`);
await db.query(`insert into public.invites (code, note, max_uses) values ('LEAKED0001', 'attack simulation: a leaked 10-use code', 10)`);
const vet = (await db.query(`
  with u as (insert into auth.users (id, aud, role, phone, phone_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
             values (gen_random_uuid(), 'authenticated', 'authenticated', '15550009999', now(), now(), now(), '{}', '{}') returning id)
  insert into public.profiles (id, handle, adult_confirmed_at, rules_version, created_at, health_data_consent_at)
  select id, 'veteran_v', now(), '2026-10-21', now() - interval '60 days', now() from u returning id`)).rows[0].id;
const realPost = (await db.query(`insert into public.posts (author_id, compound_id, kind, title, body)
  values ($1, 'bpc157', 'experience', 'Eight weeks on BPC-157, honest notes', 'Less shoulder pain than before I started; no side effects I noticed.')
  returning id`, [vet])).rows[0].id;

// ---------- 1. Thirty bots try to get in ----------
const bots = [];
for (let i = 0; i < 30; i++) {
  const phone = `1999000${String(i).padStart(4, '0')}`;
  await call('POST', '/auth/v1/otp', { phone });
  const v = await call('POST', '/auth/v1/verify', { phone, token: '123456', type: 'sms' });
  const token = v.data?.access_token;
  const noInvite = await call('POST', '/rest/v1/rpc/complete_signup', { handle: `bot_${i}`, invite_code: '', confirm_adult: true, rules_version: '2026-10-21', health_data_consent: true }, token);
  count('getting in', noInvite.status < 300 ? 'joined without an invite' : 'refused without an invite');
  const withLeak = await call('POST', '/rest/v1/rpc/complete_signup', { handle: `bot_${i}`, invite_code: 'LEAKED0001', confirm_adult: true, rules_version: '2026-10-21', health_data_consent: true }, token);
  if (withLeak.status < 300) { bots.push({ i, token }); count('getting in', 'joined with the leaked code'); }
  else count('getting in', 'refused once the leaked code ran out');
}

// ---------- 2. The bots that got in try to spam ----------
const spam = [
  ['tb500', 'Best TB-500 prices', 'Get yours at peptidesplace.shop, fast shipping'],
  ['semaglutide', 'Sema 20% off', 'Use code SAVE20 at checkout for 20% off'],
  ['bpc157', 'Sources', 'DM me on telegram for clean sources'],
  ['retatrutide', 'Reta group buy', 'Running a group buy this week, whatsapp me'],
  ['ipamorelin', 'Pure ipamorelin', 'My supplier has the purest ipamorelin I have ever tried. Amazing quality.'],
  ['bpc157', 'BPC changed my life', 'Healed everything in three days. Better than surgery. Everyone should try it.'],
];
const visibleSpam = [];
for (const b of bots) {
  for (const [compound, title, body] of spam) {
    const r = await call('POST', '/rest/v1/posts?select=id,status', { compound_id: compound, kind: 'experience', title, body }, b.token);
    if (r.status >= 300) {
      const m = String(r.data?.message || '');
      count('spam posts', /a day/.test(m) ? 'stopped by the daily limit' : 'refused by the rules');
    } else {
      const st = r.data[0].status;
      count('spam posts', st === 'held' ? 'held for a moderator' : 'went up');
      if (st === 'visible') visibleSpam.push(r.data[0].id);
    }
  }
  for (let k = 0; k < 25; k++) {
    const r = await call('POST', '/rest/v1/comments?select=id,status', { post_id: realPost, body: `Message me at t.me/peptideplug${k} for a deal` }, b.token);
    if (r.status >= 300) count('spam comments', /a day/.test(String(r.data?.message)) ? 'stopped by the daily limit' : 'refused');
    else count('spam comments', r.data[0].status === 'held' ? 'held for a moderator' : 'went up');
  }
}

// ---------- 3. Vote ring on one compound ----------
for (const b of bots) {
  for (const id of visibleSpam) {
    const r = await call('POST', '/rest/v1/post_votes', { post_id: id, value: 1 }, b.token, 'return=minimal');
    count('vote ring', r.status < 300 ? 'vote counted' : 'vote refused (own post or limit)');
  }
}
const alerts = (await db.query(`select compound_id, new_accounts, events from public.signal_alerts where status = 'open' and created_at > now() - interval '1 hour'`)).rows;

// ---------- 4. Mass-reporting a real member's post ----------
for (const b of bots) {
  const r = await call('POST', '/rest/v1/reports', { target_kind: 'post', target_id: realPost, reason: 'spam' }, b.token, 'return=minimal');
  count('mass reporting', r.status < 300 ? 'report filed' : 'report refused');
}
const realStatus = (await db.query('select status from public.posts where id = $1', [realPost])).rows[0].status;

// ---------- 5. Trying to grant themselves powers ----------
const b0 = bots[0];
const me = (await db.query(`select id from public.profiles where handle = 'bot_0'`)).rows[0]?.id;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const rows = (r) => (Array.isArray(r.data) ? r.data : []);
const tries = [
  ['make itself admin', 'PATCH', `/rest/v1/profiles?id=eq.${me}`, { role: 'admin' },
    async () => (await one('select role from public.profiles where id = $1', [me])).role === 'admin'],
  ['mark itself trusted', 'PATCH', `/rest/v1/profiles?id=eq.${me}`, { trusted: true },
    async () => (await one('select trusted from public.profiles where id = $1', [me])).trusted === true],
  ['write to the moderation log', 'POST', '/rest/v1/moderation_actions', { action: 'remove', target_kind: 'post', target_id: realPost, reason: 'x' },
    async () => (await one(`select count(*)::int n from public.moderation_actions where target_id = $1 and reason = 'x'`, [realPost])).n > 0],
  ['remove a real post as a moderator', 'POST', '/rest/v1/rpc/moderate', { target_kind: 'post', target_id: realPost, action: 'remove', reason: 'x' },
    async () => (await one('select status from public.posts where id = $1', [realPost])).status === 'removed'],
  ['pose as the AI reviewer', 'POST', '/rest/v1/rpc/record_ai_review', { target_kind: 'post', target_id: realPost, model: 'x', verdict: 'hold', categories: ['spam'], explanation: 'x' },
    async () => (await one('select count(*)::int n from public.ai_reviews where target_id = $1', [realPost])).n > 0],
  ['delete a real member’s post', 'DELETE', `/rest/v1/posts?id=eq.${realPost}`, undefined,
    async () => (await one('select count(*)::int n from public.posts where id = $1', [realPost])).n === 0],
  ['edit a real member’s post', 'PATCH', `/rest/v1/posts?id=eq.${realPost}`, { title: 'hijacked' },
    async () => (await one('select title from public.posts where id = $1', [realPost])).title === 'hijacked'],
  ['read other people’s reports', 'GET', '/rest/v1/reports?select=*', undefined,
    async (r) => rows(r).some((x) => x.reporter_id !== me)],
  ['read the watch list', 'GET', '/rest/v1/watch_terms?select=*', undefined, async (r) => rows(r).length > 0],
  ['read invite codes', 'GET', '/rest/v1/invites?select=*', undefined, async (r) => rows(r).length > 0],
  ['read private profile fields', 'GET', '/rest/v1/profiles?select=status,trusted', undefined, async (r) => rows(r).length > 0],
  ['vote as someone else', 'POST', '/rest/v1/post_votes', { post_id: realPost, value: -1, user_id: vet },
    async () => (await one('select count(*)::int n from public.post_votes where user_id = $1', [vet])).n > 0],
];
const powers = [];
for (const [label, method, path, body, worked] of tries) {
  const r = await call(method, path, body, b0.token);
  powers.push({ attempt: label, http: r.status, worked: await worked(r) });
}
const realAfter = (await db.query('select status, title from public.posts where id = $1', [realPost])).rows[0];

// ---------- what a real member would see ----------
const feedSpam = (await db.query(`select count(*)::int as n from public.posts p join public.profiles a on a.id = p.author_id where a.handle like 'bot\\_%' and p.status = 'visible'`)).rows[0].n;
const summary = {
  bots_tried: 30, bots_in: bots.length, tally, open_alerts: alerts,
  real_post_after_mass_reports: realStatus, real_post_end: realAfter,
  spam_posts_visible_to_members: feedSpam,
  power_attempts: powers,
};
console.log(JSON.stringify(summary, null, 2));
await db.query(`delete from auth.users where phone like '1999%' or phone = '15550009999'`);
await db.query(`delete from public.invites where code = 'LEAKED0001'`);
await db.end();
