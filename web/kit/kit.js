// Unhyped's design kit: the pieces every Unhyped page shares, so the website
// (miraclehealth.us) and the community app (community.miraclehealth.us) look like one product
// and can't drift apart: the bar of the four places, the evidence meter, the Community Signal
// number, compound tiles and chips, Sig, and the links one place opens in another.
//
// The source is shared/kit in miracle-health-community. scripts/sync_kit.sh copies it into the
// community app (web/kit) and the website (kit/ in miraclehealth-site), and CI checks that every
// copy matches. Each piece returns markup made only from our own drawing and escaped text: the
// website's build prints it into static pages, and the apps turn it into elements with node().
// No imports, and nothing that needs a browser except node().

export const SITE = 'https://miraclehealth.us';
export const COMMUNITY = 'https://community.miraclehealth.us';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------------
// The four places, in this order on every page
// ---------------------------------------------------------------------------
export const PLACES = [['library', 'Library'], ['ai', 'Ask Sig'], ['community', 'Community'], ['my', 'My stack']];
// On the website pass site: '' (its own links stay on the page's origin); in the community pass
// community: '' (its own home is #/home)
export function placeHref(key, { site = SITE, community = COMMUNITY } = {}) {
  if (key === 'library') return `${site}/library/`;
  if (key === 'ai') return `${site}/ai/`;
  if (key === 'my') return `${site}/my/`;
  return community ? `${community}/` : '#/home';
}
export function barHtml(current = '', { cls = '', label = 'Unhyped', ...where } = {}) {
  return `<nav class="mh-bar${cls ? ` ${esc(cls)}` : ''}" aria-label="${esc(label)}">${PLACES.map(([k, name]) =>
    `<a href="${esc(placeHref(k, where))}" data-place="${k}"${k === current ? ' aria-current="page"' : ''}>${esc(name)}</a>`).join('')}</nav>`;
}

// ---------------------------------------------------------------------------
// Links from one place into another (both sides read them the same way)
// ---------------------------------------------------------------------------
export const b64u = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(String(text)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (text) => new TextDecoder().decode(Uint8Array.from(atob(String(text).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
// Sig with a question typed in, not sent: they read it, change it, then send it
export const askAboutCompound = (name) => `What may ${name} do for me? What does the evidence say, and what do members report?`;
export const askLink = (question, { site = SITE } = {}) => `${site}/ai/#ask=${b64u(String(question).slice(0, 1500))}`;
export function askFrom(hash) {
  const m = /^#ask=([A-Za-z0-9_-]{4,4100})$/.exec(hash || '');
  if (!m) return '';
  try { return unb64u(m[1]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 1500); } catch { return ''; }
}
// The community's new-post form, filled in with a draft they edit before posting. It travels
// after "#", so no server sees it until they post.
export const draftLink = (ids, { title = '', body = '' } = {}, { community = COMMUNITY } = {}) =>
  `${community}/#/new?c=${(ids || []).filter((id) => /^[a-z0-9]{1,40}$/.test(id)).slice(0, 8).join(',')}&d=${b64u(JSON.stringify({ v: 1, t: String(title).slice(0, 140), b: String(body).slice(0, 4000) }))}`;
export function draftFrom(d) {
  if (!/^[A-Za-z0-9_-]{4,12000}$/.test(d || '')) return null;
  try {
    const x = JSON.parse(unb64u(d));
    if (!x || x.v !== 1) return null;
    const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, n);
    return { title: clean(x.t, 140), body: clean(x.b, 4000) };
  } catch { return null; }
}
export const spaceLink = (id, { community = COMMUNITY } = {}) => `${community}/#/s/${encodeURIComponent(id)}`;
export const libraryLink = (id, { site = SITE } = {}) => `${site}/library/${encodeURIComponent(id)}/`;

// ---------------------------------------------------------------------------
// How strong the evidence is: four bars, from the Library's grade
// ---------------------------------------------------------------------------
export const GRADES = {
  strong: [4, 'Strong evidence', 'Several good trials in people, or approved for this use'],
  moderate: [3, 'Moderate evidence', 'At least one good trial in people, or several smaller ones'],
  limited: [2, 'Limited evidence', 'Small or short studies in people, or ones with no comparison group'],
  preclinical: [1, 'Animal and lab studies', 'Tested in animals or cells, not in people'],
  anecdotal: [0, 'Anecdotal', 'People’s reports only, no studies'],
};
export const gradeLabel = (grade) => GRADES[grade]?.[1] || '';
// words: the grade's name beside the bars (otherwise it's the bars' label); bare: only the bars,
// beside words that already say it
export function meterHtml(grade, { words = false, label = '', bare = false } = {}) {
  const g = GRADES[grade];
  if (!g) return '';
  const name = label || g[1];
  const bars = `<span class="mh-meter m${g[0]}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
  if (bare) return bars;
  return words
    ? `<span class="mh-ev words" title="${esc(g[2])}">${bars}<span>${esc(name)}</span></span>`
    : `<span class="mh-ev" role="img" aria-label="${esc(name)}" title="${esc(name)}">${bars}</span>`;
}

// ---------------------------------------------------------------------------
// The Community Signal: one number per compound, 0 to 100, beside its certification seal
// (pass the seal from signalviz.js's sealSvg and the level's name)
// ---------------------------------------------------------------------------
export function signalHtml(score, { seal = '', level = '', big = false } = {}) {
  const v = Number(score);
  if (score == null || score === '' || !Number.isFinite(v)) return '';
  const n = v.toFixed(1);
  const what = `Community Signal ${n} of 100${level ? `, ${level}` : ''}`;
  return `<span class="mh-signal${big ? ' big' : ''}" title="${esc(what)}">${seal}<b aria-hidden="true">${n}</b><span class="mh-sr">${esc(what)}</span></span>`;
}

// ---------------------------------------------------------------------------
// Compound tiles (initials on a plate, in the category's tint) and chips
// ---------------------------------------------------------------------------
// Six quiet tints of bone, not a colour per category: lime is the Signal's alone, and the
// category is always written beside the tile.
const BONE = '#F7F8FA', SAND = '#E8DCC4', STONE = '#CED6D2', SAGE = '#DAE2CA', MIST = '#C9D3DC', CLAY = '#E6CFC0';
const CAT = {
  'Metabolic & weight': BONE, 'Growth-hormone axis': STONE, 'Healing & recovery': SAGE, 'Gut & digestion': SAGE,
  'Immune & inflammation': SAGE, 'Cognition & focus': MIST, 'Mood & stress': MIST, Sleep: STONE,
  'Sexual health': CLAY, 'Skin & hair': SAND, Longevity: SAND, 'Hormone balance': SAND,
  'Muscle & performance': CLAY, 'Heart & circulation': STONE, 'Energy & mitochondria': SAND,
  'Vitamins & minerals': BONE, 'Liver & detox': SAGE, 'Joints & bones': STONE, Stacks: BONE,
  // older names, for anything saved before the library grew
  Metabolic: BONE, 'Cognition & mood': MIST, Supplements: BONE, 'Skin & appearance': SAND,
  Immune: SAGE, 'Gut & inflammation': SAGE,
};
export const catColor = (cat) => CAT[cat] || BONE;
export function initials(name) {
  const clean = String(name || '?').replace(/[’'().]/g, '').replace(/\band\b/gi, ' ');
  const m = clean.match(/^([A-Za-z]+)[- ]?(\d+)/);
  if (m) return (m[1].length === 3 ? m[1] : m[1].slice(0, 2) + m[2].slice(0, 1)).toUpperCase();
  const words = clean.split(/[\s-]+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}
// space: { name, category, kind, part_ids } (a community space, or a Library compound)
export function tileSvg(space, size = 32) {
  const color = esc(catColor(space?.category));
  if (space?.kind === 'stack') {
    // A stack: layered plates, with how many compounds are in it
    const n = (space.part_ids || []).length || '';
    return `<svg class="tile mh-tile" viewBox="0 0 32 32" width="${Number(size)}" height="${Number(size)}" aria-hidden="true">
      <rect width="32" height="32" rx="0" fill="#121214"/><rect x=".5" y=".5" width="31" height="31" rx="0" fill="none" stroke="${color}" stroke-opacity=".45"/>
      <path d="M9 13.5 16 10l7 3.5-7 3.5z" fill="${color}"/><path d="m9 17.5 7 3.5 7-3.5" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/>
      <path d="m9 21 7 3.5 7-3.5" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".45"/>
      ${n ? `<circle cx="25" cy="7" r="5" fill="${color}"/><text x="25" y="9.6" text-anchor="middle" font-family="Monaspace Neon, ui-monospace, monospace" font-weight="700" font-size="7.5" fill="#000000">${Number(n)}</text>` : ''}</svg>`;
  }
  const txt = initials(space?.name || space?.compound_name || space?.id).replace(/[^A-Z0-9]/g, '');
  const fs = txt.length > 2 ? 11 : 13;
  return `<svg class="tile mh-tile" viewBox="0 0 32 32" width="${Number(size)}" height="${Number(size)}" aria-hidden="true">
    <rect width="32" height="32" rx="0" fill="#121214"/><rect x=".5" y=".5" width="31" height="31" rx="0" fill="none" stroke="${color}" stroke-opacity=".35"/>
    <text x="16" y="20.5" text-anchor="middle" font-family="Monaspace Neon, ui-monospace, monospace" font-weight="700" font-size="${fs}" fill="${color}">${txt}</text></svg>`;
}
// A compound: its tile, name, evidence meter and Signal, and a short line about its part in a
// plan or stack. href makes the whole chip a link.
export function chipHtml({ name = '', href = '', category = '', kind = '', grade = '', signal = '', role = '', tile = true, cls = '' } = {}) {
  const tag = href ? 'a' : 'span';
  return `<${tag} class="mh-chip${cls ? ` ${esc(cls)}` : ''}"${href ? ` href="${esc(href)}"` : ''}>${tile ? tileSvg({ name, category, kind }, 28) : ''}<span class="mh-chip-t"><span class="mh-chip-n"><span class="mh-chip-name">${esc(name)}</span>${meterHtml(grade)}${signal}</span>${role ? `<span class="mh-chip-r">${esc(role)}</span>` : ''}</span></${tag}>`;
}

// ---------------------------------------------------------------------------
// Sig, the Community Signal in person, drawn in the same hand as the front page's three step
// drawings: a fine ring on a 200 grid, the mood inside it in the Signal's blue, and around the
// mood its echoes fading out (half strength, then a fifth), in hairlines that stay 1.2px at any
// size. It has no face. A mood changes what is inside the ring (and how it moves, kit.css): a
// dot at rest, three dots while it thinks, a spark to cheer, a heart for support, a question
// mark when curious, an eye when watching, a moon while it rests; a warning sign in amber when
// something is wrong, grey when offline.
// Small sizes draw less, so it still reads: under 56px one echo, under 36px the ring and the
// mood alone, drawn larger.
// dark: drawn on a dark page, in white lines. On a light one the lines are ink.
// ---------------------------------------------------------------------------
export const MOODS = ['idle', 'happy', 'think', 'sleepy', 'watching', 'curious', 'concerned', 'cheer', 'support', 'offline', 'burst'];
// A four-point spark: t is how far its points reach, a and b bend its sides (a fuller spark has larger ones)
const sigSpark = (t, a, b) => `M0${-t}C${a}${-b} ${b}${-a} ${t} 0C${b} ${a} ${a} ${b} 0 ${t}C${-a} ${b}${-b} ${a}${-t} 0C${-b}${-a}${-a}${-b} 0${-t}Z`;
const SIG_HEART = 'M0 35C-23 17-38 5-38-12.5C-38-25.5-28-35-16.5-35C-9.5-35-3.3-31.3 0-25.4C3.3-31.3 9.5-35 16.5-35C28-35 38-25.5 38-12.5C38 5 23 17 0 35Z';
const SIG_MOON = 'M-9.1-39A40 40 0 1 0 39 9.1A34 34 0 0 1-9.1-39Z';
const sigEye = (w, h) => `M${-w} 0Q0${-h} ${w} 0Q0 ${h}${-w} 0Z`;
const sigSign = (top, base, half) => `M0${-top}L${half} ${base}H${-half}Z`;
export function sigSvg(size = 56, mood = 'idle', { cls = '', dark = false } = {}) {
  const m = MOODS.includes(mood) ? mood : 'idle';
  const px = Number(size) || 56;
  const lod = px >= 56 ? 2 : px >= 36 ? 1 : 0;   // 2: the whole drawing. 1: one echo. 0: the ring and the mood
  const k = [1.5, 1.14, 1][lod];                   // the mood grows as the drawing around it goes
  const R = Math.min(96, Math.floor(99.5 - 120 / px));   // the ring, whole inside the box however small it is drawn
  const off = m === 'offline';
  const a = off ? '#7F8796' : m === 'concerned' ? '#E8B75A' : '#3D8BFF';
  const line = (o) => `rgba(${dark ? '255,255,255' : '0,0,0'},${off ? Math.min(o, 0.45) : o})`;
  const S = 'fill="none" stroke-width="1.2" vector-effect="non-scaling-stroke"';
  const circle = (r, stroke, more = '') => `<circle${more} r="${r}" stroke="${stroke}" ${S}/>`;
  const path = (d, stroke, more = '') => `<path${more} d="${d}" stroke="${stroke}" ${S}/>`;
  // Echoes: rings, or the mood's own shape again, larger and fainter
  const rings = (r1, r2, r3) => (lod ? circle(r1, line(0.5)) : '') + (lod === 2 ? circle(r2, line(0.2)) + (r3 ? circle(r3, line(0.2)) : '') : '');
  const grown = (d, s) => d.replace(/-?\d*\.?\d+/g, (n) => Math.round(n * s * 10) / 10);   // the same shape, s times the size
  const echo = (d, s1, s2) => (lod === 2 ? path(grown(d, s1), line(0.5)) + path(grown(d, s2), line(0.2)) : lod ? path(grown(d, (s1 + s2) / 2), line(0.5)) : '');
  const mark = (inner) => (k === 1 ? `<g class="sig-mark">${inner}</g>` : `<g transform="scale(${k})"><g class="sig-mark">${inner}</g></g>`);
  const dot = (cy) => `<circle cy="${cy}" r="3.6" stroke="${a}" ${S}/>`;
  const draw = {
    idle: () => (lod ? rings(72, 52, 33) : circle(58, line(0.5))) + mark(circle(lod ? 16 : 13, a, ' class="sig-dot"')),
    think: () => (lod === 2 ? path('M-70-27H70M-70 27H70', line(0.5)) + path('M-56-52H56M-56 52H56', line(0.2)) : lod ? path('M-66-32H66M-66 32H66', line(0.5)) : '')
      + mark([-34, 0, 34].map((x, i) => `<circle class="sig-dot${i ? ` d${i + 1}` : ''}" cx="${x}" r="9" stroke="${a}" ${S}/>`).join('')),
    cheer: () => (lod === 2 ? path(sigSpark(66, 10, 36), line(0.5)) + path(sigSpark(86, 16, 57), line(0.2)) : lod ? path(sigSpark(72, 12, 42), line(0.5)) : '')
      + mark(path(sigSpark(46, 5, 18), a)),
    support: () => echo(SIG_HEART, 1.4, 1.82) + mark(path(SIG_HEART, a)),
    curious: () => rings(76, 57) + mark(path('M-22-20A22 22 0 1 1 11-.9Q0 5.6 0 18', a) + dot(37)),
    watching: () => (lod === 2 ? path(sigEye(80, 74), line(0.2)) + path(sigEye(58, 52), line(0.5)) : lod ? path(sigEye(66, 58), line(0.5)) : path(sigEye(62, 54), a))
      + `<g class="sig-mark"><g class="sig-pupil">${lod === 2 ? circle(17, a) + circle(5, a) : lod ? circle(19, a) + circle(6, a) : circle(18, a)}</g></g>`,
    concerned: () => (lod === 2 ? path(sigSign(78, 50, 74), line(0.2)) + path(sigSign(52, 34, 48), line(0.5)) : lod ? path(sigSign(66, 44, 63), line(0.5)) : '')
      + mark(path('M0-26V6', a) + dot(21)),
    sleepy: () => rings(74, 54) + mark(path(SIG_MOON, a)),
    offline: () => mark(path('M-24 0H24', a)),
  };
  draw.happy = draw.idle;
  draw.burst = draw.cheer;
  return `<svg class="sig ${m}${cls ? ` ${esc(cls)}` : ''}" viewBox="-100 -100 200 200" width="${px}" height="${px}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle class="sig-ring" r="${R}" stroke="${line(0.9)}" ${S}/><g class="sig-in">${draw[m]()}</g></svg>`;
}

// ---------------------------------------------------------------------------
// Loading, in both apps: Sig's ring is the spinner (BRAND, Motion). The eleven who gather what's
// known round the ring, each in its own colour, light one by one (kit.css .mh-wait), beside one plain
// line saying what's loading. No grey skeleton boxes, no bare "Loading…". The ring is drawn as the
// website's lib/ring.js and the community's core/ring.js draw it.
// ---------------------------------------------------------------------------
const WAIT_WHEEL = ['#FF6B5B', '#FF9F4A', '#F2C94C', '#3D8BFF', '#5FE08A', '#3FE0C5', '#55D3FF', '#6FA8FE', '#8F95FF', '#B98CFF', '#FF7FC8'];
export function waitRingSvg(size = 20) {
  const sw = Math.max(2.4, size * 0.17);
  const gap = size > 60 ? 4.5 : 9;
  const r = size / 2 - sw / 2 - 0.5;
  const c = 2 * Math.PI * r;
  const g = (gap / 360) * c;
  const n = (x) => Number(x.toFixed(2));
  const arcs = WAIT_WHEEL.map((col, i) => `<circle class="rg" r="${n(r)}" fill="none" stroke="${col}" stroke-width="${n(sw)}" stroke-dasharray="${n(c / 11 - g)} ${n(c)}" transform="rotate(${n(-90 + (i * 360) / 11 + gap / 2)})"/>`).join('');
  return `<svg class="mh-wait-ring" width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}" aria-hidden="true" focusable="false">${arcs}</svg>`;
}
// The line, said plainly ("Loading the live Signal"), announced to screen readers as it appears
export function waitHtml(words = 'Loading', { size = 20, cls = '' } = {}) {
  return `<p class="mh-wait${cls ? ` ${cls}` : ''}" role="status">${waitRingSvg(size)}<span>${esc(words)}</span></p>`;
}

// ---------------------------------------------------------------------------
// In the browser: the kit's own markup as an element (never for anything a member wrote)
// ---------------------------------------------------------------------------
let parser = null;
export function node(markup) {
  parser ||= new DOMParser();
  const s = String(markup).trim();
  if (s.startsWith('<svg')) {
    const withNs = s.includes('xmlns=') ? s : s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    return document.importNode(parser.parseFromString(withNs, 'image/svg+xml').documentElement, true);
  }
  const doc = parser.parseFromString(`<!doctype html><body>${s}`, 'text/html');
  return document.importNode(doc.body.firstElementChild, true);
}
