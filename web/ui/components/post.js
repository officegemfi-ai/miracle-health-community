// A post as feeds and its own page show it, and what members do with one: vote, "same for me",
// Sig stickers, the menu (copy a link, report, edit). Members' text always goes in as text.
import { h, icon, toast, copy } from '../dom.js';
import { sticker, STICKERS, emblem, spaceTile } from '../art.js';
import { fmtN, ago } from '../../core/format.js';
import { friendly } from '../../core/errors.js';
import * as Posts from '../../data/posts.js';
import { track } from '../../data/telemetry.js';
import { spaceOf, signalOf } from '../../app/store.js';
import { sigSay } from '../shell.js';
import { sigNum, outcomeChip, readMini, refreshSignal } from './signal.js';
import { afterEarn } from './game.js';
import { openReport } from './report.js';

export function voteWidget(kind, item, horizontal = false) {
  const count = h('b', { class: 'num' }, String(item.score));
  const up = h('button', { type: 'button', class: 'up', 'aria-label': 'Helpful', 'aria-pressed': String(item.my_vote === 1) }, icon('up', 18));
  const down = h('button', { type: 'button', class: 'dn', 'aria-label': 'Not helpful', 'aria-pressed': String(item.my_vote === -1) }, icon('dn', 18));
  const box = h('span', { class: `vote ${horizontal ? 'h' : ''}` }, up, count, down);
  if (item.is_mine || item.status !== 'visible') {
    up.disabled = true; down.disabled = true;
    up.title = item.is_mine ? 'You can’t vote on your own' : '';
    return box;
  }
  const cast = async (value, btn) => {
    const prev = item.my_vote ?? null;
    const res = await Posts.vote(kind, item.id, prev, value);
    if (res.error) { toast(friendly(res.error)); return; }
    const next = prev === value ? null : value;
    item.score += (next ?? 0) - (prev ?? 0);
    item.my_vote = next;
    document.querySelectorAll(`[data-vote-of="${item.id}"]`).forEach((v) => v.replaceWith(voteWidget(kind, item, v.classList.contains('h'))));
    track('vote', { kind });
    if (next === 1) btn.animate?.([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260 });
  };
  up.addEventListener('click', () => cast(1, up));
  down.addEventListener('click', () => cast(-1, down));
  box.dataset.voteOf = item.id;
  return box;
}

export function sameButton(p) {
  if (!p.counts_for_signal || p.status !== 'visible') return null;
  const b = h('button', {
    class: 'act same', type: 'button', 'aria-pressed': String(!!p.i_same),
    title: p.is_mine ? 'Others tap this when their experience matched yours' : 'Had the same experience? It adds your voice to the Signal.',
  }, icon('same', 18), `Same for me · ${fmtN(p.same_count)}`);
  if (p.is_mine) { b.disabled = true; return b; }
  b.addEventListener('click', async () => {
    b.disabled = true;
    const res = await Posts.setSame(p.id, !p.i_same);
    b.disabled = false;
    if (res.error) { toast(friendly(res.error)); return; }
    p.i_same = !p.i_same;
    p.same_count += p.i_same ? 1 : -1;
    b.replaceChildren(icon('same', 18), `Same for me · ${fmtN(p.same_count)}`);
    b.setAttribute('aria-pressed', String(p.i_same));
    track('same_for_me', { on: p.i_same });
    if (p.i_same) {
      await afterEarn(b);
      sigSay(['Your voice is in the ', h('b', {}, `${p.compound_name} Signal`), ' now. Every match makes it more accurate.'], 'support', 4200);
    } else afterEarn(null);
    refreshSignal();
  });
  return b;
}

export function stickerRow(p) {
  const counts = p.reactions || {};
  const mine = new Set(p.my_reactions || []);
  const items = STICKERS.filter(([k]) => Number(counts[k]) > 0)
    .map(([k, label]) => h('span', { class: `stk-count ${mine.has(k) ? 'mine' : ''}`, title: label }, sticker(k, 22), fmtN(counts[k])));
  return items.length ? h('div', { class: 'stk-row' }, items) : null;
}

let openPop = null;
function closePop() { openPop?.remove(); openPop = null; document.removeEventListener('click', outsidePop, true); }
function outsidePop(e) { if (openPop && !openPop.contains(e.target)) closePop(); }
function popAt(anchor, node) {
  closePop();
  const r = anchor.getBoundingClientRect();
  node.style.left = `${Math.max(8, Math.min(window.innerWidth - 300, r.left + window.scrollX))}px`;
  node.style.top = `${r.bottom + window.scrollY + 6}px`;
  document.body.append(node);
  openPop = node;
  setTimeout(() => document.addEventListener('click', outsidePop, true), 0);
}

export function reactButton(p, onChange) {
  if (p.status !== 'visible') return null;
  const b = h('button', { class: 'act', type: 'button', 'aria-haspopup': 'true', title: p.is_mine ? 'Stickers are for other people’s posts' : 'Send a Sig sticker' }, sticker('cheer', 20), 'React');
  if (p.is_mine) { b.disabled = true; return b; }
  b.addEventListener('click', () => {
    const mine = new Set(p.my_reactions || []);
    const pop = h('div', { class: 'pop', role: 'menu', 'aria-label': 'Sig stickers' }, STICKERS.map(([k, label, hint]) => {
      const s = h('button', { type: 'button', role: 'menuitemcheckbox', 'aria-pressed': String(mine.has(k)), title: hint }, sticker(k, 40), label);
      s.addEventListener('click', async () => {
        const on = mine.has(k);
        const res = await Posts.setSticker(p.id, k, !on);
        if (res.error) { toast(friendly(res.error)); return; }
        p.reactions = { ...(p.reactions || {}), [k]: Math.max(0, Number(p.reactions?.[k] || 0) + (on ? -1 : 1)) };
        p.my_reactions = on ? (p.my_reactions || []).filter((x) => x !== k) : [...(p.my_reactions || []), k];
        closePop();
        onChange();
        if (!on) sigSay([`${label} sent. `, h('b', {}, `u/${p.author_handle}`), ' will see it on their post.'], k, 3000);
        track('sticker', { sticker: k });
      });
      return s;
    }));
    popAt(b, pop);
  });
  return b;
}

export function moreButton(p) {
  const b = h('button', { class: 'act', type: 'button', 'aria-label': 'More', 'aria-haspopup': 'true' }, icon('more', 18));
  b.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}#/post/${p.id}`;
    const items = [
      h('button', { type: 'button', onclick: async () => { closePop(); toast((await copy(url)) ? 'Link copied. Only members can open it.' : url); } }, icon('link', 18), 'Copy link'),
      !p.is_mine && p.status === 'visible' ? h('button', { type: 'button', onclick: () => { closePop(); openReport('post', p.id); } }, icon('flag', 18), 'Report post') : null,
      !p.is_mine ? h('button', { type: 'button', onclick: () => { closePop(); openReport('member', p.author_id); } }, icon('user', 18), `Report u/${p.author_handle}`) : null,
      p.is_mine && p.status !== 'removed' ? h('a', { href: `#/post/${p.id}?edit=1`, onclick: closePop }, icon('edit', 18), 'Edit') : null,
    ];
    popAt(b, h('div', { class: 'pop menu', role: 'menu' }, items));
  });
  return b;
}

export function statusChip(item) {
  if (item.status === 'held') return h('span', { class: 'chip held', title: item.status_reason || '' }, 'Waiting for a moderator · only you can see it');
  if (item.status === 'removed') return h('span', { class: 'chip removed' }, `Removed${item.status_reason ? `: ${item.status_reason}` : ''}`);
  return null;
}

export function spaceLink(p) {
  const sp = spaceOf(p.compound_id) || { name: p.compound_name, category: p.compound_category };
  return h('a', { class: 'space', href: `#/s/${encodeURIComponent(p.compound_id)}` }, spaceTile(sp, 22), `s/${p.compound_name}`);
}

export function authorLink(p, cls = 'who') {
  return h('a', { class: cls, href: `#/u/${encodeURIComponent(p.author_handle)}` }, emblem(p.author_level || 1, 18), `u/${p.author_handle}`);
}

export function postCard(p) {
  const href = `#/post/${encodeURIComponent(p.id)}`;
  const card = h('article', { class: 'card post', 'data-post': p.id });
  const draw = () => {
    const x = signalOf(p.compound_id);
    card.replaceChildren(
      h('div', { class: 'vrail' }, voteWidget('post', p)),
      h('div', { class: 'post-main' },
        h('div', { class: 'post-head' }, spaceLink(p), h('span', { class: 'sep' }, '·'), authorLink(p), h('span', { class: 'sep' }, '·'), h('span', {}, ago(p.created_at)),
          x && x.score != null ? h('span', { class: 'grow' }) : null,
          x && x.score != null ? h('a', { class: 'chip', href: `#/s/${encodeURIComponent(p.compound_id)}`, title: `${p.compound_name} Community Signal` }, 'Signal ', sigNum(p.compound_id)) : null),
        h('a', { class: 'post-title', href }, p.title),
        h('div', { class: 'post-chips' }, p.kind === 'question' ? h('span', { class: 'chip' }, 'Question') : h('span', { class: 'chip' }, 'Report'), outcomeChip(p), statusChip(p), readMini(p),
          p.duration && p.counts_for_signal ? h('span', { class: 'chip' }, p.duration) : null),
        h('div', { class: 'excerpt' }, p.body),
        stickerRow(p),
        h('div', { class: 'acts' },
          voteWidget('post', p, true),
          h('a', { class: 'act', href }, icon('comment', 18), `${fmtN(p.comment_count)} comment${p.comment_count === 1 ? '' : 's'}`),
          sameButton(p),
          reactButton(p, draw),
          moreButton(p))));
  };
  draw();
  return card;
}
