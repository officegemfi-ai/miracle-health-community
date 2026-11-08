// The frame around every page: the left menu (never removed; a drawer on phones), the top bar, the
// phone tab bar, search, the footer, and Sig in the corner. Pages draw into it with render() and
// setRail(); the rail's cards are chosen in ui/rail.js.
import { h, icon, bar } from './dom.js';
import { sig, emblem, spaceTile } from './art.js';
import { fmtN, fmt1 } from '../core/format.js';
import { searchLibrary, familyLabel } from '../core/library.js';
import { seasonPct } from '../core/game.js';
import { C } from '../data/config.js';
import * as Posts from '../data/posts.js';
import * as Members from '../data/members.js';
import { S, isMod, levelOf, claimable } from '../app/store.js';
import { bellButton } from './components/notifications.js';
import { placeHref } from '../kit/kit.js';

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

// The left menu
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
    // The rest of Miracle Health, the same places as the bar at the top of every page
    h('div', { class: 'nav-sec' }, h('span', { class: 'kick' }, 'Miracle Health')),
    h('a', { class: 'nav-i', href: placeHref('library') }, icon('flask', 20), 'The Library'),
    h('a', { class: 'nav-i', href: placeHref('ai') }, icon('sparkle', 20), 'Ask Sig'),
    h('a', { class: 'nav-i', href: placeHref('my') }, icon('layers', 20), 'My Miracle'),
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
  const pct = seasonPct(p);
  return h('a', { class: 'season-mini', href: '#/quests' },
    h('span', { class: 'kick' }, p.season_name),
    h('b', {}, `${fmtN(p.season_reports)} of ${fmtN(p.season_goal)} first-hand reports`),
    bar(pct), h('div', { class: 'xs' }, 'Every report gets the whole community closer.'));
}

// The top bar, the phone tabs and search
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
    const spaces = searchLibrary(S.spaces, q, { kinds: ['compound', 'blend', 'stack'], limit: 5 });
    const [posts, people] = await Promise.all([Posts.find(like), Members.find(like)]);
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

// The footer: the rules' own line, and how to reach the moderators when the build gives an address
export function renderFooter() {
  const foot = document.getElementById('foot-text');
  if (S.rules?.footer) foot.textContent = S.rules.footer;
  if (C.contactEmail) foot.append(' Contact the moderators: ', h('a', { href: `mailto:${C.contactEmail}` }, C.contactEmail));
}

// The phone drawer for the left menu
const burger = document.getElementById('burger');
let scrim = null;
export function closeDrawer() {
  document.body.classList.remove('drawer');
  burger?.setAttribute('aria-expanded', 'false');
  scrim?.remove(); scrim = null;
}

// Sig, in the corner: tips, reactions and news
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

// The frame's own listeners: the phone drawer, and Sig noticing the connection drop or come back
export function mountShell() {
  burger?.addEventListener('click', () => {
    const open = !document.body.classList.contains('drawer');
    if (!open) return closeDrawer();
    document.body.classList.add('drawer');
    burger.setAttribute('aria-expanded', 'true');
    scrim = h('div', { class: 'scrim', onclick: closeDrawer });
    document.body.append(scrim);
  });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) closeDrawer(); });
  window.addEventListener('online', () => sigMood(baseMood()));
  window.addEventListener('offline', () => sigSay('You’re offline. I’ll catch up when you’re back.', 'offline', 5000));
}
