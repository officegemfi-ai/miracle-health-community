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
export const PLACES = [['library', 'Library'], ['ai', 'Miracle AI'], ['community', 'Community'], ['my', 'My Miracle']];
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
// Miracle AI with a question typed in, not sent: they read it, change it, then send it
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
  strong: [4, 'Strong evidence', 'Several randomized trials in people, or an approved drug for this use'],
  moderate: [3, 'Moderate evidence', 'At least one good randomized trial in people, or several smaller ones'],
  limited: [2, 'Limited evidence', 'Small, short or uncontrolled studies in people'],
  preclinical: [1, 'Animal and lab studies', 'Studied in animals or cells, not in people'],
  anecdotal: [0, 'Anecdotal', 'User reports only'],
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
// Compound tiles (initials on ink, in the category's color) and chips
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
// space: { name, category, kind, part_ids } (a community space, or a Library compound)
export function tileSvg(space, size = 32) {
  const color = esc(catColor(space?.category));
  if (space?.kind === 'stack') {
    // A stack: layered plates, with how many compounds are in it
    const n = (space.part_ids || []).length || '';
    return `<svg class="tile mh-tile" viewBox="0 0 32 32" width="${Number(size)}" height="${Number(size)}" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#121E1D"/><rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="${color}" stroke-opacity=".45"/>
      <path d="M9 13.5 16 10l7 3.5-7 3.5z" fill="${color}"/><path d="m9 17.5 7 3.5 7-3.5" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/>
      <path d="m9 21 7 3.5 7-3.5" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".45"/>
      ${n ? `<circle cx="25" cy="7" r="5" fill="${color}"/><text x="25" y="9.6" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-weight="600" font-size="7.5" fill="#121E1D">${Number(n)}</text>` : ''}</svg>`;
  }
  const txt = initials(space?.name || space?.compound_name || space?.id).replace(/[^A-Z0-9]/g, '');
  const fs = txt.length > 2 ? 11 : 13;
  return `<svg class="tile mh-tile" viewBox="0 0 32 32" width="${Number(size)}" height="${Number(size)}" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="#121E1D"/><rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="${color}" stroke-opacity=".35"/>
    <text x="16" y="20.5" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-weight="600" font-size="${fs}" fill="${color}">${txt}</text></svg>`;
}
// A compound: its tile, name, evidence meter and Signal, and a short line about its part in a
// plan or stack. href makes the whole chip a link.
export function chipHtml({ name = '', href = '', category = '', kind = '', grade = '', signal = '', role = '', tile = true, cls = '' } = {}) {
  const tag = href ? 'a' : 'span';
  return `<${tag} class="mh-chip${cls ? ` ${esc(cls)}` : ''}"${href ? ` href="${esc(href)}"` : ''}>${tile ? tileSvg({ name, category, kind }, 28) : ''}<span class="mh-chip-t"><span class="mh-chip-n"><span class="mh-chip-name">${esc(name)}</span>${meterHtml(grade)}${signal}</span>${role ? `<span class="mh-chip-r">${esc(role)}</span>` : ''}</span></${tag}>`;
}

// ---------------------------------------------------------------------------
// Sig, the Community Signal in person: a muscle fibre in the brand's lime, in every mood. Fine
// strands, alternately darker and lighter, run from a white tendon at the tip and fan over the
// belly; three soft grooves split it into four bundles. Small Sigs keep fewer strands.
// dark: drawn on a dark page (a deeper shadow)
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
// Extras around Sig: sparkles, a heart, watching waves (in lime on a dark page)
const EXTRAS = {
  cheer: (ink) => `<g class="sig-spark" fill="${ink}"><path d="M8 12 9.2 15.2 12.4 16.4 9.2 17.6 8 20.8 6.8 17.6 3.6 16.4 6.8 15.2z"/><path d="M56 22 56.9 24.4 59.3 25.3 56.9 26.2 56 28.6 55.1 26.2 52.7 25.3 55.1 24.4z"/><circle cx="54" cy="9" r="1.6"/><circle cx="11" cy="29" r="1.3"/></g>`,
  support: () => '<path class="sig-heart" d="M53 13.5c-1.6-3.2-6.4-2.2-6.4 1.3 0 2.7 3.3 4.8 6.4 7.2 3.1-2.4 6.4-4.5 6.4-7.2 0-3.5-4.8-4.5-6.4-1.3z" fill="#FF6F86"/>',
  watching: (ink) => `<g class="sig-waves" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"><path d="M50 12a8 8 0 0 1 6 6"/><path d="M50 7a13 13 0 0 1 11 11"/></g>`,
};
export const MOODS = ['idle', 'happy', 'think', 'sleepy', 'watching', 'curious', 'concerned', 'cheer', 'support', 'offline', 'burst'];
const MOOD_FACE = { idle: 'idle', happy: 'happy', think: 'think', sleepy: 'sleepy', watching: 'watching', curious: 'curious', concerned: 'concerned', cheer: 'happy', support: 'happy', offline: 'sleepy', burst: 'happy' };
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
let uid = 0;
export function sigSvg(size = 56, mood = 'idle', { cls = '', dark = false, id = '' } = {}) {
  const g = id || `mhsig${++uid}`;
  const face = FACES[MOOD_FACE[mood] || 'idle'];
  const off = mood === 'offline';
  const stops = off
    ? '<stop offset="0" stop-color="#C9CFCC"/><stop offset="1" stop-color="#8E9693"/>'
    : '<stop offset="0" stop-color="#F2FFB3"/><stop offset=".5" stop-color="#D8FF3D"/><stop offset="1" stop-color="#9BE35A"/>';
  const m = muscle(g, off, size >= 36);
  const moodCls = MOODS.includes(mood) ? mood : 'idle';
  return `<svg class="sig ${moodCls}${cls ? ` ${esc(cls)}` : ''}" viewBox="0 0 64 64" width="${Number(size)}" height="${Number(size)}" aria-hidden="true">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>
    <radialGradient id="${g}h" cx=".35" cy=".28" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>${m.defs}</defs>
    <ellipse class="sig-shadow" cx="32" cy="61" rx="13" ry="2.2" fill="${dark ? '#000' : INK}" opacity="${dark ? 0.3 : 0.14}"/>
    <g class="sig-body">
      <path d="${DROP}" fill="url(#${g})"/>
      ${m.body}
      <path d="${DROP}" fill="url(#${g}h)"/>
      <path d="${DROP}" fill="none" stroke="#121E1D" stroke-opacity=".18" stroke-width="1"/>
      <circle class="sig-node" cx="32" cy="9.2" r="3.1" fill="#fff"/>
      <g class="sig-face">${face}</g>
      <circle cx="19.8" cy="44.5" r="2.4" fill="#FF8FA3" opacity=".45"/><circle cx="44.2" cy="44.5" r="2.4" fill="#FF8FA3" opacity=".45"/>
    </g>${EXTRAS[mood] ? EXTRAS[mood](dark ? '#D8FF3D' : INK) : ''}</svg>`;
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
