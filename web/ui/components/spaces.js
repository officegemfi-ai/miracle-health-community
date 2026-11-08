// A space's pieces: joining it, the chips for what's in a blend or stack, its evidence grade from
// the Library, and the question it starts Sig with.
import { h, toast } from '../dom.js';
import { spaceTile } from '../art.js';
import { friendly } from '../../core/errors.js';
import { gradeOf } from '../../data/library.js';
import { track } from '../../data/telemetry.js';
import { S, spaceOf } from '../../app/store.js';
import { loadSpaces, toggleMembership } from '../../app/session.js';
import { renderNav, sigSay } from '../shell.js';
import { afterEarn } from './game.js';
import { askAboutCompound, meterHtml, node } from '../../kit/kit.js';

export function joinButton(sp, cls = '') {
  const b = h('button', { class: `btn ${sp.joined ? 'ghost' : 'lime'} sm join ${cls}`, type: 'button', 'aria-pressed': String(!!sp.joined) }, sp.joined ? 'Joined' : 'Join');
  b.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    b.disabled = true;
    const res = await toggleMembership(sp);
    b.disabled = false;
    if (res.error) { toast(friendly(res.error)); return; }
    b.textContent = sp.joined ? 'Joined' : 'Join';
    b.className = `btn ${sp.joined ? 'ghost' : 'lime'} sm join ${cls}`;
    b.setAttribute('aria-pressed', String(sp.joined));
    await loadSpaces();
    renderNav(document.querySelector('.nav-i[aria-current=page]')?.dataset.nav || '', sp.compound_id);
    if (sp.joined) {
      sigSay(['You joined ', h('b', {}, `s/${sp.name}`), '. Its posts show up on your Home feed now.'], 'happy', 3600);
      afterEarn(b);
    }
    track('space', { joined: sp.joined });
  });
  return b;
}

// Chips linking to what's in a blend or stack
export function partChips(sp, label) {
  const parts = (sp?.part_ids || []).map(spaceOf).filter(Boolean);
  if (!parts.length) return null;
  return h('div', { class: 'post-chips parts' }, label ? h('span', { class: 'kick' }, label) : null,
    parts.map((p) => h('a', { class: 'chip part', href: `#/s/${encodeURIComponent(p.compound_id)}` }, spaceTile(p, 16), p.name)));
}

// The public library, with a fact sheet for every compound and blend in the community's
export const LIBRARY = 'https://miraclehealth.us/library/';

// The question a space starts Sig with (typed in for them, never sent)
export const askAbout = (sp) => (sp.kind === 'stack'
  ? `I'm thinking about this stack: ${(sp.part_ids || []).map((id) => S.spaces.find((s) => s.compound_id === id)?.name || id).join(', ')}. What may it do for me, and how do they fit together?`
  : askAboutCompound(sp.name));

// The Library's grade for a compound, as the evidence meter (nothing when it has none)
export async function evidenceTag(cid) {
  const grade = await gradeOf(cid);
  return grade ? node(meterHtml(grade, { words: true })) : null;
}
