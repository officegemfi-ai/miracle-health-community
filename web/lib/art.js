// The community's art, drawn in code: Sig (the Community Signal in person) in
// every mood, the fifteen emblems from Spark to Organism, Sig stickers, space
// tiles and sparklines. Sig and the tiles come from Miracle Health's design kit
// (web/kit, copied from shared/kit), so the website draws the same ones.
import { svg } from './ui.js';
import { sigSvg, tileSvg, catColor, initials } from '../kit/kit.js';

let uid = 0;
const nextId = (p) => `${p}${++uid}`;

// ---------------------------------------------------------------------------
// Sig, from Miracle Health's design kit (the website draws the same Sig)
// ---------------------------------------------------------------------------
export function sig(size = 56, mood = 'idle', cls = '') {
  return svg(sigSvg(size, mood, { cls }));
}

export const STICKERS = [
  ['cheer', 'Cheer', 'This is great to hear'],
  ['support', 'Support', 'Rooting for you'],
  ['curious', 'Curious', 'Tell us more'],
  ['watching', 'Watching', 'Following this one'],
];
export const sticker = (key, size = 26) => sig(size, key === 'curious' ? 'curious' : key, 'stk');

// ---------------------------------------------------------------------------
// Emblems: fifteen levels in three tiers (Signal, Resonant, Lodestar)
// ---------------------------------------------------------------------------
const GLYPH = [
  '<path d="M16 5v6M16 21v6M5 16h6M21 16h6M9 9l3 3M20 20l3 3M23 9l-3 3M12 20l-3 3"/>',
  '<path d="M4 16h5l3-8 4 16 3-8h9"/>',
  '<circle cx="16" cy="16" r="3"/><path d="M8.5 8.5a10.6 10.6 0 0 1 15 0M8.5 23.5a10.6 10.6 0 0 0 15 0"/><path d="M4.5 12.5a15 15 0 0 1 23 0"/>',
  '<path d="M4 11c4 0 4 4 8 4s4-4 8-4 4 4 8 4M4 21c4 0 4 4 8 4s4-4 8-4 4 4 8 4"/>',
  '<path d="M3 16c3-8 6-8 9 0s6 8 9 0 6-8 9 0"/>',
  '<circle cx="16" cy="16" r="3"/><path d="M16 4v4M16 24v4M4 16h4M24 16h4M7.5 7.5l2.8 2.8M21.7 21.7l2.8 2.8M24.5 7.5l-2.8 2.8M10.3 21.7l-2.8 2.8"/>',
  '<circle cx="16" cy="16" r="3"/><circle cx="16" cy="16" r="8" stroke-dasharray="4 3"/><circle cx="16" cy="16" r="13" stroke-dasharray="2 4"/>',
  '<path d="M5 20v-4M9 24V8M13 21v-9M17 27V5M21 22V10M25 18v-4M29 21v-8"/>',
  '<path d="M6 22l10-10 10 10M9 27l7-7 7 7M13 12l3-3 3 3"/>',
  '<path d="M4 16h8M20 16h8"/><circle cx="12" cy="16" r="2.5"/><circle cx="20" cy="16" r="2.5"/><path d="M12 13.5c2-3 6-3 8 0M12 18.5c2 3 6 3 8 0"/>',
  '<path d="M16 4l10 6v12l-10 6-10-6V10z"/><path d="M16 11v10M11 16h10"/>',
  '<path d="M16 3l2.6 7.4 7.4 2.6-7.4 2.6L16 23l-2.6-7.4L6 13l7.4-2.6z"/><path d="M16 25v4M25 16h4M3 16h4"/>',
  '<circle cx="8" cy="10" r="3.5"/><circle cx="24" cy="22" r="3.5"/><path d="M11 12c3 2 7 6 10 8"/><path d="M8 13.5v6M24 18.5v-6" stroke-dasharray="1.5 2"/>',
  '<circle cx="16" cy="16" r="3.5"/><circle cx="16" cy="5" r="2.2"/><circle cx="16" cy="27" r="2.2"/><circle cx="5" cy="16" r="2.2"/><circle cx="27" cy="16" r="2.2"/><path d="M16 7.5v5M16 19.5v5M7.5 16h5M19.5 16h5"/>',
  [0, 60, 120, 180, 240, 300].map((a) => `<ellipse cx="16" cy="16" rx="3.6" ry="9" transform="rotate(${a} 16 16) translate(0 -5)"/>`).join('') + '<circle cx="16" cy="16" r="2.4" fill="currentColor" stroke="none"/>',
];
export const TIERS = [['#D8FF3D', '#7FD858', 'Signal'], ['#7CF0DC', '#D8FF3D', 'Resonant'], ['#FFE07A', '#F5A93F', 'Lodestar']];
export const tierOf = (level) => TIERS[Math.min(2, Math.floor((Math.max(1, level) - 1) / 5))];

export function emblem(level = 1, size = 40, locked = false, label = '') {
  const i = Math.max(1, Math.min(15, Number(level) || 1)) - 1;
  const [a, b] = tierOf(i + 1);
  const g = nextId('em');
  const hex = 'M32 3 L57 17.5 L57 46.5 L32 61 L7 46.5 L7 17.5 Z';
  const ca = locked ? '#5E6664' : a;
  const cb = locked ? '#3E4644' : b;
  return svg(`<svg class="emb${locked ? ' locked' : ''}" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${label || `Level ${i + 1} emblem`}">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ca}"/><stop offset="1" stop-color="${cb}"/></linearGradient>
    <radialGradient id="${g}r" cx=".35" cy=".25" r=".8"><stop offset="0" stop-color="#fff" stop-opacity="${locked ? 0.06 : 0.3}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <path d="${hex}" fill="url(#${g})" opacity="${locked ? 0.14 : 0.26}"/>
    <path d="${hex}" fill="none" stroke="url(#${g})" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M32 9.5 L51.5 20.8 L51.5 43.2 L32 54.5 L12.5 43.2 L12.5 20.8 Z" fill="#0C1413" fill-opacity="${locked ? 0.55 : 0.82}"/>
    <path d="${hex}" fill="url(#${g}r)"/>
    <g transform="translate(16 16)" fill="none" stroke="url(#${g})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" color="${ca}">${GLYPH[i]}</g>
    ${locked ? '<g transform="translate(46 46)"><circle r="7.5" fill="#1B2725" stroke="#5E6664"/><path d="M-2.8 -.4v-1.8a2.8 2.8 0 0 1 5.6 0v1.8M-3.8 -.4h7.6v4.8h-7.6z" fill="none" stroke="#A9B1AE" stroke-width="1.3" stroke-linejoin="round"/></g>' : ''}
  </svg>`);
}

// A ring that fills toward the next emblem
export function emblemRing(level, pct, size = 120) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const [a, b] = tierOf(level);
  const g = nextId('rg');
  const wrap = svg(`<svg class="emb-ring" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
    <defs><linearGradient id="${g}" x1="0" x2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".12" stroke-width="4"/>
    <circle class="ring-fill" cx="50" cy="50" r="${r}" fill="none" stroke="url(#${g})" stroke-width="4" stroke-linecap="round"
      stroke-dasharray="${((c * Math.max(0, Math.min(100, pct))) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>`);
  return wrap;
}

// ---------------------------------------------------------------------------
// Space tiles: initials on ink, in the category's color (from the design kit)
// ---------------------------------------------------------------------------
export { catColor, initials };
export const spaceTile = (space, size = 32) => svg(tileSvg(space, size));

// ---------------------------------------------------------------------------
// Sparkline of a Signal's versions
// ---------------------------------------------------------------------------
export function sparkline(values, w = 96, h = 28, cls = '') {
  const v = (values || []).filter((x) => x != null).map(Number);
  if (v.length < 2) return svg(`<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="M2 ${h / 2}H${w - 2}" stroke="currentColor" stroke-opacity=".35" stroke-width="1.6" stroke-dasharray="2 3" fill="none"/></svg>`);
  const lo = Math.min(...v); const hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((x, i) => [2 + (i * (w - 4)) / (v.length - 1), h - 3 - ((x - lo) / span) * (h - 6)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const [lx, ly] = pts[pts.length - 1];
  const up = v[v.length - 1] >= v[0];
  return svg(`<svg class="spark ${up ? 'up' : 'down'} ${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.6" fill="currentColor"/></svg>`);
}

// The Signal's scale, red to amber to lime, with a marker at the score
export function scale(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const g = nextId('sc');
  return svg(`<svg class="scale" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="200" y2="0"><stop offset="0" stop-color="#B0453D"/><stop offset=".55" stop-color="#D4A72C"/><stop offset="1" stop-color="#D8FF3D"/></linearGradient></defs>
    <rect x="0" y="5" width="200" height="4" rx="2" fill="currentColor" fill-opacity=".14"/>
    <rect x="0" y="5" width="${(2 * s).toFixed(1)}" height="4" rx="2" fill="url(#${g})"/>
    <rect x="${Math.max(0, 2 * s - 1.5).toFixed(1)}" y="1" width="3" height="12" rx="1.5" fill="currentColor"/></svg>`);
}
