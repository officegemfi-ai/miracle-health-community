// A member's profile: their emblem and points, badges, the path of fifteen emblems, and their posts,
// comments or (your own) points ledger.
import { h, icon } from '../dom.js';
import { sig, emblem, emblemRing } from '../art.js';
import { fmtN, ago } from '../../core/format.js';
import { nextLevel, progressPct, monthName } from '../../core/game.js';
import * as Members from '../../data/members.js';
import * as Comments from '../../data/comments.js';
import * as Posts from '../../data/posts.js';
import { S, levelOf } from '../../app/store.js';
import { render, setRail } from '../shell.js';
import { railCards } from '../rail.js';
import { postCard } from '../components/post.js';

export async function renderProfile(handle, tab = 'posts') {
  render(h('div', { class: 'skel' }), h('div', { class: 'skel' }));
  const { data } = await Members.cardByHandle(handle);
  const m = data && data[0];
  if (!m) { render(h('div', { class: 'empty card' }, sig(72, 'curious'), h('p', {}, `There’s nobody called u/${handle} here.`))); return; }
  const lv = levelOf(m.level);
  const next = nextLevel(S.levels, m.level);
  const pct = progressPct(lv, next, m.points);
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
  if (tab === 'comments') {
    const { data: cs } = await Comments.byAuthor(m.id);
    body.replaceChildren(...((cs || []).length ? cs.map((c) => h('a', { class: 'card notif', href: `#/post/${c.post_id}` },
      h('span', { class: 'ico' }, icon('comment', 18)), h('span', {}, h('span', { class: 't' }, c.body)), h('span', { class: 'when' }, ago(c.created_at))))
      : [h('div', { class: 'empty card' }, h('p', {}, 'No comments yet.'))]));
  } else if (tab === 'points' && m.is_me) {
    const { data: pts } = await Members.pointsLedger();
    body.replaceChildren(h('section', { class: 'card ledger' }, ...((pts || []).map((p) => h('div', { class: p.void ? 'void' : '' },
      h('span', {}, p.label, h('span', { class: 'xs muted' }, ` · ${ago(p.created_at)}${p.void ? ' · its post isn’t up' : ''}`)), h('b', {}, `+${p.amount}`))))));
  } else {
    const { data: ps } = await Posts.byAuthor(m.id);
    const rows = (ps || []).filter((p) => p.status === 'visible' || p.is_mine);
    body.replaceChildren(...(rows.length ? rows.map((p) => postCard(p)) : [h('div', { class: 'empty card' }, sig(64, 'idle'), h('p', {}, m.is_me ? 'You haven’t posted yet. Your first report earns 40 points.' : 'No posts yet.'))]));
  }
}
