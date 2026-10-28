// Small UI kit: DOM building (text always goes in as text), icons, formatting,
// toasts, dialogs and the count-up/flash used for every live number.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

// Static SVG markup we write ourselves (never member text) becomes a node
const parser = new DOMParser();
export function svg(markup) {
  const withNs = markup.includes('xmlns=') ? markup : markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const doc = parser.parseFromString(withNs, 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}

// ---------------------------------------------------------------------------
// Icons: 24px, stroke 1.8, currentColor
// ---------------------------------------------------------------------------
const P = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  flame: '<path d="M12 21c-4 0-6.5-2.6-6.5-6.2 0-3.6 3-5.6 3.6-9.3 2.3 1.6 3.4 3.7 3.5 5.6 1-.8 1.6-2 1.7-3.2 2.4 1.8 4.2 4.4 4.2 7 0 3.6-2.6 6.1-6.5 6.1Z"/>',
  pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  comment: '<path d="M4.5 18.5V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H9z"/>',
  share: '<path d="M12 15V4M8 7.5 12 4l4 3.5"/><path d="M5 12v6.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V12"/>',
  flag: '<path d="M6 21V4M6 4.5h11l-2 4 2 4H6"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  edit: '<path d="M4.5 19.5 5.5 15 15.5 5a2 2 0 0 1 3 3l-10 10z"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6z"/>',
  book: '<path d="M5 4.5h9a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M5 16.5a3 3 0 0 1 3-3h9"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.3-3.6 4.2-5.5 7.5-5.5s6.2 1.9 7.5 5.5"/>',
  logout: '<path d="M14 4.5H6.5v15H14"/><path d="M11 12h9.5M17 8.5l3.5 3.5-3.5 3.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  up: '<path d="M12 5 5 13h4.5v6h5v-6H19z"/>',
  dn: '<path d="M12 19 5 11h4.5V5h5v6H19z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/>',
  sparkle: '<path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14l-6.7-2 6.7-2z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  same: '<path d="M7.5 12.5 11 16l7-8.5"/><path d="M3.5 12.5 7 16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  flask: '<path d="M9.5 3.5h5M10.5 3.5v5.2L5.2 18a1.6 1.6 0 0 0 1.4 2.5h10.8a1.6 1.6 0 0 0 1.4-2.5l-5.3-9.3V3.5"/><path d="M7.6 14h8.8"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
};
export function icon(name, size = 20, cls = '') {
  return svg(`<svg class="ic ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export const fmt1 = (x) => (x == null ? '–' : Number(x).toFixed(1));
export const fmtN = (x) => (x == null ? '–' : Number(x).toLocaleString('en-US'));
export const plural = (n, one, many = `${one}s`) => `${fmtN(n)} ${Number(n) === 1 ? one : many}`;
export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function friendly(error) {
  if (!error) return '';
  const m = error.message || String(error);
  if (error.code === '23505') return 'Already done.';
  if (/row-level security/i.test(m)) return 'You can’t do that right now.';
  if (/permission denied/i.test(m)) return 'You can’t do that.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'You seem to be offline. Try again in a moment.';
  // The text provider's own errors can carry account details; members get a plain message
  if (/sending (confirmation |)OTP|sms provider|twilio|error sending/i.test(m)) {
    return 'We couldn’t text a code to that number right now. Check the number, or try again in a few minutes.';
  }
  if (/token has expired or is invalid/i.test(m)) return 'That code didn’t work. Check it, or go back and ask for a new one.';
  return m;
}

// ---------------------------------------------------------------------------
// Live numbers: count from the old value to the new one, flash up or down
// ---------------------------------------------------------------------------
export function tick(el, from, to, digits = 1) {
  if (!el || to == null) return;
  const f = (x) => (digits ? Number(x).toFixed(digits) : fmtN(Math.round(x)));
  if (from == null || Number(from) === Number(to)) { el.textContent = f(to); return; }
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(Number(to) > Number(from) ? 'flash-up' : 'flash-down');
  if (reduceMotion()) { el.textContent = f(to); return; }
  const t0 = performance.now();
  const a = Number(from); const b = Number(to);
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 900);
    el.textContent = f(a + (b - a) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Messages, toasts and dialogs
// ---------------------------------------------------------------------------
export const msgBox = () => h('div', { role: 'alert', 'aria-live': 'polite' });
export function say(box, text, kind = 'err') {
  box.replaceChildren(text ? h('div', { class: `msg ${kind}` }, text) : '');
}

let toastHost = null;
export function toast(content, opts = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: `toast ${opts.kind || ''}` }, opts.art || null, h('div', { class: 'toast-t' }, content));
  if (opts.onclick) { t.classList.add('click'); t.addEventListener('click', () => { opts.onclick(); t.remove(); }); }
  toastHost.append(t);
  setTimeout(() => t.classList.add('out'), opts.ms || 3600);
  setTimeout(() => t.remove(), (opts.ms || 3600) + 400);
  return t;
}

export function modal(build, opts = {}) {
  const dlg = h('dialog', { class: `modal ${opts.cls || ''}`, 'aria-label': opts.label || 'Dialog' });
  const close = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener('close', () => { dlg.remove(); opts.onclose?.(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && !opts.sticky) close(); });
  dlg.append(build(close));
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close };
}

export function confirmBox(text, yes = 'Delete') {
  return new Promise((resolve) => {
    let answer = false;
    modal((close) => h('div', { class: 'pad' },
      h('p', {}, text),
      h('div', { class: 'row end mt16' },
        h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancel'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => { answer = true; close(); } }, yes))),
    { label: 'Confirm', onclose: () => resolve(answer) });
  });
}

export function bar(pct, cls = '') {
  const i = h('i', {});
  i.style.width = `${Math.max(0, Math.min(100, Number(pct) || 0))}%`;
  return h('div', { class: `bar ${cls}`.trim() }, i);
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) { return false; }
}
