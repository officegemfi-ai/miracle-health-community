// Reporting a post, a comment or a member to the moderators: the reason (a rule), a note, and what
// to do if someone may be at risk.
import { h, msgBox, say, modal } from '../dom.js';
import { sig } from '../art.js';
import { friendly } from '../../core/errors.js';
import { REASONS } from '../../core/posts.js';
import * as Posts from '../../data/posts.js';
import { track } from '../../data/telemetry.js';

export function openReport(kind, id) {
  const msg = msgBox();
  modal((close) => {
    const note = h('textarea', { class: 'input', maxlength: 500, rows: 3, placeholder: 'Optional: what’s wrong?' });
    const radios = REASONS.map(([v, label], i) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'reason', value: v, checked: i === 0 }), h('span', {}, label)));
    const send = h('button', { class: 'btn lime', type: 'submit' }, 'Send report');
    const box = h('form', {
      class: 'pad',
      onsubmit: async (e) => {
        e.preventDefault();
        const reason = box.querySelector('input[name=reason]:checked')?.value || 'other';
        send.disabled = true;
        const { error } = await Posts.report(kind, id, reason, note.value.trim() || null);
        send.disabled = false;
        if (error) return say(msg, friendly(error));
        track('report', { kind, reason });
        box.replaceChildren(h('div', { class: 'row nw' }, sig(56, 'support'), h('h2', {}, 'Thanks, a moderator will look')),
          reason === 'self_harm'
            ? h('p', {}, 'If someone is in danger right now, call 911. For a crisis, call or text 988 (US).')
            : h('p', { class: 'muted' }, 'They never see who reported them.'),
          h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Close')));
      },
    }, h('h2', {}, `Report this ${kind === 'member' ? 'member' : kind}`), ...radios,
    h('label', { class: 'f' }, h('span', {}, 'Details'), note),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancel'), send), msg);
    return box;
  }, { label: 'Report' });
}
