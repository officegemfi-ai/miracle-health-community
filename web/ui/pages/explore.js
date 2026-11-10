// Explore spaces: every compound, blend and stack by family and category, or found by what you type.
import { h, icon } from '../dom.js';
import { sig, spaceTile } from '../art.js';
import { fmtN, fmt1, plural } from '../../core/format.js';
import { FAMILIES, isStack, searchLibrary } from '../../core/library.js';
import { S, spaceOf, signalOf } from '../../app/store.js';
import { render, setRail } from '../shell.js';
import { railCards } from '../rail.js';
import { movement } from '../components/signal.js';
import { joinButton } from '../components/spaces.js';
import { suggestCompound } from '../components/picker.js';

export async function renderExplore(family = '') {
  const filter = h('input', { class: 'input', type: 'search', placeholder: 'Find anything: a name, a brand, what it’s for', 'aria-label': 'Find in the library' });
  const box = h('div', {});
  const lib = S.spaces.filter((s) => !isStack(s));
  const stacks = S.spaces.filter(isStack);
  const counts = Object.fromEntries(FAMILIES.map((f) => [f, S.spaces.filter((s) => s.family === f).length]));
  const tabs = h('nav', { class: 'tabs fam', 'aria-label': 'Families' },
    [['', 'All', S.spaces.length], ...FAMILIES.map((f) => [f, f, counts[f]])].map(([k, l, n]) =>
      h('a', { href: `#/explore${k ? `?f=${encodeURIComponent(k)}` : ''}`, 'aria-current': family === k ? 'page' : null }, l, h('span', { class: 'n' }, fmtN(n)))));
  const card = (s) => h('a', { class: 'card space-card', href: `#/s/${encodeURIComponent(s.compound_id)}` },
    h('div', { class: 'top' }, spaceTile(s, 36), h('b', { class: 'grow' }, s.name)),
    isStack(s) || s.kind === 'blend' ? h('div', { class: 'xs muted' }, (s.part_ids || []).map((id) => spaceOf(id)?.name || id).join(' · ')) : null,
    h('div', { class: 'row between' }, s.score != null ? h('span', { class: 'sc num', 'data-sig-of': s.compound_id }, fmt1(s.score)) : h('span', { class: 'kick' }, 'No Signal yet'), s.score != null ? movement(signalOf(s.compound_id)) : null),
    h('div', { class: 'meta' }, h('span', {}, `${plural(s.members_count, 'member')} · ${plural(s.reports, 'report')}`), joinButton(s)));
  const suggest = h('p', { class: 'small muted mt16' }, 'Missing something? ', h('button', { class: 'lnk', type: 'button', onclick: () => suggestCompound(filter.value.trim()) }, 'Suggest it for the library'), '.');
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, `${fmtN(lib.length)} in the library · ${plural(stacks.length, 'stack')}`), h('h1', {}, 'Explore spaces.')),
      h('p', { class: 'cap' }, 'One space per compound, blend and stack. Join the ones you care about.')),
    h('div', { class: 'row nw explore-bar' }, filter, h('a', { class: 'btn ink sm', href: '#/stack' }, icon('layers', 16), 'Find your stack')),
    tabs, box, suggest);
  const draw = () => {
    const q = filter.value.trim();
    if (q) {
      const hits = searchLibrary(S.spaces, q, { kinds: ['compound', 'blend', 'stack'], limit: 0, family });
      box.replaceChildren(hits.length ? h('div', { class: 'space-grid mt12' }, hits.slice(0, 60).map((r) => card(r.sp)))
        : h('div', { class: 'empty card mt12' }, sig(72, 'curious'), h('p', {}, `Nothing called “${q}” yet.`),
          h('button', { class: 'btn lime sm', type: 'button', onclick: () => suggestCompound(q) }, 'Suggest it for the library')));
      return;
    }
    const groups = {};
    S.spaces.filter((s) => !family || s.family === family).forEach((s) => { (groups[isStack(s) ? 'Stacks' : s.category] ||= []).push(s); });
    const order = Object.keys(groups).sort((a, b) => (a === 'Stacks') - (b === 'Stacks') || a.localeCompare(b));
    box.replaceChildren(...order.map((cat) => [
      h('div', { class: 'kick cat-h' }, `${cat} · ${groups[cat].length}`),
      h('div', { class: 'space-grid' }, groups[cat].sort((a, b) => ((b.reports || 0) - (a.reports || 0)) || ((b.score ?? -1) - (a.score ?? -1)) || a.name.localeCompare(b.name)).map(card))]).flat());
  };
  let t = null;
  filter.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 120); });
  draw();
  setRail(await railCards('explore'));
}
