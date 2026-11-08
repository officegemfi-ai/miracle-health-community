// Onboarding, with Sig: who Sig is, picking the spaces for what you've taken, and how points and
// emblems work. Shown once, right after joining.
import { h, toast, modal } from '../dom.js';
import { sig, emblem, spaceTile } from '../art.js';
import { fmt1 } from '../../core/format.js';
import { friendly } from '../../core/errors.js';
import * as Spaces from '../../data/spaces.js';
import { S } from '../../app/store.js';
import { loadSpaces } from '../../app/session.js';
import { sigSay } from '../shell.js';
import { refreshQuests } from '../components/game.js';

export function onboarding() {
  let step = 0;
  let shareNext = false;
  const picks = new Set(S.spaces.filter((s) => s.joined).map((s) => s.compound_id));
  const popular = [...S.spaces].sort((a, b) => (b.members_count - a.members_count) || ((b.score ?? 0) - (a.score ?? 0))).slice(0, 16);
  const dots = () => h('div', { class: 'step-dots' }, [0, 1, 2].map((i) => h('i', { class: i === step ? 'on' : '' })));
  const finish = async () => {
    const at = location.hash;
    await loadSpaces();
    await refreshQuests();
    // Someone who has already moved on (opened a post, started one) stays where they are, and so
    // does someone who came for a page (a space from the Library, a draft from their plan)
    if (location.hash !== at) return;
    if (at && !/^#\/?(?:home)?$/.test(at)) return;
    // "Share how it went": straight to a report on what they picked
    // (one pick fills it in; several could be a stack or separate reports, so they choose)
    if (shareNext) { location.hash = picks.size === 1 ? `#/new?c=${encodeURIComponent([...picks][0])}` : '#/new'; return; }
    if (at === '#/home') window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = '#/home';
  };
  const { dlg, close } = modal(() => h('div', { class: 'onboard pad' }), { label: 'Welcome', sticky: true, onclose: finish });
  const box = dlg.firstChild;
  const draw = () => {
    if (step === 0) {
      box.replaceChildren(
        h('div', { class: 'row nw' }, sig(88, 'happy'), h('div', {}, h('div', { class: 'kick' }, 'Welcome'), h('h2', {}, 'Hi, I’m Sig.'))),
        h('p', {}, 'I’m the Community Signal in person: one number per compound, built from what people report happened to them. Every report, every “same for me” and every vote here makes me sharper.'),
        h('p', { class: 'small' }, 'I’m also Miracle Health’s AI. I read each report into the Signal (you check my read with a tap), and at Ask Sig on miraclehealth.us I answer questions from the studies and from what people report.'),
        h('p', { class: 'small muted' }, 'Experiences, not medical advice. Nobody here tells anyone what to take.'),
        h('div', { class: 'row end mt16' }, h('button', { class: 'btn lime', type: 'button', onclick: () => { step = 1; draw(); } }, 'Show me around')), dots());
    } else if (step === 1) {
      const grid = h('div', { class: 'pick-grid' }, popular.map((s) => {
        const b = h('button', { class: 'pick', type: 'button', 'aria-pressed': String(picks.has(s.compound_id)) },
          spaceTile(s, 30), h('span', { class: 'grow' }, h('b', {}, s.name), h('span', { class: 'm' }, `${s.category}${s.score != null ? ` · ${fmt1(s.score)}` : ''}`)));
        b.addEventListener('click', async () => {
          const on = picks.has(s.compound_id);
          b.disabled = true;
          const res = on ? await Spaces.leave(s.compound_id) : await Spaces.join(s.compound_id);
          b.disabled = false;
          if (res.error) { toast(friendly(res.error)); return; }
          if (on) picks.delete(s.compound_id); else picks.add(s.compound_id);
          b.setAttribute('aria-pressed', String(!on));
          count.textContent = `${picks.size} joined`;
          if (picks.size === 3 && !on) sigSay('Three spaces: your first quest is done. Claim it when we’re through.', 'cheer', 3500);
        });
        return b;
      }));
      const count = h('span', { class: 'kick' }, `${picks.size} joined`);
      box.replaceChildren(
        h('div', { class: 'row nw' }, sig(56, 'curious'), h('div', {}, h('div', { class: 'kick' }, 'Step 2 of 3'), h('h2', {}, 'What have you taken?'))),
        h('p', { class: 'small' }, 'Pick what you’ve taken, and you can tell everyone how it went next. Haven’t taken anything yet? Pick what you’re curious about. Each one is a space, like s/BPC-157: join three and your Home feed fills up (and you finish your first quest).'),
        grid,
        h('div', { class: 'row between mt16' }, count, h('button', { class: 'btn lime', type: 'button', onclick: async () => { await loadSpaces(); step = 2; draw(); } }, 'Next')), dots());
    } else {
      box.replaceChildren(
        h('div', { class: 'row nw' }, sig(56, 'cheer'), h('div', {}, h('div', { class: 'kick' }, 'Step 3 of 3'), h('h2', {}, 'Earn your emblems.'))),
        h('p', { class: 'small' }, 'Points go to taking part, never to results: a report that says “it didn’t work” earns the same as one that says it did. Fifteen emblems, from Spark to Organism.'),
        h('div', { class: 'row', style: null }, S.levels.slice(0, 15).map((l) => emblem(l.n, 34, l.n > 1, l.name))),
        h('div', { class: 'stack mt16 small' },
          h('div', {}, h('b', {}, '+40'), ' a first-hand report that feeds the Signal'),
          h('div', {}, h('b', {}, '+5'), ' each “same for me”, given or received'),
          h('div', {}, h('b', {}, '+5'), ' your first contribution each day, and your streak grows')),
        h('div', { class: 'row end mt16' },
          h('button', { class: `btn ${picks.size ? 'ghost' : 'lime'}`, type: 'button', onclick: close }, 'Let’s go'),
          picks.size ? h('button', { class: 'btn lime', type: 'button', onclick: () => { shareNext = true; close(); } }, 'Share how it went') : null), dots());
    }
  };
  draw();
}
