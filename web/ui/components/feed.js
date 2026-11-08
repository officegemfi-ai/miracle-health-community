// A feed's parts: the sort tabs, the posts (skeletons while they load), the "share how it went"
// bar, the pill that offers posts that just came in, and what an empty feed says.
import { h, icon } from '../dom.js';
import { sig, emblem } from '../art.js';
import { friendly } from '../../core/errors.js';
import { isStack } from '../../core/library.js';
import { on } from '../../app/events.js';
import { S, spaceOf } from '../../app/store.js';
import { postCard } from './post.js';

const SORTS = [['hot', 'Hot', 'flame'], ['new', 'New', 'clock'], ['top', 'Top', 'up'], ['reports', 'Reports', 'pulse']];
export function sortbar(base, sort) {
  return h('div', { class: 'sortbar', role: 'tablist', 'aria-label': 'Sort' },
    SORTS.map(([k, l, ic]) => h('a', { href: `${base}${base.includes('?') ? '&' : '?'}sort=${k}`, 'aria-current': sort === k ? 'page' : null, role: 'tab' }, icon(ic, 15), l)));
}

export async function fillFeed(list, q, empty) {
  list.replaceChildren(h('div', { class: 'skel' }), h('div', { class: 'skel' }), h('div', { class: 'skel' }));
  const { data, error } = await q;
  if (error) { list.replaceChildren(h('div', { class: 'msg err' }, friendly(error))); return []; }
  const rows = (data || []).filter((p) => p.status === 'visible' || p.is_mine);
  list.replaceChildren(...(rows.length ? rows.map(postCard) : [empty]));
  return rows;
}

export function composerBar(cid = '') {
  const sp = cid ? spaceOf(cid) : null;
  return h('div', { class: 'card composer-bar' },
    emblem(S.card?.level || 1, 36),
    h('a', { class: 'fake', href: `#/new${cid ? `?c=${encodeURIComponent(cid)}` : ''}`, role: 'button' },
      sp ? (isStack(sp) ? 'Share how this stack went for you…' : `Share how ${sp.name} went for you…`) : 'Share how it went for you…'),
    h('a', { class: 'btn ink sm', href: `#/new${cid ? `?c=${encodeURIComponent(cid)}` : ''}` }, icon('plus', 16), 'Post'));
}

let stopNewPosts = null;
export function newPostsPill(list, matcher, reload) {
  stopNewPosts?.();
  const box = h('div', { class: 'newposts hide' });
  let n = 0;
  stopNewPosts = on('post', (row) => {
    if (!row || row.author_id === S.me?.id || row.status !== 'visible' || !matcher(row)) return;
    n += 1;
    box.replaceChildren(h('button', { class: 'btn lime sm', type: 'button', onclick: () => { n = 0; box.classList.add('hide'); reload(); } }, icon('up', 16), `${n} new post${n === 1 ? '' : 's'}`));
    box.classList.remove('hide');
  });
  return box;
}

export function emptyHome() {
  return h('div', { class: 'empty card' }, sig(72, 'curious'), h('p', {}, 'Nothing here yet. Join a few spaces, or be the first to share how it went.'),
    h('div', { class: 'row' }, h('a', { class: 'btn lime sm', href: '#/explore' }, 'Explore spaces'), h('a', { class: 'btn sm', href: '#/new' }, 'Share yours')));
}
