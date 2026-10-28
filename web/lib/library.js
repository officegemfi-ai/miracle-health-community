// The library: every peptide, hormone, supplement, medication and blend a post
// can name, searchable by name, brand name or nickname. Picking several makes a
// stack. Also: the search-as-you-type picker, "Find your stack", and suggesting
// something the library is missing.
import { h, icon, fmt1, friendly, msgBox, say, modal, plural } from './ui.js';
import { sig, spaceTile } from './art.js';
import { S, sb, spaceOf, signalOf, track } from './state.js';
import { render, setRail, railCards } from './shell.js';
import { sigNum, movement } from './signal.js';

export const FAMILIES = ['Peptides', 'Hormones', 'Supplements', 'Medications', 'Blends', 'Stacks'];
export const CATEGORIES = [
  'Metabolic & weight', 'Growth-hormone axis', 'Healing & recovery', 'Gut & digestion', 'Immune & inflammation',
  'Cognition & focus', 'Mood & stress', 'Sleep', 'Sexual health', 'Skin & hair', 'Longevity', 'Hormone balance',
  'Muscle & performance', 'Heart & circulation', 'Energy & mitochondria', 'Vitamins & minerals', 'Liver & detox', 'Joints & bones',
];
export const MAX_PICKS = 8;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const squash = (s) => fold(s).replace(/[^a-z0-9]/g, '');
const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

// How well one entry matches what was typed: the name beats an alias, a whole
// match beats a start, a start beats a word inside, and that beats anything else.
function matchOf(sp, q) {
  const qs = squash(q);
  if (!qs) return null;
  let best = null;
  const tryText = (text, isName) => {
    const t = squash(text);
    if (!t) return;
    let s = 0;
    if (t === qs) s = 100;
    else if (t.startsWith(qs)) s = 80;
    else if (words(text).some((w) => w.startsWith(qs))) s = 60;
    else if (qs.length >= 3 && t.includes(qs)) s = 40;
    if (!s) return;
    if (!isName) s -= 8;
    if (!best || s > best.score) best = { score: s, via: isName ? null : text };
  };
  tryText(sp.name, true);
  (sp.aliases || []).forEach((a) => tryText(a, false));
  if (!best && qs.length >= 3 && squash(sp.category).includes(qs)) best = { score: 10, via: null };
  return best;
}

const activity = (sp) => (Number(sp.reports) || 0) * 3 + (Number(sp.members_count) || 0) + (Number(sp.posts_week) || 0);

// Entries matching q, best first. kinds: which of compound, blend, stack to include.
export function searchLibrary(q, { kinds = ['compound', 'blend'], limit = 12, family = '' } = {}) {
  const out = [];
  for (const sp of S.spaces) {
    if (!kinds.includes(sp.kind || 'compound')) continue;
    if (family && sp.family !== family) continue;
    const m = matchOf(sp, q);
    if (m) out.push({ sp, ...m });
  }
  out.sort((a, b) => (b.score - a.score) || (activity(b.sp) - activity(a.sp)) || a.sp.name.localeCompare(b.sp.name));
  return limit ? out.slice(0, limit) : out;
}

export function popularEntries(n = 8) {
  return S.spaces.filter((s) => s.kind !== 'stack')
    .sort((a, b) => (activity(b) - activity(a)) || ((b.score ?? -1) - (a.score ?? -1)) || a.name.localeCompare(b.name))
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Stacks
// ---------------------------------------------------------------------------
export const isStack = (sp) => sp?.kind === 'stack';
export const familyLabel = (sp) => (sp?.kind === 'stack' ? 'Stack' : sp?.kind === 'blend' ? 'Blend' : (sp?.family || '').replace(/s$/, ''));
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// The name the database gives a stack: its compounds' names, A to Z, joined with " + "
export function stackName(ids) {
  return ids.map((id) => spaceOf(id)?.name || id).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join(' + ');
}
export function findStack(ids) {
  const want = [...new Set(ids)];
  return S.spaces.find((s) => isStack(s) && sameSet(s.part_ids || [], want)) || null;
}
// What's in an entry, with any blend inside a stack opened up
export function allParts(sp) {
  const out = new Set();
  (sp?.part_ids || []).forEach((id) => {
    out.add(id);
    (spaceOf(id)?.part_ids || []).forEach((x) => out.add(x));
  });
  return out;
}
// Blends and stacks that contain every one of ids (not counting the exact stack)
export function containing(ids) {
  return S.spaces.filter((s) => (s.kind === 'blend' || isStack(s)) && !ids.includes(s.compound_id))
    .filter((s) => { const parts = allParts(s); return ids.every((i) => parts.has(i)); })
    .filter((s) => !(isStack(s) && sameSet(s.part_ids || [], ids)))
    .sort((a, b) => (activity(b) - activity(a)) || ((b.score ?? -1) - (a.score ?? -1)));
}
// Which compounds a link like #/new?c=... or #/stack?c=... means
export function idsFrom(param) {
  const ids = String(param || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (ids.length === 1 && isStack(spaceOf(ids[0]))) return [...(spaceOf(ids[0]).part_ids || [])];
  return [...new Set(ids)].filter((id) => spaceOf(id) && !isStack(spaceOf(id))).slice(0, MAX_PICKS);
}

// Chips linking to what's in a blend or stack
export function partChips(sp, label) {
  const parts = (sp?.part_ids || []).map(spaceOf).filter(Boolean);
  if (!parts.length) return null;
  return h('div', { class: 'post-chips parts' }, label ? h('span', { class: 'kick' }, label) : null,
    parts.map((p) => h('a', { class: 'chip part', href: `#/s/${encodeURIComponent(p.compound_id)}` }, spaceTile(p, 16), p.name)));
}

// ---------------------------------------------------------------------------
// The picker: type to search, pick one or several
// ---------------------------------------------------------------------------
let pickerN = 0;
export function compoundPicker({ selected = [], onChange = () => {}, placeholder, id = 'compound', max = MAX_PICKS } = {}) {
  const uid = `cp${++pickerN}`;
  let picks = [...selected];
  let options = [];
  let active = -1;
  const chips = h('span', { class: 'cpick-chips' });
  const input = h('input', {
    id, class: 'cpick-in', type: 'text', autocomplete: 'off', spellcheck: 'false',
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': `${uid}-list`, 'aria-autocomplete': 'list',
    placeholder: placeholder || 'Search peptides, hormones, supplements…',
  });
  const list = h('div', { class: 'cpick-pop hide', role: 'listbox', id: `${uid}-list`, 'aria-label': 'Matches' });
  const box = h('div', { class: 'cpick-box input', onclick: () => input.focus() }, chips, input);
  const wrap = h('div', { class: 'cpick' }, box, list);

  const emit = () => { onChange([...picks]); };
  const drawChips = () => {
    chips.replaceChildren(...picks.map((cid) => {
      const sp = spaceOf(cid) || { name: cid };
      return h('span', { class: 'cchip' }, spaceTile(sp, 18), h('span', {}, sp.name),
        h('button', { type: 'button', 'aria-label': `Remove ${sp.name}`, onclick: (e) => { e.stopPropagation(); remove(cid); } }, icon('x', 14)));
    }));
    const full = picks.length >= max;
    input.disabled = full;
    input.placeholder = full ? `Up to ${max}` : picks.length ? 'Add another, if you took it too' : (placeholder || 'Search peptides, hormones, supplements…');
  };
  const close = () => { list.classList.add('hide'); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const add = (cid) => {
    if (!picks.includes(cid) && picks.length < max) picks.push(cid);
    input.value = '';
    drawChips(); close(); emit();
    input.focus();
  };
  const remove = (cid) => { picks = picks.filter((x) => x !== cid); drawChips(); emit(); input.focus(); };
  const setActive = (i) => {
    const opts = list.querySelectorAll('[role=option]');
    opts.forEach((o, j) => o.classList.toggle('on', j === i));
    active = i;
    if (opts[i]) { input.setAttribute('aria-activedescendant', opts[i].id); opts[i].scrollIntoView({ block: 'nearest' }); }
  };
  const open = () => {
    const q = input.value.trim();
    const results = q ? searchLibrary(q, { limit: 12 }) : popularEntries(8).map((sp) => ({ sp, via: null }));
    options = results.filter((r) => !picks.includes(r.sp.compound_id));
    list.replaceChildren(...[
      !q ? h('div', { class: 'kick cpick-h' }, 'Popular') : null,
      ...options.map((r, i) => h('div', {
        class: 'cpick-opt', role: 'option', id: `${uid}-o${i}`, 'aria-selected': 'false',
        onmousedown: (e) => e.preventDefault(), onclick: () => add(r.sp.compound_id),
      }, spaceTile(r.sp, 28),
      h('span', { class: 'grow' }, h('b', {}, r.sp.name),
        h('span', { class: 'xs muted' }, [familyLabel(r.sp), r.sp.category, r.via ? `“${r.via}”` : null].filter(Boolean).join(' · '))),
      r.sp.score != null ? h('span', { class: 'xs mono' }, fmt1(r.sp.score)) : null)),
      q && !options.length ? h('div', { class: 'cpick-none' }, h('p', {}, `Nothing called “${q}” in the library yet.`),
        h('button', { class: 'btn sm', type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => { close(); suggestCompound(q); } }, icon('plus', 15), 'Suggest it')) : null,
    ].filter(Boolean));
    list.classList.toggle('hide', !list.childElementCount);
    input.setAttribute('aria-expanded', String(!list.classList.contains('hide')));
    if (options.length) setActive(q ? 0 : -1);
  };
  input.addEventListener('input', open);
  input.addEventListener('focus', open);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.classList.contains('hide')) open(); setActive(Math.min(active + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter') { if (!list.classList.contains('hide') && options[active]) { e.preventDefault(); add(options[active].sp.compound_id); } else if (input.value.trim()) e.preventDefault(); }
    else if (e.key === 'Escape') { close(); }
    else if (e.key === 'Backspace' && !input.value && picks.length) { remove(picks[picks.length - 1]); }
  });
  drawChips();
  Object.defineProperty(wrap, 'value', { get: () => [...picks] });
  wrap.set = (ids) => { picks = [...ids]; drawChips(); emit(); };
  return wrap;
}

// What a post with these picks will do, in a sentence
export function picksNote(ids) {
  if (!ids.length) return ['Pick what you took. Took several together? Pick them all: that’s a stack.'];
  if (ids.length === 1) {
    const sp = spaceOf(ids[0]);
    return ['Posts to ', h('b', {}, `s/${sp?.name || ids[0]}`), sp?.kind === 'blend' ? ', the blend, and feeds its Signal.' : ' and feeds its Signal.'];
  }
  const st = findStack(ids);
  return [icon('layers', 16), ' A stack. Posts to ', h('b', {}, `s/${stackName(ids)}`),
    st ? ` (${plural(st.reports || 0, 'report')} so far).` : '. You’re the first to post this exact stack, so you start its space.',
    ' A stack gets its own Signal, from reports of exactly that stack.'];
}

// ---------------------------------------------------------------------------
// Suggesting something the library is missing
// ---------------------------------------------------------------------------
export function suggestCompound(prefill = '') {
  const msg = msgBox();
  modal((close) => {
    const name = h('input', { class: 'input', maxlength: 80, required: true, value: prefill, placeholder: 'e.g. BPC-157 nasal spray' });
    const note = h('textarea', { class: 'input', maxlength: 300, rows: 3, placeholder: 'Optional: what it is, other names for it' });
    const send = h('button', { class: 'btn lime', type: 'submit' }, 'Suggest it');
    const form = h('form', {
      class: 'pad',
      onsubmit: async (e) => {
        e.preventDefault();
        send.disabled = true;
        const { error } = await sb.from('compound_requests').insert({ name: name.value.trim(), note: note.value.trim() || null });
        send.disabled = false;
        if (error) return say(msg, friendly(error));
        track('library_suggest');
        form.replaceChildren(h('div', { class: 'row nw' }, sig(56, 'happy'), h('h2', {}, 'Thanks, a moderator will add it')),
          h('p', { class: 'muted' }, 'You’ll get a note when it’s in the library.'),
          h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Close')));
      },
    }, h('h2', {}, 'Suggest for the library'),
    h('p', { class: 'muted small' }, 'Peptides, hormones, supplements, blends and the medications people take with them. No shops or sellers.'),
    h('label', { class: 'f' }, h('span', {}, 'Name'), name),
    h('label', { class: 'f' }, h('span', {}, 'Details'), note),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancel'), send), msg);
    setTimeout(() => name.focus(), 50);
    return form;
  }, { label: 'Suggest for the library' });
}

// ---------------------------------------------------------------------------
// Find your stack
// ---------------------------------------------------------------------------
function entryRow(sp, extra) {
  const x = signalOf(sp.compound_id);
  return h('a', { class: 'card lib-row', href: `#/s/${encodeURIComponent(sp.compound_id)}` },
    spaceTile(sp, 34),
    h('span', { class: 'grow' }, h('b', {}, sp.name),
      h('span', { class: 'xs muted' }, [familyLabel(sp), plural(sp.reports || 0, 'report'), plural(sp.members_count || 0, 'member')].join(' · '))),
    extra || null,
    x && x.score != null ? h('span', { class: 'sc num', 'data-sig-of': sp.compound_id }, fmt1(x.score)) : h('span', { class: 'kick' }, 'No Signal yet'),
    x && x.score != null ? movement(x) : null);
}

export async function renderStack(param = '', sort = 'new') {
  const { postCard, sortbar, feedQuery, fillFeed } = await import('./feed.js');
  let ids = idsFrom(param);
  const results = h('div', {});
  const list = h('div', {});
  const picker = compoundPicker({
    selected: ids, id: 'stack-search', placeholder: 'Add what you take: BPC-157, Ozempic, creatine…',
    onChange: (next) => {
      ids = next;
      history.replaceState(null, '', ids.length ? `#/stack?c=${ids.map(encodeURIComponent).join(',')}${sort !== 'new' ? `&sort=${sort}` : ''}` : '#/stack');
      draw();
    },
  });
  const draw = async () => {
    if (!ids.length) {
      results.replaceChildren(h('div', { class: 'empty card' }, sig(72, 'curious'),
        h('p', {}, 'Add the compounds you take. You’ll see that exact stack’s Signal, every stack and blend with them in it, and how each one does on its own.')));
      list.replaceChildren();
      return;
    }
    const picked = ids.map(spaceOf).filter(Boolean);
    const exact = ids.length === 1 ? picked[0] : findStack(ids);
    const share = `#/new?c=${ids.map(encodeURIComponent).join(',')}`;
    const xs = exact ? signalOf(exact.compound_id) : null;
    const top = h('section', { class: 'card stack-hit' },
      h('div', { class: 'kick' }, ids.length === 1 ? 'On its own' : 'This exact stack'),
      exact
        ? h('div', { class: 'row nw mt8' }, spaceTile(exact, 44),
          h('div', { class: 'grow' }, h('h2', {}, exact.name), h('div', { class: 'xs muted' }, `${plural(exact.reports || 0, 'first-hand report')} · ${plural(exact.members_count || 0, 'member')}`)),
          xs && xs.score != null ? h('div', { class: 'big-sc' }, sigNum(exact.compound_id), h('span', { class: 'kick' }, 'Signal'))
            : h('div', { class: 'xs muted right' }, `${Math.max(0, 3 - (exact.reports || 0))} more report${3 - (exact.reports || 0) === 1 ? '' : 's'} unlock its Signal`))
        : h('div', { class: 'mt8' }, h('h2', {}, stackName(ids)), h('p', { class: 'muted' }, 'Nobody has posted this exact stack yet. Be the first: your report starts its space and, with two more, its own Signal.')),
      h('div', { class: 'row mt12' },
        exact ? h('a', { class: 'btn sm', href: `#/s/${encodeURIComponent(exact.compound_id)}` }, ids.length === 1 ? 'Open its space' : 'Open the stack') : null,
        h('a', { class: 'btn lime sm', href: share }, icon('plus', 16), ids.length === 1 ? 'Share how it went' : 'Share how this stack went')));
    const others = containing(ids);
    results.replaceChildren(...[top,
      others.length ? h('section', { class: 'mt16' }, h('div', { class: 'kick cat-h' }, `Stacks and blends with ${ids.length === 1 ? 'it' : 'all of them'} in it · ${others.length}`),
        h('div', { class: 'lib-list' }, others.slice(0, 12).map((sp) => entryRow(sp)))) : null,
      ids.length > 1 ? h('section', { class: 'mt16' }, h('div', { class: 'kick cat-h' }, 'Each one on its own'),
        h('div', { class: 'lib-list' }, picked.map((sp) => entryRow(sp)))) : null,
      h('div', { class: 'kick cat-h mt16' }, `Posts with ${ids.length === 1 ? 'it' : 'all of them'}`),
      sortbar(`#/stack?c=${ids.map(encodeURIComponent).join(',')}`, sort)].filter(Boolean));
    await fillFeed(list, feedQuery(sort).contains('part_ids', ids), h('div', { class: 'empty card' }, sig(72, 'curious'),
      h('p', {}, 'No posts with these yet.'), h('a', { class: 'btn lime sm', href: share }, 'Be the first')));
  };
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, '// Find your stack'), h('h1', {}, 'Search the stack you run.')),
      h('p', { class: 'cap' }, 'Peptides, hormones, supplements and blends: add yours, see what people report.')),
    h('div', { class: 'card' }, h('label', { class: 'f nm', for: 'stack-search' }, h('span', {}, 'What you take'), picker),
      h('p', { class: 'xs muted' }, 'Can’t find something? ', h('button', { class: 'lnk', type: 'button', onclick: () => suggestCompound() }, 'Suggest it for the library'), '.')),
    results, list);
  setRail(await railCards('explore'));
  track('stack_search', { n: ids.length });
  await draw();
}

