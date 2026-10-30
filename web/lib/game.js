// The game: emblems, Signal points, quests, Signal Builders, community goals,
// the season, notifications, celebrations, onboarding and profiles. Every number
// comes from the database; this file only shows it and celebrates it.
import { h, icon, fmtN, fmt1, ago, bar, toast, modal, tick, friendly, plural } from './ui.js';
import { sig, emblem, emblemRing, spaceTile, tierOf } from './art.js';
import { S, sb, on, levelOf, nameOf, loadCard, loadPulse, loadSpaces, loadUnread, track } from './state.js';
import { render, setRail, railCards, renderNav, renderTop, sigSay, refreshNav } from './shell.js';
import { OUTCOME } from './signal.js';

// ---------------------------------------------------------------------------
// Points: a "+N" that floats up from what you tapped, and the header ticks
// ---------------------------------------------------------------------------
function floatPlus(anchor, n) {
  if (!n || n <= 0) return;
  const r = anchor?.getBoundingClientRect?.() || { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0 };
  const el = h('div', { class: 'plus', 'aria-hidden': 'true' }, `+${n}`);
  el.style.left = `${Math.round(r.left + r.width / 2 - 16)}px`;
  el.style.top = `${Math.round(r.top - 8)}px`;
  document.body.append(el);
  setTimeout(() => el.remove(), 1400);
}

// After anything that may earn points: read the real totals, show what changed
export async function afterEarn(anchor, label) {
  const before = S.card ? { points: S.card.points, level: S.card.level } : null;
  await loadCard();
  if (!S.card || !before) { renderTop(); return 0; }
  const diff = S.card.points - before.points;
  const el = document.getElementById('my-points');
  if (el) tick(el, before.points, S.card.points, 0);
  if (diff) refreshMeCards();
  if (diff > 0) {
    floatPlus(anchor, diff);
    if (label) toast([h('span', { class: 'pts' }, `+${diff}`), ` ${label}`], { art: sig(30, 'happy') });
  }
  if (S.card.level !== before.level) renderTop();
  refreshQuests();
  return diff;
}

// ---------------------------------------------------------------------------
// Cards for the rail
// ---------------------------------------------------------------------------
// Every "Your emblem" card on screen follows the points as they change
function refreshMeCards() {
  document.querySelectorAll('[data-mecard]').forEach((el) => { const fresh = meCard(); if (fresh) el.replaceWith(fresh); });
}
export function meCard() {
  const c = S.card;
  if (!c) return null;
  const lv = levelOf(c.level);
  const next = S.levels.find((l) => l.n === c.level + 1);
  const pct = next ? (100 * (c.points - lv.min_points)) / (next.min_points - lv.min_points) : 100;
  return h('section', { class: 'card', 'data-mecard': '' },
    h('div', { class: 'card-h' }, h('span', { class: 'kick' }, 'Your emblem'), h('a', { href: `#/u/${encodeURIComponent(c.handle)}` }, 'Profile')),
    h('div', { class: 'me-card' },
      h('div', { class: 'ringwrap' }, emblemRing(c.level, pct, 84), emblem(c.level, 50, false, `${lv.name} emblem`)),
      h('div', {},
        h('b', { class: 'pts num' }, fmtN(c.points)), h('span', { class: 'kick' }, ' Signal points'),
        h('div', { class: 'small' }, h('b', {}, lv.name), ` · ${lv.tier} tier`),
        h('div', { class: 'xs muted' }, next ? `${fmtN(next.min_points - c.points)} to ${next.name}` : 'The final emblem. Respect.'),
        c.streak_days > 1 ? h('div', { class: 'streak mt4' }, icon('flame', 15), `${c.streak_days}-day streak`) : null)));
}

let questsCache = [];
const questBoxes = new Set();   // every quest list made, on the page or about to be
export const claimable = () => questsCache.filter((q) => q.have >= q.need && !q.claimed).length;
let questsLoading = null;
export function refreshQuests() {
  questsLoading ||= (async () => {
    const { data } = await sb.from('my_quests').select('*').order('sort');
    questsCache = data || [];
    questBoxes.forEach((box) => {
      if (!box.isConnected && Date.now() - Number(box.dataset.made) > 8000) questBoxes.delete(box);
      else fillQuests(box, Number(box.dataset.quests));
    });
    refreshNav();
    questsLoading = null;
    return questsCache;
  })();
  return questsLoading;
}
function questBox(n) {
  const box = h('div', { 'data-quests': String(n), 'data-made': String(Date.now()) });
  questBoxes.add(box);
  fillQuests(box, n);
  return box;
}
function questRow(q) {
  const done = q.have >= q.need;
  const claim = done && !q.claimed
    ? h('button', { class: 'btn lime xs', type: 'button', onclick: (e) => claimQuest(q, e.currentTarget) }, `Claim +${q.reward}`)
    : h('span', { class: 'rw' }, q.claimed ? '✓ Done' : `+${q.reward}`);
  return h('div', { class: `quest ${q.claimed ? 'done' : ''}` },
    h('div', {}, h('div', { class: 't' }, q.title), h('div', { class: 'd' }, `${q.have} of ${q.need} · ${q.cadence === 'weekly' ? 'this week' : 'once'}`)),
    claim, bar((100 * q.have) / q.need));
}
function fillQuests(box, n) {
  const order = [...questsCache].sort((a, b) => (a.claimed - b.claimed) || ((b.have >= b.need) - (a.have >= a.need)) || a.sort - b.sort);
  box.replaceChildren(...(order.length ? order.slice(0, n || 99).map(questRow) : [h('p', { class: 'xs muted' }, 'Loading…')]));
}
export function questsCard(n = 3) {
  const box = questBox(n);
  refreshQuests();
  return h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('span', { class: 'kick' }, 'Quests this week'), h('a', { href: '#/quests' }, 'All')), box);
}
async function claimQuest(q, btn) {
  btn.disabled = true;
  const { data, error } = await sb.rpc('claim_quest', { quest: q.key });
  if (error) { btn.disabled = false; toast(friendly(error)); return; }
  track('quest_claimed', { quest: q.key });
  await afterEarn(btn, `· ${q.title}`);
  sigSay(['Quest done: ', h('b', {}, `+${data}`), '. That’s follow-through, and it’s what makes the Signal trustworthy.'], 'cheer', 4500, true);
}

export function buildersCard(n = 5) {
  const box = h('div', { class: 'lb' }, h('p', { class: 'xs muted' }, 'Loading…'));
  sb.from('signal_builders').select('*').order('rank').limit(n).then(({ data }) => {
    box.replaceChildren(...((data || []).length ? data.map(lbRow) : [h('p', { class: 'xs muted' }, 'Nobody yet this month. Be first.')]));
  });
  return h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('span', { class: 'kick' }, `Signal Builders · ${monthName()}`), h('a', { href: '#/builders' }, 'All')), box);
}
const monthName = () => new Date().toLocaleDateString('en-US', { month: 'long' });
function lbRow(r) {
  return h('a', { class: `lb-row ${r.is_me ? 'me' : ''}`, href: `#/u/${encodeURIComponent(r.handle)}` },
    h('span', { class: 'n' }, `#${r.rank}`), emblem(r.level, 28, false, `${r.level_name} emblem`),
    h('span', { class: 'grow' }, h('b', {}, `u/${r.handle}`), r.is_me ? h('span', { class: 'xs muted' }, ' · you') : null),
    h('span', { class: 'p' }, fmtN(r.points)));
}

export async function goalsCard(n = 4, cid = '') {
  const { data } = await sb.from('community_goals').select('*').lt('pct', 100).order('pct', { ascending: false }).limit(60);
  let rows = data || [];
  if (cid) rows = [...rows.filter((g) => g.compound_id === cid), ...rows.filter((g) => g.compound_id !== cid)];
  rows = rows.slice(0, n);
  if (!rows.length) return null;
  return h('section', { class: 'card' },
    h('div', { class: 'card-h' }, h('span', { class: 'kick' }, 'Community goals'), h('a', { href: '#/quests' }, 'All')),
    rows.map(goalRow));
}
export function goalRow(g) {
  const title = g.kind === 'unlock' ? `Unlock the ${g.compound_name} Signal` : `Make ${g.compound_name} ours`;
  const progress = g.kind === 'unlock' ? `${g.have} of ${g.need} first-hand reports` : `${g.have}% of the number from members here · goal ${g.need}%`;
  return h('a', { class: 'goal', href: `#/s/${encodeURIComponent(g.compound_id)}` },
    h('div', { class: 'row nw' }, spaceTile({ name: g.compound_name, category: (S.spaces.find((s) => s.compound_id === g.compound_id) || {}).category }, 24), h('b', { class: 'grow' }, title)),
    h('div', { class: 'xs muted mt4' }, progress), h('div', { class: 'mt8' }, bar(g.pct)));
}

export function seasonCard(big = false) {
  const p = S.pulse;
  if (!p?.season_name) return null;
  const left = Math.max(0, Math.ceil((new Date(`${p.season_ends}T23:59:59Z`) - Date.now()) / 86400000));
  const pct = Math.min(100, (100 * p.season_reports) / (p.season_goal || 1));
  return h('section', { class: 'card dark', 'data-season': big ? 'big' : 'card' },
    h('div', { class: 'card-h' }, h('span', { class: 'kick' }, p.season_name), h('span', { class: 'kick' }, `${left} days left`)),
    h('div', { class: 'sig-big' }, h('b', { class: 'num' }, fmtN(p.season_reports)), h('span', {}, `/ ${fmtN(p.season_goal)} reports`)),
    bar(pct, 'scale-fill'),
    h('p', { class: 'small muted mt12' }, `${fmtN(p.members)} ${p.members === 1 ? 'member is' : 'members are'} building this together. Three first-hand reports this season earns the Season 1 badge.`),
    big ? h('div', { class: 'hero-stats' },
      h('div', {}, h('b', {}, fmtN(p.reports_week)), h('span', {}, 'Reports this week')),
      h('div', {}, h('b', {}, fmtN(p.same_total)), h('span', {}, '“Same for me”')),
      h('div', {}, h('b', {}, fmtN(p.members_week)), h('span', {}, 'New members this week'))) : null);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
const MOD_TEXT = {
  remove: (d) => `A moderator removed your ${d.what}: ${d.reason}`,
  hold: (d) => `Your ${d.what} is waiting for a moderator${d.by === 'moderator' ? '' : ' (an automatic check)'}`,
  restore: (d) => `Your ${d.what} is back up`,
  warn: (d) => `A note from the moderators: ${d.note || d.reason}`,
  suspend: (d) => `Your account is paused${d.until ? ` until ${new Date(d.until).toLocaleDateString()}` : ''}: ${d.reason}`,
  unban: () => 'Your account is active again',
};
export function notifParts(n) {
  const d = n.data || {};
  const who = n.actor_handle ? `u/${n.actor_handle}` : 'Someone';
  switch (n.kind) {
    case 'welcome': return [sig(34, 'happy'), 'Welcome to Miracle Health. I’m Sig, the Community Signal in person. Join a few spaces and share how it went.', null, '#/explore'];
    case 'comment': return [icon('comment', 18), `${who} commented on your post`, n.comment_body || n.post_title, `#/post/${n.post_id}`];
    case 'reply': return [icon('comment', 18), `${who} replied to you`, n.comment_body, `#/post/${n.post_id}`];
    case 'same_for_me': {
      const c = Number(d.count || 1);
      return [sig(34, 'support'), c > 1 ? `${c} people said “same for me” on your report` : 'Someone said “same for me” on your report', n.post_title, `#/post/${n.post_id}`];
    }
    case 'counted': {
      const out = OUTCOME[d.outcome]?.[0] || 'counted';
      const moved = d.from != null && d.to != null && Number(d.from) !== Number(d.to);
      return [sig(34, 'cheer'), moved
        ? `Miracle AI read your report: ${out}. It moved the ${n.compound_name} Signal ${fmt1(d.from)} → ${fmt1(d.to)}.`
        : `Miracle AI read your report: ${out}. It now feeds the ${n.compound_name} Signal.`, n.post_title, `#/post/${n.post_id}`];
    }
    case 'milestone': return [icon('up', 18), `Your post reached ${d.score} helpful votes`, n.post_title, `#/post/${n.post_id}`];
    case 'level_up': return [emblem(d.level, 34), `You reached ${d.name}. Level ${d.level} of 15, ${d.tier} tier.`, null, `#/u/${encodeURIComponent(S.me?.handle || '')}`];
    case 'badge': return [h('span', { class: 'seal' }, icon('check', 18)), `New badge: ${d.name}`, d.description, `#/u/${encodeURIComponent(S.me?.handle || '')}`];
    case 'mod': return [icon('shield', 18), (MOD_TEXT[d.action] || (() => 'A note from the moderators'))(d), n.post_title, n.post_id ? `#/post/${n.post_id}` : '#/rules'];
    case 'library': return [sig(34, 'happy'), `${d.name || n.compound_name} is in the library now, as you suggested. Thanks for building it out.`, null, n.compound_id ? `#/s/${encodeURIComponent(n.compound_id)}` : '#/explore'];
    default: return [icon('bell', 18), 'Something new', null, '#/notifications'];
  }
}
export function notifRow(n) {
  const [art, text, quote, href] = notifParts(n);
  return h('a', { class: `notif ${n.read_at ? '' : 'unread'}`, href: href || '#/notifications' },
    h('span', { class: 'ico' }, art), h('span', {}, h('span', { class: 't' }, text), quote ? h('span', { class: 'q' }, quote) : null),
    h('span', { class: 'when' }, ago(n.created_at)));
}
let bellCount = null;
export function setUnread(n) {
  S.unread = n;
  if (bellCount) { bellCount.textContent = n > 9 ? '9+' : String(n); bellCount.classList.toggle('hide', !n); }
}
export function bellButton() {
  bellCount = h('span', { class: `count ${S.unread ? '' : 'hide'}` }, S.unread > 9 ? '9+' : String(S.unread));
  const wrap = h('div', { class: 'row nw', style: null });
  wrap.style.position = 'relative';
  const btn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Notifications', 'aria-haspopup': 'true', id: 'bell' }, icon('bell', 22), bellCount);
  let pop = null;
  const close = () => { pop?.remove(); pop = null; document.removeEventListener('click', outside, true); };
  const outside = (e) => { if (pop && !wrap.contains(e.target)) close(); };
  btn.addEventListener('click', async () => {
    if (pop) return close();
    if (window.innerWidth < 760) { location.hash = '#/notifications'; return; }
    pop = h('div', { class: 'notif-pop', role: 'dialog', 'aria-label': 'Notifications' }, h('p', { class: 'xs muted pad' }, 'Loading…'));
    wrap.append(pop);
    document.addEventListener('click', outside, true);
    const { data } = await sb.from('my_notifications').select('*').order('created_at', { ascending: false }).limit(12);
    if (!pop) return;
    pop.replaceChildren(
      h('div', { class: 'card-h pad', style: null }, h('span', { class: 'kick' }, 'Notifications'), h('a', { href: '#/notifications', onclick: close }, 'See all')),
      ...((data || []).length ? data.map(notifRow) : [h('div', { class: 'empty' }, sig(56, 'sleepy'), h('p', {}, 'Nothing yet.'))]));
    pop.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
    if (S.unread) { await sb.rpc('mark_notifications_read'); setUnread(0); }
  });
  wrap.append(btn);
  return wrap;
}
export async function renderNotifications() {
  const list = h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Loading…'));
  render(h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, '// Your updates'), h('h1', {}, 'Notifications.'))), list);
  setRail(await railCards('default'));
  const { data } = await sb.from('my_notifications').select('*').order('created_at', { ascending: false }).limit(60);
  list.replaceChildren(...((data || []).length ? data.map(notifRow) : [h('div', { class: 'empty' }, sig(72, 'sleepy'), h('p', {}, 'Nothing yet. Share how it went and I’ll tell you when people back you up.'))]));
  if (S.unread) { await sb.rpc('mark_notifications_read'); setUnread(0); }
}

// The season's count follows every report the moment it counts, on every screen
let seasonTimer = null;
export function refreshSeason() {
  clearTimeout(seasonTimer);
  seasonTimer = setTimeout(async () => {
    const before = S.pulse?.season_reports;
    await loadPulse();
    if (S.pulse?.season_reports === before) return;
    refreshNav();
    document.querySelectorAll('[data-season]').forEach((el) => {
      const fresh = seasonCard(el.dataset.season === 'big');
      if (fresh) el.replaceWith(fresh);
    });
  }, 600);
}
on('signal', () => refreshSeason());

// Live notifications: a toast, and for the big ones a celebration
on('notification', async (n) => {
  if (!n || n.read_at) return;
  const { data } = await sb.from('my_notifications').select('*').eq('id', n.id).limit(1);
  const row = data && data[0];
  if (!row) return;
  loadUnread().then((c) => setUnread(c));
  if (row.kind === 'level_up') { await loadCard(); renderTop(); refreshMeCards(); levelUp(row.data); return; }
  if (row.kind === 'counted') {
    const diff = await afterEarn(null);
    const [, text] = notifParts(row);
    sigSay([text, diff > 0 ? [' ', h('b', {}, `+${diff} points.`)] : ''], 'cheer', 7000, true);
    document.dispatchEvent(new CustomEvent('mh:read', { detail: row.post_id }));
    return;
  }
  const [art, text] = notifParts(row);
  toast(text, { art, onclick: () => { location.hash = notifParts(row)[3]; } });
  if (row.kind === 'badge' || row.kind === 'same_for_me' || row.kind === 'milestone') afterEarn(null);
  // A moderator acted on one of your posts: an open page of it redraws, and points may have moved
  if (row.kind === 'mod' && row.post_id) {
    document.dispatchEvent(new CustomEvent('mh:post', { detail: row.post_id }));
    afterEarn(null);
  }
});

// ---------------------------------------------------------------------------
// Celebrations
// ---------------------------------------------------------------------------
function confetti() {
  const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  const colors = ['#D8FF3D', '#7FD858', '#FCFCFC', '#7CF0DC', '#FFE07A'];
  for (let i = 0; i < 36; i += 1) {
    const p = h('i', {});
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.6}s`;
    p.style.transform = `rotate(${Math.random() * 180}deg)`;
    box.append(p);
  }
  return box;
}
export function levelUp(d) {
  const lv = levelOf(d.level);
  modal((close) => h('div', { class: 'celebrate' }, confetti(),
    h('div', { class: 'kick' }, `Level ${d.level} of 15 · ${lv.tier} tier`),
    h('div', { class: 'mt16' }, emblem(d.level, 120, false, `${lv.name} emblem`)),
    h('h2', {}, `You reached ${lv.name}.`),
    h('p', {}, 'Your reports, replies and “same for me” taps make the Signal sharper for everyone. Keep going.'),
    h('button', { class: 'btn lime mt16', type: 'button', onclick: close }, 'Keep going')), { label: 'New emblem', cls: 'celebrate-dlg' });
}

// ---------------------------------------------------------------------------
// Onboarding, with Sig
// ---------------------------------------------------------------------------
export function onboarding() {
  let step = 0;
  const picks = new Set(S.spaces.filter((s) => s.joined).map((s) => s.compound_id));
  const popular = [...S.spaces].sort((a, b) => (b.members_count - a.members_count) || ((b.score ?? 0) - (a.score ?? 0))).slice(0, 16);
  const dots = () => h('div', { class: 'step-dots' }, [0, 1, 2].map((i) => h('i', { class: i === step ? 'on' : '' })));
  const finish = async () => {
    const at = location.hash;
    await loadSpaces();
    await refreshQuests();
    // Someone who has already moved on (opened a post, started one) stays where they are, and so
    // does someone who came for a page (a space from the Library, a draft from their plan)
    if (location.hash !== at) return;
    if (at && !/^#\/?(?:home)?$/.test(at)) return;
    if (at === '#/home') window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = '#/home';
  };
  const { dlg, close } = modal(() => h('div', { class: 'onboard pad' }), { label: 'Welcome', sticky: true, onclose: finish });
  const box = dlg.firstChild;
  const draw = () => {
    if (step === 0) {
      box.replaceChildren(
        h('div', { class: 'row nw' }, sig(88, 'happy'), h('div', {}, h('div', { class: 'kick' }, 'Welcome'), h('h2', {}, 'Hi, I’m Sig.'))),
        h('p', {}, 'I’m the Community Signal in person: one number per compound, built from what people report happened to them. Every report, every “same for me” and every vote here makes me sharper.'),
        h('p', { class: 'small muted' }, 'Experiences, not medical advice. Nobody here tells anyone what to take.'),
        h('div', { class: 'row end mt16' }, h('button', { class: 'btn lime', type: 'button', onclick: () => { step = 1; draw(); } }, 'Show me around')), dots());
    } else if (step === 1) {
      const grid = h('div', { class: 'pick-grid' }, popular.map((s) => {
        const b = h('button', { class: 'pick', type: 'button', 'aria-pressed': String(picks.has(s.compound_id)) },
          spaceTile(s, 30), h('span', { class: 'grow' }, h('b', {}, s.name), h('span', { class: 'm' }, `${s.category}${s.score != null ? ` · ${fmt1(s.score)}` : ''}`)));
        b.addEventListener('click', async () => {
          const on = picks.has(s.compound_id);
          b.disabled = true;
          const res = on ? await sb.from('space_members').delete().eq('compound_id', s.compound_id)
            : await sb.from('space_members').insert({ compound_id: s.compound_id });
          b.disabled = false;
          if (res.error) { toast(friendly(res.error)); return; }
          if (on) picks.delete(s.compound_id); else picks.add(s.compound_id);
          b.setAttribute('aria-pressed', String(!on));
          count.textContent = `${picks.size} joined`;
          if (picks.size === 3 && !on) sigSay('Three spaces: your first quest is done. Claim it when we’re through.', 'cheer', 3500);
        });
        return b;
      }));
      const count = h('span', { class: 'kick' }, `${picks.size} joined`);
      box.replaceChildren(
        h('div', { class: 'row nw' }, sig(56, 'curious'), h('div', {}, h('div', { class: 'kick' }, 'Step 2 of 3'), h('h2', {}, 'Join your spaces.'))),
        h('p', { class: 'small' }, 'Each compound has a space, like s/BPC-157. Join three and your Home feed fills up (and you finish your first quest).'),
        grid,
        h('div', { class: 'row between mt16' }, count, h('button', { class: 'btn lime', type: 'button', onclick: async () => { await loadSpaces(); step = 2; draw(); } }, 'Next')), dots());
    } else {
      box.replaceChildren(
        h('div', { class: 'row nw' }, sig(56, 'cheer'), h('div', {}, h('div', { class: 'kick' }, 'Step 3 of 3'), h('h2', {}, 'Earn your emblems.'))),
        h('p', { class: 'small' }, 'Points go to taking part, never to results: a report that says “it didn’t work” earns the same as one that says it did. Fifteen emblems, from Spark to Organism.'),
        h('div', { class: 'row', style: null }, S.levels.slice(0, 15).map((l) => emblem(l.n, 34, l.n > 1, l.name))),
        h('div', { class: 'stack mt16 small' },
          h('div', {}, h('b', {}, '+40'), ' a first-hand report that feeds the Signal'),
          h('div', {}, h('b', {}, '+5'), ' each “same for me”, given or received'),
          h('div', {}, h('b', {}, '+5'), ' your first contribution each day, and your streak grows')),
        h('div', { class: 'row end mt16' }, h('button', { class: 'btn lime', type: 'button', onclick: close }, 'Let’s go')), dots());
    }
  };
  draw();
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
export async function renderProfile(handle, tab = 'posts') {
  render(h('div', { class: 'skel' }), h('div', { class: 'skel' }));
  const { data } = await sb.from('member_cards').select('*').eq('handle', handle).limit(1);
  const m = data && data[0];
  if (!m) { render(h('div', { class: 'empty card' }, sig(72, 'curious'), h('p', {}, `There’s nobody called u/${handle} here.`))); return; }
  const lv = levelOf(m.level);
  const next = S.levels.find((l) => l.n === m.level + 1);
  const pct = next ? (100 * (m.points - lv.min_points)) / (next.min_points - lv.min_points) : 100;
  const earned = new Set(m.badges || []);
  const tabs = [['posts', 'Posts'], ['comments', 'Comments'], ...(m.is_me ? [['points', 'Your points']] : [])];
  const body = h('div', {}, h('div', { class: 'skel' }));
  render(
    h('section', { class: 'hero' },
      h('div', { class: 'profile-h' },
        h('div', { class: 'ringwrap' }, emblemRing(m.level, pct, 132), emblem(m.level, 82, false, `${lv.name} emblem`)),
        h('div', {},
          h('div', { class: 'kick' }, `Member #${fmtN(m.member_no)} · since ${new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}${m.role !== 'member' ? ` · ${m.role}` : ''}`),
          h('h1', {}, `u/${m.handle}`),
          h('p', { class: 'lede' }, h('b', {}, lv.name), ` · level ${m.level} of 15 · ${lv.tier} tier${next ? ` · ${fmtN(next.min_points - m.points)} points to ${next.name}` : ''}`),
          m.streak_days > 1 ? h('div', { class: 'streak mt8' }, icon('flame', 16), `${m.streak_days}-day streak`) : null)),
      h('div', { class: 'hero-stats' },
        h('div', {}, h('b', {}, fmtN(m.points)), h('span', {}, 'Signal points')),
        h('div', {}, h('b', {}, fmtN(m.month_points)), h('span', {}, `In ${monthName()}`)),
        h('div', {}, h('b', {}, fmtN(m.reports)), h('span', {}, 'First-hand reports')),
        h('div', {}, h('b', {}, fmtN(m.posts)), h('span', {}, 'Posts')),
        h('div', {}, h('b', {}, fmtN(m.comments)), h('span', {}, 'Comments')))),
    h('h2', {}, 'Badges'),
    h('div', { class: 'badges' }, S.badges.map((b) => h('div', { class: `card bdg ${earned.has(b.key) ? '' : 'locked'}`, title: b.description },
      h('span', { class: 'seal' }, icon(earned.has(b.key) ? 'check' : 'lock', 20)), h('b', {}, b.name), h('span', {}, b.description)))),
    h('h2', {}, 'The path'),
    h('div', { class: 'card' }, h('div', { class: 'row' }, S.levels.map((l) => h('span', { title: `${l.name} · ${fmtN(l.min_points)} points` }, emblem(l.n, 40, l.n > m.level, l.name)))),
      h('p', { class: 'xs muted mt8' }, 'Fifteen emblems in three tiers: Signal, Resonant and Lodestar. Points go to taking part, never to results.')),
    h('div', { class: 'space-tabs' }, tabs.map(([k, l]) => h('a', { href: `#/u/${encodeURIComponent(m.handle)}?t=${k}`, 'aria-current': tab === k ? 'page' : null }, l))),
    body);
  setRail(await railCards('profile'));
  const { postCard } = await import('./feed.js');
  if (tab === 'comments') {
    const { data: cs } = await sb.from('thread_comments').select('*').eq('author_id', m.id).eq('status', 'visible').order('created_at', { ascending: false }).limit(30);
    body.replaceChildren(...((cs || []).length ? cs.map((c) => h('a', { class: 'card notif', href: `#/post/${c.post_id}` },
      h('span', { class: 'ico' }, icon('comment', 18)), h('span', {}, h('span', { class: 't' }, c.body)), h('span', { class: 'when' }, ago(c.created_at))))
      : [h('div', { class: 'empty card' }, h('p', {}, 'No comments yet.'))]));
  } else if (tab === 'points' && m.is_me) {
    const { data: pts } = await sb.from('my_points').select('*').order('created_at', { ascending: false }).limit(60);
    body.replaceChildren(h('section', { class: 'card ledger' }, ...((pts || []).map((p) => h('div', { class: p.void ? 'void' : '' },
      h('span', {}, p.label, h('span', { class: 'xs muted' }, ` · ${ago(p.created_at)}${p.void ? ' · its post isn’t up' : ''}`)), h('b', {}, `+${p.amount}`))))));
  } else {
    const { data: ps } = await sb.from('feed').select('*').eq('author_id', m.id).order('created_at', { ascending: false }).limit(30);
    const rows = (ps || []).filter((p) => p.status === 'visible' || p.is_mine);
    body.replaceChildren(...(rows.length ? rows.map((p) => postCard(p)) : [h('div', { class: 'empty card' }, sig(64, 'idle'), h('p', {}, m.is_me ? 'You haven’t posted yet. Your first report earns 40 points.' : 'No posts yet.'))]));
  }
}

// ---------------------------------------------------------------------------
// Signal Builders and Quests pages
// ---------------------------------------------------------------------------
export async function renderBuilders() {
  const box = h('div', {}, h('div', { class: 'skel' }));
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, `// ${monthName()} ${new Date().getFullYear()}`), h('h1', {}, 'Signal Builders.')),
      h('p', { class: 'cap' }, 'Ranked by Signal points this month. Points go to taking part, never to results.')),
    box);
  setRail(await railCards('builders'));
  const { data } = await sb.from('signal_builders').select('*').order('rank').limit(50);
  const rows = data || [];
  if (!rows.length) { box.replaceChildren(h('div', { class: 'empty card' }, sig(72, 'curious'), h('p', {}, 'Nobody has points this month yet. Share how it went and you’re first.'))); return; }
  const top = rows.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  box.replaceChildren(
    h('div', { class: 'podium' }, order.map((r) => h('a', { class: `card pod p${r.rank}`, href: `#/u/${encodeURIComponent(r.handle)}` },
      h('span', { class: 'place' }, `#${r.rank}`), emblem(r.level, r.rank === 1 ? 72 : 56), h('b', {}, `u/${r.handle}`), h('span', { class: 'p num' }, fmtN(r.points)), h('span', { class: 'xs muted' }, r.level_name)))),
    h('section', { class: 'card lb' }, rows.slice(3).map(lbRow)),
    rows.some((r) => r.is_me) ? '' : h('p', { class: 'small muted mt12' }, 'You’re not on the board yet this month. One first-hand report gets you 40 points.'));
}

export async function renderQuests() {
  const weekly = questBox(99);
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, '// Build the Signal'), h('h1', {}, 'Quests.')),
      h('p', { class: 'cap' }, 'Every report, “same for me” and reply makes the numbers more accurate.')),
    seasonCard(true),
    h('h2', {}, 'Your quests'), h('section', { class: 'card' }, weekly),
    h('h2', {}, 'Community goals'),
    h('p', { class: 'small muted' }, 'Shared goals: unlock a compound’s first Signal, or bring a Signal past half from this community’s own reports.'),
    h('section', { class: 'card', id: 'goals' }, h('p', { class: 'muted' }, 'Loading…')),
    h('h2', {}, 'How points work'),
    h('section', { class: 'card ledger' }, Object.values(S.pointRules).filter((r) => r.points > 0).sort((a, b) => b.points - a.points)
      .map((r) => h('div', {}, h('span', {}, r.label), h('b', {}, `+${r.points}`)))));
  refreshQuests();
  setRail(await railCards('quests'));
  const { data } = await sb.from('community_goals').select('*').lt('pct', 100).order('pct', { ascending: false }).limit(12);
  const goals = document.getElementById('goals');
  if (goals) goals.replaceChildren(...((data || []).length ? data.map(goalRow) : [h('p', { class: 'muted' }, 'Every goal is done. Wow.')]));
}

export { plural };
