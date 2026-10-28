// The frame around every page: the left menu (never removed; a drawer on
// phones), the top bar, the phone tab bar, search, the right rail, and Sig.
import { h, icon, fmtN, fmt1, bar } from './ui.js';
import { sig, emblem, spaceTile } from './art.js';
import { S, sb, isMod, levelOf } from './state.js';
import { signalCard, movesCard } from './signal.js';
import { meCard, questsCard, buildersCard, goalsCard, seasonCard, bellButton, claimable } from './game.js';
import { searchLibrary, familyLabel } from './library.js';

const app = document.getElementById('app');
const rail = document.getElementById('rail');
const nav = document.getElementById('nav');
const tabbar = document.getElementById('tabbar');
const actions = document.getElementById('top-actions');
const searchBox = document.getElementById('search');

export function render(...nodes) {
  app.replaceChildren(...nodes.flat().filter(Boolean));
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
export function setRail(nodes) { rail.replaceChildren(...[nodes].flat().filter(Boolean)); }
export function setWide(on) { document.body.classList.toggle('wide', !!on); }

// ---------------------------------------------------------------------------
// Right rail, by page
// ---------------------------------------------------------------------------
export async function railCards(kind, ctx = {}) {
  switch (kind) {
    case 'space': return [await aboutSpace(ctx.cid), await goalsCard(4, ctx.cid), buildersCard(5)];
    case 'post': return [ctx.cid ? signalCard(ctx.cid, { compact: true }) : null, await aboutSpace(ctx.cid), questsCard(3)];
    case 'signal': return [await movesCard(), seasonCard(), await goalsCard(5)];
    case 'builders': return [meCard(), seasonCard(), questsCard(3)];
    case 'quests': return [meCard(), await movesCard(), buildersCard(5)];
    case 'profile': return [buildersCard(5), await movesCard()];
    case 'explore': return [seasonCard(), await movesCard()];
    default: return [meCard(), questsCard(3), await movesCard(), buildersCard(5), await goalsCard(4)];
  }
}

async function aboutSpace(cid) {
  const sp = S.spaces.find((s) => s.compound_id === cid);
  if (!sp) return null;
  const { joinButton } = await import('./feed.js');
  return h('section', { class: 'card' },
    h('div', { class: 'row nw' }, spaceTile(sp, 40), h('div', { class: 'grow' }, h('b', {}, `s/${sp.name}`), h('div', { class: 'xs muted' }, sp.category))),
    h('div', { class: 'stats two' },
      h('div', { class: 'stat card' }, h('b', { class: 'num' }, fmtN(sp.members_count)), h('span', {}, 'Members')),
      h('div', { class: 'stat card' }, h('b', { class: 'num' }, fmtN(sp.reports)), h('span', {}, 'Reports'))),
    h('div', { class: 'mt12' }, joinButton(sp, 'block')),
    h('a', { class: 'btn ghost block mt8', href: `#/new?c=${encodeURIComponent(cid)}` }, icon('plus', 16), 'Share how it went'));
}

// ---------------------------------------------------------------------------
// Left menu
// ---------------------------------------------------------------------------
const MAIN = [
  ['home', 'Home', 'home', '#/home'], ['popular', 'Popular', 'flame', '#/popular'], ['signal', 'The Signal', 'pulse', '#/signal'],
  ['explore', 'Explore spaces', 'compass', '#/explore'], ['stack', 'Find your stack', 'layers', '#/stack'],
  ['builders', 'Signal Builders', 'trophy', '#/builders'], ['quests', 'Quests', 'target', '#/quests'],
];
let spacesOpen = true;
let lastNav = ['', ''];
export const refreshNav = () => renderNav(...lastNav);
export function renderNav(current = '', cid = '') {
  lastNav = [current, cid];
  if (!S.me) { nav.replaceChildren(); return; }
  const joined = S.spaces.filter((s) => s.joined);
  const q = claimable();
  const items = MAIN.map(([k, label, ic, href]) => h('a', { class: 'nav-i', href, 'data-nav': k, 'aria-current': current === k ? 'page' : null },
    icon(ic, 20), label, k === 'signal' ? h('span', { class: 'badge-n' }, h('span', { class: 'live-dot' })) : null,
    k === 'quests' && q ? h('span', { class: 'badge-n' }, `${q} ready`) : null));
  const toggle = h('button', { type: 'button', 'aria-expanded': String(spacesOpen), 'aria-label': 'Show or hide your spaces', onclick: () => { spacesOpen = !spacesOpen; renderNav(current, cid); } }, icon(spacesOpen ? 'down' : 'chevron', 16));
  nav.replaceChildren(
    ...items,
    h('div', { class: 'nav-sec' }, h('span', { class: 'kick' }, 'Your spaces'), toggle),
    ...(!spacesOpen ? [] : joined.length
      ? joined.map((s) => h('a', { class: 'nav-space', href: `#/s/${encodeURIComponent(s.compound_id)}`, 'aria-current': cid === s.compound_id ? 'page' : null },
        spaceTile(s, 24), h('span', { class: 'grow' }, s.name), h('span', { class: 's', 'data-sig-of': s.compound_id }, s.score != null ? fmt1(s.score) : '')))
      : [h('p', { class: 'nav-empty' }, 'You haven’t joined any yet. ', h('a', { href: '#/explore' }, 'Explore spaces'))]),
    h('div', { class: 'nav-sec' }, h('span', { class: 'kick' }, 'Resources')),
    h('a', { class: 'nav-i', href: '#/how', 'aria-current': current === 'how' ? 'page' : null }, icon('info', 20), 'How it works'),
    h('a', { class: 'nav-i', href: '#/rules', 'data-nav': 'rules', 'aria-current': current === 'rules' ? 'page' : null }, icon('book', 20), 'Community rules'),
    h('a', { class: 'nav-i', href: '#/account', 'data-nav': 'account', 'aria-current': current === 'account' ? 'page' : null }, icon('gear', 20), 'Account'),
    isMod() ? h('a', { class: 'nav-i', href: '#/mod', 'data-nav': 'mod', 'aria-current': current === 'mod' ? 'page' : null }, icon('shield', 20), 'Moderation') : '',
    seasonMini() || '');
}

function seasonMini() {
  const p = S.pulse;
  if (!p?.season_name) return null;
  const pct = Math.min(100, (100 * p.season_reports) / (p.season_goal || 1));
  return h('a', { class: 'season-mini', href: '#/quests' },
    h('span', { class: 'kick' }, p.season_name),
    h('b', {}, `${fmtN(p.season_reports)} of ${fmtN(p.season_goal)} first-hand reports`),
    bar(pct), h('div', { class: 'xs' }, 'Every report gets the whole community closer.'));
}

// ---------------------------------------------------------------------------
// Top bar, phone tabs, search
// ---------------------------------------------------------------------------
export function renderTop() {
  if (!S.me) { actions.replaceChildren(); searchBox.replaceChildren(); tabbar.replaceChildren(); return; }
  const lv = levelOf(S.card?.level || 1);
  actions.replaceChildren(
    h('a', { class: 'btn lime sm create', href: '#/new' }, icon('plus', 16), h('span', { class: 'lbl' }, 'Create')),
    bellButton(),
    h('a', { class: 'me-chip', href: `#/u/${encodeURIComponent(S.me.handle)}`, title: `${lv.name} · your profile`, id: 'me-chip' },
      emblem(S.card?.level || 1, 32, false, `${lv.name} emblem`),
      h('span', {}, h('b', { id: 'my-points', class: 'num' }, fmtN(S.card?.points ?? 0)), ' ', h('span', { class: 'kick' }, 'pts'))));
  renderSearch();
}

export function renderTabbar(current = '') {
  if (!S.me) { tabbar.replaceChildren(); return; }
  const t = (k, label, ic, href, cls = '') => h('a', { href, class: cls, 'aria-current': current === k ? 'page' : null },
    h('span', { class: 'ic-wrap' }, icon(ic, 20)), label);
  tabbar.replaceChildren(
    t('home', 'Home', 'home', '#/home'), t('signal', 'Signal', 'pulse', '#/signal'),
    t('new', 'Share', 'plus', '#/new', 'make'), t('builders', 'Builders', 'trophy', '#/builders'),
    t('me', 'You', 'user', `#/u/${encodeURIComponent(S.me.handle)}`));
}

function renderSearch() {
  const input = h('input', { type: 'search', placeholder: 'Search compounds, stacks, posts, members', 'aria-label': 'Search', autocomplete: 'off' });
  const pop = h('div', { class: 'search-pop hide', role: 'listbox' });
  let timer = null;
  const go = (href) => { pop.classList.add('hide'); input.value = ''; location.hash = href; };
  const run = async () => {
    const q = input.value.trim();
    if (q.length < 2) { pop.classList.add('hide'); return; }
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const spaces = searchLibrary(q, { kinds: ['compound', 'blend', 'stack'], limit: 5 });
    const [posts, people] = await Promise.all([
      sb.from('feed').select('id,title,compound_name,status').ilike('title', like).eq('status', 'visible').limit(5),
      sb.from('member_cards').select('handle,level').ilike('handle', like).limit(4),
    ]);
    const rows = [
      ...spaces.map(({ sp: s, via }) => h('a', { href: `#/s/${encodeURIComponent(s.compound_id)}`, onclick: (e) => { e.preventDefault(); go(`#/s/${s.compound_id}`); } }, spaceTile(s, 26),
        h('span', { class: 'grow' }, `s/${s.name}`, via ? h('span', { class: 'xs muted' }, ` · “${via}”`) : null), h('span', { class: 'xs muted' }, familyLabel(s)))),
      ...(posts.data || []).map((p) => h('a', { href: `#/post/${p.id}`, onclick: (e) => { e.preventDefault(); go(`#/post/${p.id}`); } }, icon('comment', 18), h('span', { class: 'grow' }, p.title), h('span', { class: 'xs muted' }, p.compound_name))),
      ...(people.data || []).map((m) => h('a', { href: `#/u/${m.handle}`, onclick: (e) => { e.preventDefault(); go(`#/u/${m.handle}`); } }, emblem(m.level, 24), h('span', { class: 'grow' }, `u/${m.handle}`), h('span', { class: 'xs muted' }, 'Member'))),
    ];
    pop.replaceChildren(...(rows.length ? rows : [h('p', { class: 'xs muted pad' }, 'Nothing found.')]));
    pop.classList.remove('hide');
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = pop.querySelector('a'); if (a) a.click(); } if (e.key === 'Escape') pop.classList.add('hide'); });
  input.addEventListener('blur', () => setTimeout(() => pop.classList.add('hide'), 200));
  searchBox.replaceChildren(icon('search', 18), input, pop);
}

// Phone drawer for the left menu
const burger = document.getElementById('burger');
let scrim = null;
export function closeDrawer() {
  document.body.classList.remove('drawer');
  burger?.setAttribute('aria-expanded', 'false');
  scrim?.remove(); scrim = null;
}
burger?.addEventListener('click', () => {
  const open = !document.body.classList.contains('drawer');
  if (!open) return closeDrawer();
  document.body.classList.add('drawer');
  burger.setAttribute('aria-expanded', 'true');
  scrim = h('div', { class: 'scrim', onclick: closeDrawer });
  document.body.append(scrim);
});
nav.addEventListener('click', (e) => { if (e.target.closest('a')) closeDrawer(); });

// ---------------------------------------------------------------------------
// Sig, in the corner: tips, reactions and news
// ---------------------------------------------------------------------------
const dock = document.getElementById('sigdock');
let bubble = null;
let sigBtn = null;
let hideTimer = null;
const night = () => { const hr = new Date().getHours(); return hr >= 23 || hr < 6; };
export function baseMood() { return navigator.onLine === false ? 'offline' : night() ? 'sleepy' : 'idle'; }
export function mountSig(tipFor) {
  if (!S.me) { dock.replaceChildren(); return; }
  bubble = h('div', { class: 'sigsay', role: 'status', 'aria-live': 'polite' });
  sigBtn = h('button', { type: 'button', 'aria-label': 'Sig, the Community Signal in person', title: 'Sig' }, sig(64, baseMood()));
  sigBtn.addEventListener('click', () => sigSay(tipFor(), 'happy', 5200));
  dock.replaceChildren(sigBtn, bubble);
}
export function sigMood(mood, ms = 0) {
  if (!sigBtn) return;
  sigBtn.replaceChildren(sig(64, mood));
  if (ms) setTimeout(() => sigBtn?.replaceChildren(sig(64, baseMood())), ms);
}
// Important news (your report counted, a new emblem) isn't talked over by tips
let holdUntil = 0;
export function sigSay(content, mood = 'happy', ms = 4200, important = false) {
  if (!bubble) return;
  if (!important && Date.now() < holdUntil) return;
  if (important) holdUntil = Date.now() + ms;
  bubble.replaceChildren(...[content].flat(Infinity));
  bubble.classList.add('in');
  sigMood(mood, ms);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => bubble?.classList.remove('in'), ms);
}
window.addEventListener('online', () => sigMood(baseMood()));
window.addEventListener('offline', () => sigSay('You’re offline. I’ll catch up when you’re back.', 'offline', 5000));
