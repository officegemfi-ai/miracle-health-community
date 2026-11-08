// Signal Builders: this month's board, ranked by Signal points.
import { h } from '../dom.js';
import { sig, emblem } from '../art.js';
import { fmtN } from '../../core/format.js';
import { monthName } from '../../core/game.js';
import * as Members from '../../data/members.js';
import { render, setRail } from '../shell.js';
import { railCards } from '../rail.js';
import { lbRow } from '../components/game.js';

export async function renderBuilders() {
  const box = h('div', {}, h('div', { class: 'skel' }));
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, `// ${monthName()} ${new Date().getFullYear()}`), h('h1', {}, 'Signal Builders.')),
      h('p', { class: 'cap' }, 'Ranked by Signal points this month. Points go to taking part, never to results.')),
    box);
  setRail(await railCards('builders'));
  const { data } = await Members.builders(50);
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
