// Miracle Health's design kit: the pieces every Miracle Health page shares, so the website
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
export const PLACES = [['library', 'Library'], ['ai', 'Ask Sig'], ['community', 'Community'], ['my', 'My Miracle']];
// On the website pass site: '' (its own links stay on the page's origin); in the community pass
// community: '' (its own home is #/home)
export function placeHref(key, { site = SITE, community = COMMUNITY } = {}) {
  if (key === 'library') return `${site}/library/`;
  if (key === 'ai') return `${site}/ai/`;
  if (key === 'my') return `${site}/my/`;
  return community ? `${community}/` : '#/home';
}
export function barHtml(current = '', { cls = '', label = 'Miracle Health', ...where } = {}) {
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
const BONE = '#F0ECE0', SAND = '#E8DCC4', STONE = '#CED6D2', SAGE = '#DAE2CA', MIST = '#C9D3DC', CLAY = '#E6CFC0';
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
      <rect width="32" height="32" rx="5" fill="#0E1615"/><rect x=".5" y=".5" width="31" height="31" rx="4.5" fill="none" stroke="${color}" stroke-opacity=".45"/>
      <path d="M9 13.5 16 10l7 3.5-7 3.5z" fill="${color}"/><path d="m9 17.5 7 3.5 7-3.5" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/>
      <path d="m9 21 7 3.5 7-3.5" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".45"/>
      ${n ? `<circle cx="25" cy="7" r="5" fill="${color}"/><text x="25" y="9.6" text-anchor="middle" font-family="Monaspace Neon, ui-monospace, monospace" font-weight="700" font-size="7.5" fill="#121E1D">${Number(n)}</text>` : ''}</svg>`;
  }
  const txt = initials(space?.name || space?.compound_name || space?.id).replace(/[^A-Z0-9]/g, '');
  const fs = txt.length > 2 ? 11 : 13;
  return `<svg class="tile mh-tile" viewBox="0 0 32 32" width="${Number(size)}" height="${Number(size)}" aria-hidden="true">
    <rect width="32" height="32" rx="5" fill="#0E1615"/><rect x=".5" y=".5" width="31" height="31" rx="4.5" fill="none" stroke="${color}" stroke-opacity=".35"/>
    <text x="16" y="20.5" text-anchor="middle" font-family="Monaspace Neon, ui-monospace, monospace" font-weight="700" font-size="${fs}" fill="${color}">${txt}</text></svg>`;
}
// A compound: its tile, name, evidence meter and Signal, and a short line about its part in a
// plan or stack. href makes the whole chip a link.
export function chipHtml({ name = '', href = '', category = '', kind = '', grade = '', signal = '', role = '', tile = true, cls = '' } = {}) {
  const tag = href ? 'a' : 'span';
  return `<${tag} class="mh-chip${cls ? ` ${esc(cls)}` : ''}"${href ? ` href="${esc(href)}"` : ''}>${tile ? tileSvg({ name, category, kind }, 28) : ''}<span class="mh-chip-t"><span class="mh-chip-n"><span class="mh-chip-name">${esc(name)}</span>${meterHtml(grade)}${signal}</span>${role ? `<span class="mh-chip-r">${esc(role)}</span>` : ''}</span></${tag}>`;
}

// ---------------------------------------------------------------------------
// Sig, the Community Signal in person: the Signal's own ring with a dot inside. It has no face.
// A mood changes the mark inside the ring (and how it moves, kit.css): three dots while it
// thinks, a bar while it rests, a spark to cheer, a heart for support, a question mark when
// curious, an eye when watching; amber when something is wrong, grey when offline.
// dark: drawn on a dark page. On a light one the ring gets an ink edge, so it still reads.
// ---------------------------------------------------------------------------
const INK = '#121E1D';
export const MOODS = ['idle', 'happy', 'think', 'sleepy', 'watching', 'curious', 'concerned', 'cheer', 'support', 'offline', 'burst'];
const SPARK = 'M32 19.5 C33.3 27 37 30.7 44.5 32 C37 33.3 33.3 37 32 44.5 C30.7 37 27 33.3 19.5 32 C27 30.7 30.7 27 32 19.5 Z';
const BAR = (c) => `<rect class="sig-mark" x="23" y="29.5" width="18" height="5" rx="2.5" fill="${c}"/>`;
const MARKS = {
  think: (c) => `<g class="sig-mark"><circle class="sig-dot" cx="22.5" cy="32" r="3.1" fill="${c}"/><circle class="sig-dot d2" cx="32" cy="32" r="3.1" fill="${c}"/><circle class="sig-dot d3" cx="41.5" cy="32" r="3.1" fill="${c}"/></g>`,
  sleepy: BAR,
  offline: BAR,
  cheer: (c) => `<path class="sig-mark" d="${SPARK}" fill="${c}"/>`,
  burst: (c) => `<path class="sig-mark" d="${SPARK}" fill="${c}"/>`,
  support: (c) => `<path class="sig-mark" d="M32 43.5 C25 38 20.5 34.3 20.5 29 C20.5 25 23.6 22.2 27 22.2 C29.1 22.2 31 23.3 32 25.1 C33 23.3 34.9 22.2 37 22.2 C40.4 22.2 43.5 25 43.5 29 C43.5 34.3 39 38 32 43.5 Z" fill="${c}"/>`,
  curious: (c) => `<g class="sig-mark"><path d="M26.4 27.2 A5.6 5.6 0 1 1 34.8 32.05 Q32 33.7 32 37.2" fill="none" stroke="${c}" stroke-width="4.2" stroke-linecap="round"/><circle cx="32" cy="43.4" r="2.8" fill="${c}"/></g>`,
  watching: (c) => `<g class="sig-mark"><path d="M19.2 32 Q32 20 44.8 32 Q32 44 19.2 32 Z" fill="none" stroke="${c}" stroke-width="3.4" stroke-linejoin="round"/><circle class="sig-pupil" cx="32" cy="32" r="4.6" fill="${c}"/></g>`,
  concerned: (c) => `<g class="sig-mark"><path d="M32 21.5 V34.5" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="42.6" r="3" fill="${c}"/></g>`,
};
export function sigSvg(size = 56, mood = 'idle', { cls = '', dark = false } = {}) {
  const moodCls = MOODS.includes(mood) ? mood : 'idle';
  const c = mood === 'offline' ? '#8E9693' : mood === 'concerned' ? '#E8B75A' : '#D8FF3D';
  const edge = dark ? '' : `<circle cx="32" cy="32" r="24.5" fill="none" stroke="${INK}" stroke-opacity=".35"/><circle cx="32" cy="32" r="17.5" fill="none" stroke="${INK}" stroke-opacity=".35"/>`;
  const mark = MARKS[moodCls] ? MARKS[moodCls](c) : `<circle class="sig-mark sig-dot" cx="32" cy="32" r="7.5" fill="${c}"/>`;
  return `<svg class="sig ${moodCls}${cls ? ` ${esc(cls)}` : ''}" viewBox="0 0 64 64" width="${Number(size)}" height="${Number(size)}" aria-hidden="true">
    <g class="sig-body">${edge}<circle class="sig-ring" cx="32" cy="32" r="21" fill="none" stroke="${c}" stroke-width="6"/>${mark}</g></svg>`;
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
