// The use cases that fill the store: the lists shipped with the app, who's signed in and what every
// screen needs, the Signal and its history, your card, the community's pulse, your quests and
// unread count; joining a space; signing out; and the live channel. No page.
import * as Auth from '../data/auth.js';
import * as Members from '../data/members.js';
import * as Spaces from '../data/spaces.js';
import * as Signal from '../data/signal.js';
import * as Notifications from '../data/notifications.js';
import { loadLists as readLists } from '../data/lists.js';
import { openLive, closeLive } from '../data/live.js';
import { S } from './store.js';
import { emit } from './events.js';

export async function loadLists() {
  [S.rules, S.uses, S.baselines] = await readLists();
}

export async function loadReference() {
  const [lv, bd, pr] = await Promise.all([Members.levels(), Members.badges(), Members.pointRules()]);
  S.levels = lv.data || [];
  S.badges = bd.data || [];
  S.pointRules = Object.fromEntries((pr.data || []).map((r) => [r.reason, r]));
}

export async function loadSpaces() {
  const data = await Spaces.all();
  if (data) S.spaces = data;
  return S.spaces;
}

export async function loadSignal() {
  const data = await Signal.board();
  if (data) S.signal = data;
  return S.signal;
}

// Every Signal's scores by version, or (with cid) the latest 60 of one, oldest first
export async function loadHistory(cid) {
  let data;
  if (cid) {
    const res = await Signal.recentVersions(cid);
    data = (res.data || []).reverse();
  } else {
    data = await Signal.allVersions();
  }
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
  const { data } = await Members.card(S.me.id);
  S.card = data && data[0] ? data[0] : S.card;
  return S.card;
}

export async function loadPulse() {
  const { data } = await Signal.pulse();
  S.pulse = data && data[0] ? data[0] : S.pulse;
  return S.pulse;
}

export async function loadUnread() {
  const { data } = await Notifications.unread();
  S.unread = (data || []).length;
  return S.unread;
}

export async function loadQuests() {
  const { data } = await Members.quests();
  S.quests = data || [];
  return S.quests;
}

// Who's signed in, and everything the frame needs. False when they haven't picked a handle yet.
export async function loadMember() {
  const { data, error } = await Auth.me();
  S.me = !error && Array.isArray(data) && data[0] ? data[0] : null;
  if (!S.me) return false;
  // Check-ins that are due leave a note in the bell first, so the count waits for them; everything
  // else loads alongside (waiting for the notes first cost every start a round trip)
  const reminders = Notifications.checkinReminders().then(() => null, () => null);
  await Promise.all([reminders.then(() => loadUnread()), loadReference(), loadSpaces(), loadSignal(), loadCard(), loadPulse()]);
  return true;
}

// Join or leave a space. On success the space in hand shows it at once; the full list reloads after.
export async function toggleMembership(sp) {
  const res = sp.joined ? await Spaces.leave(sp.compound_id) : await Spaces.join(sp.compound_id);
  if (!res.error) {
    sp.joined = !sp.joined;
    sp.members_count += sp.joined ? 1 : -1;
  }
  return res;
}

export function startLive() {
  if (!S.me) return;
  openLive(S.me.id, emit);
}
export function stopLive() { closeLive(); }

export async function signOut() {
  stopLive();
  await Auth.signOut();
  S.session = null;
  S.me = null;
}
