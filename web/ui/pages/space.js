// A space: one compound, blend or stack, with its Community Signal, where it leads in the rest of
// Miracle Health, and its posts (a compound's own, or the stacks and blends it's in).
import { h, icon } from '../dom.js';
import { sig, spaceTile } from '../art.js';
import { fmtN, plural } from '../../core/format.js';
import { isStack, familyLabel, containing } from '../../core/library.js';
import { partsOf } from '../../core/posts.js';
import * as Posts from '../../data/posts.js';
import { S, spaceOf, signalOf } from '../../app/store.js';
import { render } from '../shell.js';
import { fillRail } from '../rail.js';
import { signalCard } from '../components/signal.js';
import { sortbar, fillFeed, composerBar, newPostsPill } from '../components/feed.js';
import { joinButton, partChips, askAbout, evidenceTag, LIBRARY } from '../components/spaces.js';
import { askLink } from '../../kit/kit.js';

// Where this space leads in the rest of Miracle Health: how strong the evidence is (the Library's
// grade), its fact sheet, and Sig with a question about it typed in
function spaceLinks(sp) {
  const slot = h('span', { class: 'ev-slot' });
  if (sp.kind !== 'stack') evidenceTag(sp.compound_id).then((el) => { if (el) slot.replaceWith(el); else slot.remove(); });
  return h('div', { class: 'space-links' },
    sp.kind === 'stack' ? null : slot,
    sp.kind === 'stack' ? null : h('a', { href: `${LIBRARY}${encodeURIComponent(sp.compound_id)}/` }, icon('flask', 16), 'Fact sheet'),
    h('a', { href: askLink(askAbout(sp)) }, icon('sparkle', 16), 'Ask Sig'));
}

export async function renderSpace(cid, sort = 'hot', only = 'all') {
  const sp = spaceOf(cid);
  if (!sp) { render(h('div', { class: 'empty card' }, sig(72, 'curious'), h('p', {}, 'That space doesn’t exist.'), h('a', { class: 'btn sm', href: '#/explore' }, 'Explore spaces'))); return; }
  const list = h('div', {});
  const stack = isStack(sp);
  const single = !stack && sp.kind !== 'blend';
  const base = `#/s/${encodeURIComponent(cid)}${only !== 'all' ? `?only=${only}` : ''}`;
  // A compound's space shows its own posts and the stacks and blends it's in; "only" narrows that
  const q = Posts.feed(sort, { space: { cid, only } });
  const reload = () => fillFeed(list, q, h('div', { class: 'empty card' }, sig(72, 'curious'),
    h('p', {}, stack ? `No posts in this stack yet.` : `No posts in s/${sp.name} yet. The first first-hand report here earns the Pioneer badge.`),
    h('a', { class: 'btn lime sm', href: `#/new?c=${encodeURIComponent(cid)}` }, 'Share how it went')));
  const x = signalOf(cid);
  const inStacks = single ? containing(S.spaces, [cid]) : [];
  const kick = stack ? `Stack · ${plural((sp.part_ids || []).length, 'compound')}` : `${familyLabel(sp)} · ${sp.category}`;
  render(
    h('section', { class: 'hero' },
      h('div', { class: 'space-hero' },
        spaceTile(sp, 72),
        h('div', {}, h('div', { class: 'kick' }, kick), h('h1', {}, `${sp.name}.`),
          h('p', { class: 'lede' }, `${fmtN(sp.members_count)} member${sp.members_count === 1 ? '' : 's'} · ${fmtN(sp.posts_week)} post${sp.posts_week === 1 ? '' : 's'} this week · ${fmtN(sp.reports)} first-hand report${sp.reports === 1 ? '' : 's'}`)),
        h('div', { class: 'join' }, joinButton(sp))),
      stack ? partChips(sp, 'In this stack') : sp.kind === 'blend' ? partChips(sp, 'In the vial') : null,
      sp.aliases?.length ? h('p', { class: 'xs muted mt8 aka' }, `Also called ${sp.aliases.slice(0, 8).join(', ')}`) : null,
      spaceLinks(sp)),
    stack ? h('p', { class: 'msg note' }, 'This stack’s Signal comes only from reports of exactly this stack. Each compound’s own number counts only reports of it alone.') : null,
    signalCard(cid),
    x && x.themes && x.themes.length ? h('div', { class: 'post-chips mt12' }, h('span', { class: 'kick' }, 'What people mention'), x.themes.map((t) => h('span', { class: 'chip' }, `${t.theme} · ${t.label}`))) : null,
    inStacks.length ? h('div', { class: 'post-chips mt12' }, h('span', { class: 'kick' }, 'Also in'),
      inStacks.slice(0, 6).map((st) => h('a', { class: 'chip part', href: `#/s/${encodeURIComponent(st.compound_id)}` }, spaceTile(st, 16), st.name)),
      h('a', { class: 'chip', href: `#/stack?c=${encodeURIComponent(cid)}` }, icon('layers', 14), 'Find a stack')) : null,
    h('div', { class: 'mt16' }, composerBar(cid)),
    single ? h('div', { class: 'sortbar only', role: 'tablist', 'aria-label': 'Which posts' },
      [['all', 'All posts'], ['own', `Just ${sp.name}`], ['stacks', 'In stacks and blends']].map(([k, l]) =>
        h('a', { href: `#/s/${encodeURIComponent(cid)}${k !== 'all' ? `?only=${k}` : ''}${sort !== 'hot' ? `${k !== 'all' ? '&' : '?'}sort=${sort}` : ''}`, role: 'tab', 'aria-current': only === k ? 'page' : null }, l))) : null,
    sortbar(base, sort),
    newPostsPill(list, (row) => partsOf(row).includes(cid) && (only !== 'own' || row.compound_id === cid) && (only !== 'stacks' || row.compound_id !== cid), reload),
    list);
  await Promise.all([fillRail('space', { cid }), reload()]);
}
