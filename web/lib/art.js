// The community's art, drawn in code: Sig (the Community Signal in person) in
// every mood, the fifteen emblems from Spark to Organism, Sig stickers, space
// tiles and sparklines. Sig keeps the prototype's shape, face and moods, in the
// new lime, drawn as a muscle fibre.
import { svg } from './ui.js';

let uid = 0;
const nextId = (p) => `${p}${++uid}`;

// ---------------------------------------------------------------------------
// Sig
// ---------------------------------------------------------------------------
const DROP = 'M32 6 C40 16 52 26 52 39 A20 20 0 0 1 12 39 C12 26 24 16 32 6 Z';
const INK = '#121E1D';
const FACES = {
  idle: `<g class="sig-eyes"><ellipse cx="25" cy="38" rx="2.8" ry="3.6" fill="${INK}"/><ellipse cx="39" cy="38" rx="2.8" ry="3.6" fill="${INK}"/><circle cx="26" cy="36.6" r="1" fill="#fff"/><circle cx="40" cy="36.6" r="1" fill="#fff"/></g><path d="M27 46 Q32 50 37 46" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
  happy: `<path d="M21.8 39 Q25 34.4 28.2 39 M35.8 39 Q39 34.4 42.2 39" fill="none" stroke="${INK}" stroke-width="2.3" stroke-linecap="round"/><path d="M25.5 44.5 Q32 52.5 38.5 44.5 Z" fill="${INK}"/><path d="M28.6 47.4 Q32 49.6 35.4 47.4" fill="none" stroke="#FF8FA3" stroke-width="1.6" stroke-linecap="round"/>`,
  think: `<g class="sig-eyes"><ellipse cx="25" cy="37.5" rx="2.8" ry="3.6" fill="${INK}"/><ellipse cx="39" cy="37.5" rx="2.8" ry="3.6" fill="${INK}"/><circle cx="26.4" cy="35.6" r="1.1" fill="#fff"/><circle cx="40.4" cy="35.6" r="1.1" fill="#fff"/></g><circle cx="33" cy="47" r="2.2" fill="none" stroke="${INK}" stroke-width="1.9"/><g class="sig-dots" fill="${INK}"><circle cx="49" cy="20" r="1.6"/><circle cx="54" cy="15.5" r="2"/><circle cx="59.5" cy="10" r="2.5"/></g>`,
  sleepy: `<path d="M21.5 39 Q25 41.6 28.5 39 M35.5 39 Q39 41.6 42.5 39" fill="none" stroke="${INK}" stroke-width="2.1" stroke-linecap="round"/><path d="M29.5 47 Q32 48.4 34.5 47" fill="none" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/><g class="sig-zz" fill="#9AA3B2" font-family="Inter, sans-serif" font-weight="800"><text x="46" y="16" font-size="9">z</text><text x="53" y="9" font-size="7">z</text></g>`,
  watching: `<circle cx="25" cy="38" r="4.6" fill="#fff"/><circle cx="39" cy="38" r="4.6" fill="#fff"/><circle class="sig-pupil" cx="26.2" cy="38.4" r="2.6" fill="${INK}"/><circle class="sig-pupil" cx="40.2" cy="38.4" r="2.6" fill="${INK}"/><path d="M28.5 47 Q32 49 35.5 47" fill="none" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>`,
  curious: `<ellipse cx="25" cy="38.6" rx="2.6" ry="3.2" fill="${INK}"/><ellipse cx="39" cy="37.6" rx="3.2" ry="4.2" fill="${INK}"/><circle cx="40.2" cy="36" r="1.1" fill="#fff"/><path d="M35.5 31.5 Q39.5 29 43 31.6" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/><path d="M29 47 Q32.5 45.5 36 47.5" fill="none" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/><text x="50" y="22" font-family="Inter, sans-serif" font-weight="800" font-size="13" fill="${INK}">?</text>`,
  concerned: `<path d="M21.5 33.5 L28 35.5 M42.5 33.5 L36 35.5" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/><ellipse cx="25" cy="39" rx="2.6" ry="3.2" fill="${INK}"/><ellipse cx="39" cy="39" rx="2.6" ry="3.2" fill="${INK}"/><path d="M27 48 Q29.5 45.8 32 48 Q34.5 50.2 37 48" fill="none" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>`,
};
const EXTRAS = {
  cheer: '<g class="sig-spark" fill="#121E1D"><path d="M8 12 9.2 15.2 12.4 16.4 9.2 17.6 8 20.8 6.8 17.6 3.6 16.4 6.8 15.2z"/><path d="M56 22 56.9 24.4 59.3 25.3 56.9 26.2 56 28.6 55.1 26.2 52.7 25.3 55.1 24.4z"/><circle cx="54" cy="9" r="1.6"/><circle cx="11" cy="29" r="1.3"/></g>',
  support: '<path class="sig-heart" d="M53 13.5c-1.6-3.2-6.4-2.2-6.4 1.3 0 2.7 3.3 4.8 6.4 7.2 3.1-2.4 6.4-4.5 6.4-7.2 0-3.5-4.8-4.5-6.4-1.3z" fill="#FF6F86"/>',
  watching: '<g class="sig-waves" fill="none" stroke="#121E1D" stroke-width="1.6" stroke-linecap="round"><path d="M50 12a8 8 0 0 1 6 6"/><path d="M50 7a13 13 0 0 1 11 11"/></g>',
};
const MOOD_FACE = { idle: 'idle', happy: 'happy', think: 'think', sleepy: 'sleepy', watching: 'watching', curious: 'curious', concerned: 'concerned', cheer: 'happy', support: 'happy', offline: 'sleepy', burst: 'happy' };

// Sig is a muscle fibre in the brand's lime: fine strands, alternately darker and lighter, run
// from a white tendon at the tip and fan over the belly; three soft grooves split it into four
// bundles; a few glossy streaks catch the light. Small Sigs (stickers) keep fewer strands.
const f2 = (n) => Number(n).toFixed(2);
function fibre(xb, top = 14, wob = 0) {
  const k = xb - 32;
  return `M${f2(32 + k * 0.06)} ${top} C${f2(32 + k * 0.35)} ${top + 8}, ${f2(32 + k * 1.02 + wob)} ${top + 16}, ${f2(xb)} ${top + 27} S${f2(xb + k * 0.02 - wob)} 56, ${f2(xb - k * 0.12)} 66`;
}
function muscle(g, off, detail) {
  const tone = off ? '#5A6260' : '#5E9A0E';
  const light = off ? '#EEF1F0' : '#F6FFD2';
  const n = detail ? 17 : 7;
  const xs = Array.from({ length: n }, (_, i) => 12.6 + (i * 38.8) / (n - 1));
  const darkF = xs.filter((_, i) => i % 2 === 0);
  const liteF = xs.filter((_, i) => i % 2 === 1);
  const grooves = [22.4, 32, 41.6].map((x) => fibre(x, 15)).join(' ');
  const defs = `<clipPath id="${g}c"><path d="${DROP}"/></clipPath>
    <linearGradient id="${g}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#F4F7EE" stop-opacity=".85"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
    <radialGradient id="${g}v" cx=".44" cy=".4" r=".66"><stop offset=".5" stop-color="${tone}" stop-opacity="0"/><stop offset="1" stop-color="${tone}" stop-opacity=".42"/></radialGradient>`;
  const body = `<g clip-path="url(#${g}c)">
        <path d="${darkF.map((x, i) => fibre(x, 14, (i % 3) - 1)).join(' ')}" fill="none" stroke="${tone}" stroke-opacity="${detail ? 0.26 : 0.3}" stroke-width="${detail ? 0.9 : 1.3}" stroke-linecap="round"/>
        <path d="${liteF.map((x, i) => fibre(x, 16, 1 - (i % 3))).join(' ')}" fill="none" stroke="${light}" stroke-opacity="${detail ? 0.55 : 0.45}" stroke-width="${detail ? 0.8 : 1.2}" stroke-linecap="round"/>
        <path d="${grooves}" fill="none" stroke="${tone}" stroke-opacity=".15" stroke-width="${detail ? 3.4 : 4}" stroke-linecap="round"/>
        <path d="${grooves}" fill="none" stroke="${tone}" stroke-opacity=".48" stroke-width="${detail ? 1 : 1.3}" stroke-linecap="round"/>
        ${detail ? `<path d="${[17.6, 26.8].map((x) => fibre(x, 22)).join(' ')}" fill="none" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="2" stroke-linecap="round" stroke-dasharray="9 40"/>` : ''}
        <rect width="64" height="64" fill="url(#${g}v)"/>
        <path d="M32 6 C35 9.6 37.6 13 39.6 16.6 Q32 20.6 24.4 16.6 C26.4 13 29 9.6 32 6 Z" fill="url(#${g}t)"/>
        <path d="${DROP}" fill="none" stroke="${light}" stroke-opacity=".55" stroke-width="2.4"/>
      </g>`;
  return { defs, body };
}

export function sig(size = 56, mood = 'idle', cls = '') {
  const g = nextId('sg');
  const face = FACES[MOOD_FACE[mood] || 'idle'];
  const off = mood === 'offline';
  const stops = off
    ? '<stop offset="0" stop-color="#C9CFCC"/><stop offset="1" stop-color="#8E9693"/>'
    : '<stop offset="0" stop-color="#F2FFB3"/><stop offset=".5" stop-color="#D8FF3D"/><stop offset="1" stop-color="#9BE35A"/>';
  const m = muscle(g, off, size >= 36);
  return svg(`<svg class="sig ${mood} ${cls}" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>
    <radialGradient id="${g}h" cx=".35" cy=".28" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>${m.defs}</defs>
    <ellipse class="sig-shadow" cx="32" cy="61" rx="13" ry="2.2" fill="#121E1D" opacity=".14"/>
    <g class="sig-body">
      <path d="${DROP}" fill="url(#${g})"/>
      ${m.body}
      <path d="${DROP}" fill="url(#${g}h)"/>
      <path d="${DROP}" fill="none" stroke="#121E1D" stroke-opacity=".18" stroke-width="1"/>
      <circle class="sig-node" cx="32" cy="9.2" r="3.1" fill="#fff"/>
      <g class="sig-face">${face}</g>
      <circle cx="19.8" cy="44.5" r="2.4" fill="#FF8FA3" opacity=".45"/><circle cx="44.2" cy="44.5" r="2.4" fill="#FF8FA3" opacity=".45"/>
    </g>${EXTRAS[mood] || ''}</svg>`);
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
// Space tiles: initials on ink, in the category's color
// ---------------------------------------------------------------------------
const CAT = {
  'Metabolic & weight': '#D8FF3D', 'Growth-hormone axis': '#7DD3FC', 'Healing & recovery': '#6EE7B7', 'Gut & digestion': '#BEF264',
  'Immune & inflammation': '#5EEAD4', 'Cognition & focus': '#C4B5FD', 'Mood & stress': '#A5B4FC', Sleep: '#93C5FD',
  'Sexual health': '#FB7185', 'Skin & hair': '#FDA4AF', Longevity: '#FCD34D', 'Hormone balance': '#F9A8D4',
  'Muscle & performance': '#FCA5A5', 'Heart & circulation': '#F87171', 'Energy & mitochondria': '#FDE68A',
  'Vitamins & minerals': '#FDBA74', 'Liver & detox': '#A3E635', 'Joints & bones': '#D6D3D1', Stacks: '#D8FF3D',
  // older names, for anything saved before the library grew
  Metabolic: '#D8FF3D', 'Cognition & mood': '#C4B5FD', Supplements: '#E5E7EB', 'Skin & appearance': '#FDA4AF',
  Immune: '#5EEAD4', 'Gut & inflammation': '#BEF264',
};
export const catColor = (cat) => CAT[cat] || '#D8FF3D';
export function initials(name) {
  const clean = String(name || '?').replace(/[’'().]/g, '').replace(/\band\b/gi, ' ');
  const m = clean.match(/^([A-Za-z]+)[- ]?(\d+)/);
  if (m) return (m[1].length === 3 ? m[1] : m[1].slice(0, 2) + m[2].slice(0, 1)).toUpperCase();
  const words = clean.split(/[\s-]+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}
export function spaceTile(space, size = 32) {
  const color = catColor(space?.category);
  if (space?.kind === 'stack') {
    // A stack: layered plates, with how many compounds are in it
    const n = (space.part_ids || []).length || '';
    return svg(`<svg class="tile" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#121E1D"/><rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="${color}" stroke-opacity=".45"/>
      <path d="M9 13.5 16 10l7 3.5-7 3.5z" fill="${color}"/><path d="m9 17.5 7 3.5 7-3.5" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/>
      <path d="m9 21 7 3.5 7-3.5" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".45"/>
      ${n ? `<circle cx="25" cy="7" r="5" fill="${color}"/><text x="25" y="9.6" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-weight="600" font-size="7.5" fill="#121E1D">${Number(n)}</text>` : ''}</svg>`);
  }
  const txt = initials(space?.name || space?.compound_name || space?.id);
  const fs = txt.length > 2 ? 11 : 13;
  return svg(`<svg class="tile" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="#121E1D"/><rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="${color}" stroke-opacity=".35"/>
    <text x="16" y="20.5" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-weight="600" font-size="${fs}" fill="${color}">${txt.replace(/[^A-Z0-9]/g, '')}</text></svg>`);
}

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
