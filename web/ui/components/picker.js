// Picking what you took: type to search the library (by name, brand name or nickname), pick one or
// several (several make a stack), a sentence on what the post will do, and suggesting something the
// library is missing.
import { h, icon, msgBox, say, modal } from '../dom.js';
import { sig, spaceTile } from '../art.js';
import { fmt1, plural } from '../../core/format.js';
import { friendly } from '../../core/errors.js';
import { MAX_PICKS, searchLibrary, popularEntries, familyLabel, findStack, stackName } from '../../core/library.js';
import * as Library from '../../data/library.js';
import { track } from '../../data/telemetry.js';
import { S, spaceOf } from '../../app/store.js';

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
    const results = q ? searchLibrary(S.spaces, q, { limit: 12 }) : popularEntries(S.spaces, 8).map((sp) => ({ sp, via: null }));
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
  const st = findStack(S.spaces, ids);
  return [icon('layers', 16), ' A stack. Posts to ', h('b', {}, `s/${stackName(S.spaces, ids)}`),
    st ? ` (${plural(st.reports || 0, 'report')} so far).` : '. You’re the first to post this exact stack, so you start its space.',
    ' A stack gets its own Signal, from reports of exactly that stack.'];
}

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
        const { error } = await Library.request(name.value.trim(), note.value.trim() || null);
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
