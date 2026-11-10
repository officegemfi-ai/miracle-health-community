// The site password for the beta: with a key kept from before, straight in; otherwise the password,
// asked once on this device. Without it the app can't reach the community at all (core/gate.js).
import { h, msgBox, say } from '../dom.js';
import { sig } from '../art.js';
import { fromB64, toB64, gateDerive, gateOpen } from '../../core/gate.js';
import { C } from '../../data/config.js';
import { gateKey, keepGateKey, forgetGateKey } from '../../data/storage.js';
import { render } from '../shell.js';

export async function unlock() {
  const g = C.gate;
  if (!g) return C.supabaseAnonKey;
  const slot = `mh_gate:${g.salt}`;
  const saved = gateKey(slot);
  if (saved) {
    const key = await gateOpen(g, fromB64(saved));
    if (key) return key;
    forgetGateKey(slot);
  }
  return askPassword(g, slot);
}

function askPassword(g, slot) {
  return new Promise((resolve) => {
    const msg = msgBox();
    const pw = h('input', { class: 'input', type: 'password', id: 'site-password', autocomplete: 'current-password', required: true });
    const go = h('button', { class: 'btn lime block', type: 'submit' }, 'Enter');
    render(h('section', { class: 'gate' }, h('div', { class: 'inner' },
      sig(88, 'watching'),
      h('div', { class: 'kick mt16' }, 'Private beta'),
      h('h1', {}, 'Almost open.'),
      h('p', { class: 'lede' }, 'The Miracle Health community is open to invited testers for now. Enter the beta password to continue.'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          go.disabled = true; say(msg, '');
          const raw = await gateDerive(g, pw.value);
          const key = await gateOpen(g, raw);
          go.disabled = false;
          if (!key) { say(msg, 'That password isn’t right.'); pw.select(); return; }
          keepGateKey(slot, toB64(raw));
          resolve(key);
        },
      }, h('label', { class: 'f', for: 'site-password' }, h('span', {}, 'Beta password'), pw), go, msg))));
    pw.focus();
  });
}
