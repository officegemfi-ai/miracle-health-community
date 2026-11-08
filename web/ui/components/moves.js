// The live moves card: what changed, by how much, and why. A move that happens while it's on
// screen arrives at the top (ui/live.js).
import { h } from '../dom.js';
import { spaceTile } from '../art.js';
import { fmt1, ago } from '../../core/format.js';
import { CAUSE } from '../../core/signal.js';
import * as Signal from '../../data/signal.js';
import { spaceOf } from '../../app/store.js';
import { movement } from './signal.js';

let movesBox = null;

function moveRow(m, fresh = false) {
  const sp = spaceOf(m.compound_id) || { name: m.compound_name, category: '' };
  return h('a', { class: `move-i ${fresh ? 'fresh' : ''}`, href: `#/s/${encodeURIComponent(m.compound_id)}` },
    spaceTile(sp, 30),
    h('span', {}, h('b', {}, m.compound_name), h('span', { class: 'why' }, `${CAUSE[m.cause] || 'new reports'} · ${ago(m.computed_at)}`)),
    h('span', { class: 'row nw' }, h('span', { class: 'num mono small' }, fmt1(m.score)), movement(Number(m.delta))));
}

function prependMove(box, m) {
  box.prepend(moveRow(m, true));
  while (box.children.length > 8) box.lastChild.remove();
}

export async function movesCard(dark = true) {
  const box = h('div', { class: 'moves' }, h('p', { class: 'xs muted' }, 'Loading…'));
  movesBox = box;
  const card = h('section', { class: `card ${dark ? 'dark' : ''}` },
    h('div', { class: 'card-h' }, h('span', { class: 'kick row nw' }, h('span', { class: 'live-dot' }), ' Live moves'), h('a', { href: '#/signal' }, 'The Signal')), box);
  Signal.moves(8).then(({ data }) => {
    box.replaceChildren(...((data || []).length ? data.map((m) => moveRow(m)) : [h('p', { class: 'xs muted' }, 'No moves yet. The first report moves it.')]));
  });
  return card;
}

// A move that just happened, on the card if one is on screen
export function addMove(m) {
  if (movesBox) prependMove(movesBox, m);
}
