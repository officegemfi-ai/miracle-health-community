// The game on screen: points floating up from what you tapped, your emblem card, quests, the
// monthly Signal Builders, community goals, the season, and the celebration at a new emblem. Every
// number comes from the database; this only shows it and celebrates it.
import { h, icon, bar, toast, modal, tick } from '../dom.js';
import { sig, emblem, emblemRing, spaceTile } from '../art.js';
import { fmtN } from '../../core/format.js';
import { friendly } from '../../core/errors.js';
import { nextLevel, progressPct, questOrder, seasonPct, daysLeft, monthName } from '../../core/game.js';
import * as Members from '../../data/members.js';
import { track } from '../../data/telemetry.js';
import { S, levelOf } from '../../app/store.js';
import { loadCard, loadPulse, loadQuests } from '../../app/session.js';
import { renderTop, refreshNav, sigSay } from '../shell.js';

// Points: a "+N" that floats up from what you tapped, and the header ticks
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

// Every "Your emblem" card on screen follows the points as they change
export function refreshMeCards() {
  document.querySelectorAll('[data-mecard]').forEach((el) => { const fresh = meCard(); if (fresh) el.replaceWith(fresh); });
}

export function meCard() {
  const c = S.card;
  if (!c) return null;
  const lv = levelOf(c.level);
  const next = nextLevel(S.levels, c.level);
  const pct = progressPct(lv, next, c.points);
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

const questBoxes = new Set();   // every quest list made, on the page or about to be
let questsLoading = null;
export function refreshQuests() {
  questsLoading ||= (async () => {
    await loadQuests();
    questBoxes.forEach((box) => {
      if (!box.isConnected && Date.now() - Number(box.dataset.made) > 8000) questBoxes.delete(box);
      else fillQuests(box, Number(box.dataset.quests));
    });
    refreshNav();
    questsLoading = null;
    return S.quests;
  })();
  return questsLoading;
}

export function questBox(n) {
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
  const order = questOrder(S.quests);
  box.replaceChildren(...(order.length ? order.slice(0, n || 99).map(questRow) : [h('p', { class: 'xs muted' }, 'Loading…')]));
}

export function questsCard(n = 3) {
  const box = questBox(n);
  refreshQuests();
  return h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('span', { class: 'kick' }, 'Quests this week'), h('a', { href: '#/quests' }, 'All')), box);
}

async function claimQuest(q, btn) {
  btn.disabled = true;
  const { data, error } = await Members.claimQuest(q.key);
  if (error) { btn.disabled = false; toast(friendly(error)); return; }
  track('quest_claimed', { quest: q.key });
  await afterEarn(btn, `· ${q.title}`);
  sigSay(['Quest done: ', h('b', {}, `+${data}`), '. That’s follow-through, and it’s what makes the Signal trustworthy.'], 'cheer', 4500, true);
}

export function buildersCard(n = 5) {
  const box = h('div', { class: 'lb' }, h('p', { class: 'xs muted' }, 'Loading…'));
  Members.builders(n).then(({ data }) => {
    box.replaceChildren(...((data || []).length ? data.map(lbRow) : [h('p', { class: 'xs muted' }, 'Nobody yet this month. Be first.')]));
  });
  return h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('span', { class: 'kick' }, `Signal Builders · ${monthName()}`), h('a', { href: '#/builders' }, 'All')), box);
}

export function lbRow(r) {
  return h('a', { class: `lb-row ${r.is_me ? 'me' : ''}`, href: `#/u/${encodeURIComponent(r.handle)}` },
    h('span', { class: 'n' }, `#${r.rank}`), emblem(r.level, 28, false, `${r.level_name} emblem`),
    h('span', { class: 'grow' }, h('b', {}, `u/${r.handle}`), r.is_me ? h('span', { class: 'xs muted' }, ' · you') : null),
    h('span', { class: 'p' }, fmtN(r.points)));
}

export async function goalsCard(n = 4, cid = '') {
  const { data } = await Members.goals(60);
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
  const left = daysLeft(p.season_ends);
  const pct = seasonPct(p);
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

// Celebrations
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
