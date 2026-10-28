// Shared state, the Supabase client, the data everyone needs, and the live feed
// from the database (the Signal, notifications, new posts).
export const C = window.MH_CONFIG || {};
export let sb = null;
export function setClient(client) { sb = client; }

export const S = {
  session: null,
  me: null,          // from me(): id, handle, role, status...
  card: null,        // member_cards row for me: points, level, streak, badges
  spaces: [],        // every compound as a space, with members, joined, score
  signal: [],        // signal_board
  history: new Map(),// compound_id -> [scores by version]
  rules: null,
  levels: [],
  badges: [],
  pointRules: {},
  pulse: null,
  unread: 0,
  mine: new Set(),   // posts written in this session, so Sig doesn't announce your own moves twice
};

export const isMod = () => !!S.me && ['moderator', 'admin'].includes(S.me.role);
export const spaceOf = (cid) => S.spaces.find((s) => s.compound_id === cid) || null;
export const signalOf = (cid) => S.signal.find((x) => x.compound_id === cid) || null;
export const nameOf = (cid) => spaceOf(cid)?.name || signalOf(cid)?.compound_name || cid;
export const levelOf = (n) => S.levels.find((l) => l.n === n) || { n, name: 'Spark', tier: 'Signal', min_points: 0 };
export const delta = (s) => (s && s.prev_score != null && s.score != null ? Math.round((s.score - s.prev_score) * 10) / 10 : 0);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
export async function loadReference() {
  const [lv, bd, pr] = await Promise.all([
    sb.from('levels').select('*').order('n'),
    sb.from('badges').select('*').order('sort'),
    sb.from('point_rules').select('*'),
  ]);
  S.levels = lv.data || [];
  S.badges = bd.data || [];
  S.pointRules = Object.fromEntries((pr.data || []).map((r) => [r.reason, r]));
}

// The API hands back at most 200 rows a request (the project's max_rows), so lists
// that can be longer (the library has 300 entries and grows) come in pages
const PAGE = 200;
async function allRows(build) {
  const rows = [];
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error || !data) return rows.length ? rows : null;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

export async function loadSpaces() {
  const data = await allRows(() => sb.from('spaces').select('*').order('name').order('compound_id'));
  if (data) S.spaces = data;
  return S.spaces;
}

export async function loadSignal() {
  const data = await allRows(() => sb.from('signal_board').select('*').order('score', { ascending: false, nullsFirst: false }).order('compound_id'));
  if (data) S.signal = data;
  return S.signal;
}

export async function loadHistory(cid) {
  let q = sb.from('signal_history').select('compound_id,version,score').order('version', { ascending: true });
  if (cid) q = q.eq('compound_id', cid);
  const { data } = await q.limit(cid ? 60 : 3000);
  const map = new Map();
  (data || []).forEach((r) => {
    if (r.score == null) return;
    if (!map.has(r.compound_id)) map.set(r.compound_id, []);
    map.get(r.compound_id).push(Number(r.score));
  });
  if (cid) S.history.set(cid, map.get(cid) || []);
  else S.history = map;
  return cid ? S.history.get(cid) : S.history;
}

export async function loadCard() {
  if (!S.me) return null;
  const { data } = await sb.from('member_cards').select('*').eq('id', S.me.id).limit(1);
  S.card = data && data[0] ? data[0] : S.card;
  return S.card;
}

export async function loadPulse() {
  const { data } = await sb.from('community_pulse').select('*').limit(1);
  S.pulse = data && data[0] ? data[0] : S.pulse;
  return S.pulse;
}

export async function loadUnread() {
  const { data } = await sb.from('my_notifications').select('id').is('read_at', null).limit(99);
  S.unread = (data || []).length;
  return S.unread;
}

// ---------------------------------------------------------------------------
// Live: one channel for the whole app. Listeners subscribe by topic.
// ---------------------------------------------------------------------------
const listeners = { signal: new Set(), notification: new Set(), post: new Set() };
export function on(topic, fn) { listeners[topic].add(fn); return () => listeners[topic].delete(fn); }
const emit = (topic, payload) => listeners[topic].forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });

let channel = null;
export function startLive() {
  if (channel || !sb?.channel || !S.me) return;
  channel = sb.channel('community-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signal_snapshots' }, (p) => emit('signal', p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'signal_snapshots' }, (p) => emit('signal', p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${S.me.id}` }, (p) => emit('notification', p.new))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (p) => emit('post', p.new))
    .subscribe();
}
export function stopLive() {
  if (channel && sb?.removeChannel) sb.removeChannel(channel);
  channel = null;
}

// Telemetry: optional, never given health content
export function track(event, props) {
  try { window.posthog?.capture?.(event, props || {}); } catch (_) { /* optional */ }
}
