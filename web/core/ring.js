// Sig's ring as markup: the mark in the browser tab and on Ask Sig, drawn the way the website's
// lib/ring.js draws it. The eleven who gather what's known, each in its own colour, round the ring
// from the Safety agent's coral to the Stack builder's pink, and at its centre the Interpretation
// agent's white dot (rings 30 pixels across or more). A mark beside words, so screen readers skip it.
// A string from numbers only, so the build can draw it into the page too (scripts/write_config.mjs).

const WHEEL = ['#FF6B5B', '#FF9F4A', '#F2C94C', '#3D8BFF', '#5FE08A', '#3FE0C5', '#55D3FF', '#6FA8FE', '#8F95FF', '#B98CFF', '#FF7FC8'];

export function ringMarkup(size = 56, cls = '') {
  const sw = Math.max(2.4, size * 0.17);
  const gap = size > 60 ? 4.5 : 9;
  const r = size / 2 - sw / 2 - 0.5;
  const c = 2 * Math.PI * r;
  const g = (gap / 360) * c;
  const n = (x) => Number(x.toFixed(2));
  const arcs = WHEEL.map((col, i) => `<circle r="${n(r)}" fill="none" stroke="${col}" stroke-width="${n(sw)}" stroke-dasharray="${n(c / 11 - g)} ${n(c)}" transform="rotate(${n(-90 + (i * 360) / 11 + gap / 2)})"/>`).join('');
  const dot = size >= 30 ? `<circle r="${n(Math.max(2.5, size * 0.033))}" fill="#F7F8FA"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ring${cls ? ` ${cls}` : ''}" width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}" aria-hidden="true" focusable="false">${arcs}${dot}</svg>`;
}
