// The right rail, page by page: the cards beside each page's own content. A page starts its rail
// with fillRail() and loads its own content alongside, so the page never waits on the rail.
import { h, icon } from './dom.js';
import { spaceTile } from './art.js';
import { fmtN } from '../core/format.js';
import { S } from '../app/store.js';
import { setRail } from './shell.js';
import { signalCard } from './components/signal.js';
import { movesCard } from './components/moves.js';
import { meCard, questsCard, buildersCard, goalsCard, seasonCard } from './components/game.js';
import { focusCard } from './components/checks.js';
import { joinButton, askAbout, LIBRARY } from './components/spaces.js';
import { SITE, placeHref, askLink } from '../kit/kit.js';

// The cards that read the database ask at the same time, in their places; one after another, a
// phone paid a round trip per card before the rail (and the page waiting on it) could fill.
export function railCards(kind, ctx = {}) {
  switch (kind) {
    case 'space': return Promise.all([aboutSpace(ctx.cid), focusCard(), goalsCard(4, ctx.cid), buildersCard(5)]);
    case 'post': return Promise.all([ctx.cid ? signalCard(ctx.cid, { compact: true }) : null, aboutSpace(ctx.cid), questsCard(3)]);
    case 'signal': return Promise.all([movesCard(), seasonCard(), goalsCard(5)]);
    case 'builders': return Promise.all([meCard(), seasonCard(), questsCard(3)]);
    case 'quests': return Promise.all([meCard(), movesCard(), buildersCard(5)]);
    case 'profile': return Promise.all([buildersCard(5), movesCard()]);
    case 'explore': return Promise.all([seasonCard(), movesCard()]);
    // Until their first report, a newcomer sees three ways in first, then their emblem and quests
    default: return Promise.all(S.card && !Number(S.card.posts)
      ? [startCard(), meCard(), questsCard(3), focusCard(), movesCard(), goalsCard(4)]
      : [meCard(), focusCard(), questsCard(3), movesCard(), buildersCard(5), goalsCard(4)]);
  }
}

// The rail for a page, filled beside it: a page starts this, loads its own content, then waits
// for both, so its feed or list never waits behind the side cards' queries
export function fillRail(kind, ctx) { return railCards(kind, ctx).then(setRail); }

// Three ways in, for someone who hasn't posted yet: look it up, ask, share how it went
function startCard() {
  const way = (href, ic, title, sub, cls = '') => h('a', { class: `start-i${cls}`, href }, icon(ic, 18), h('span', {}, h('b', {}, title), h('span', { class: 'xs muted' }, sub)), icon('chevron', 16));
  return h('section', { class: 'card start-card' },
    h('div', { class: 'card-h' }, h('span', { class: 'kick' }, 'Start here')),
    way(`${SITE}/library/`, 'flask', 'Look it up', 'What the studies show, compound by compound'),
    way(placeHref('ai'), 'sparkle', 'Ask Sig', 'The studies and what people report, in one answer'),
    way('#/new', 'plus', 'Share how it went', 'Your first report starts your points and emblem', ' main'));
}

// The space you're in: its numbers, joining, sharing, its fact sheet and Sig
async function aboutSpace(cid) {
  const sp = S.spaces.find((s) => s.compound_id === cid);
  if (!sp) return null;
  return h('section', { class: 'card' },
    h('div', { class: 'row nw' }, spaceTile(sp, 40), h('div', { class: 'grow' }, h('b', {}, `s/${sp.name}`), h('div', { class: 'xs muted' }, sp.category))),
    h('div', { class: 'stats two' },
      h('div', { class: 'stat card' }, h('b', { class: 'num' }, fmtN(sp.members_count)), h('span', {}, 'Members')),
      h('div', { class: 'stat card' }, h('b', { class: 'num' }, fmtN(sp.reports)), h('span', {}, 'Reports'))),
    h('div', { class: 'mt12' }, joinButton(sp, 'block')),
    h('a', { class: 'btn ghost block mt8', href: `#/new?c=${encodeURIComponent(cid)}` }, icon('plus', 16), 'Share how it went'),
    sp.kind === 'stack' ? null : h('a', { class: 'lib-link mt12', href: `${LIBRARY}${encodeURIComponent(cid)}/` },
      icon('flask', 18), h('span', { class: 'grow' }, h('b', {}, 'Fact sheet'), h('span', { class: 'xs muted' }, 'Evidence, risks and blood markers, with sources')), icon('chevron', 16)),
    h('a', { class: 'lib-link mt8', href: askLink(askAbout(sp)) },
      icon('sparkle', 18), h('span', { class: 'grow' }, h('b', {}, 'Ask Sig'), h('span', { class: 'xs muted' }, `What ${sp.name} may do for you, and how it fits what you take`)), icon('chevron', 16)));
}
