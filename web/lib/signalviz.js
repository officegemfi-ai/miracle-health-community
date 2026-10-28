// The Signal, drawn: how the number is made (public forums in, members' reports in, one
// number out), the takeover line (how far a Signal has moved from forum data to members'
// data), the certification seals and the split of first-hand reports. Plain SVG strings and
// no imports, so the public library on miraclehealth.us uses the same drawings.

// The levels a Signal earns (the database decides; these are the words and the rules shown).
// The numbers match the default settings in 20261029000100_signal_certification.sql.
export const LEVELS = [
  { key: 'forum', name: 'Forum data', rule: 'Mostly public forums so far' },
  { key: 'early', name: 'Early signal', rule: 'Members’ reports only, still few of them' },
  { key: 'backed', name: 'Community-backed', rule: '25% from members, 10+ first-hand reports', share: 25, reports: 10, voices: 0 },
  { key: 'verified', name: 'Community-verified', rule: '50% from members, 25+ reports from 15+ people', share: 50, reports: 25, voices: 15 },
  { key: 'certified', name: 'Signal Certified', rule: '75% from members, 50+ reports from 30+ people, confidence 60+', share: 75, reports: 50, voices: 30 },
];
export const levelOf = (key) => LEVELS.find((l) => l.key === key) || LEVELS[0];
// The share of a Signal that comes from members after n first-hand reports, when the forums count as w
export const shareAfter = (n, w = 50) => (n > 0 ? (100 * n) / (w + n) : 0);
// The level n first-hand reports would earn a compound with forum data, if each came from a
// different person (and, for Signal Certified, the confidence is there): for the "try it" slider
export function levelAfter(n, w = 50) {
  const sh = shareAfter(n, w);
  const hit = [...LEVELS].reverse().find((l) => l.share != null && sh >= l.share && n >= l.reports && n >= l.voices);
  return hit ? hit.key : 'forum';
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LIME = '#D8FF3D';
const FORUM = '#9FB3C8';
let uidN = 0;
const uid = (p) => `${p}${(uidN += 1)}`;

// ---------------------------------------------------------------------------
// A level as a seal
// ---------------------------------------------------------------------------
function sealInner(key) {
  const k = levelOf(key).key;
  const ring = {
    forum: `<circle cx="16" cy="16" r="12.5" fill="none" stroke="${FORUM}" stroke-opacity=".75" stroke-width="2"/>`,
    early: `<circle cx="16" cy="16" r="12.5" fill="none" stroke="${LIME}" stroke-width="2" stroke-dasharray="3 3.5"/>`,
    backed: `<circle cx="16" cy="16" r="12.5" fill="none" stroke="${LIME}" stroke-opacity=".35" stroke-width="2"/><path d="M16 3.5a12.5 12.5 0 0 1 0 25" fill="none" stroke="${LIME}" stroke-width="2.4" stroke-linecap="round"/>`,
    verified: `<circle cx="16" cy="16" r="12.5" fill="none" stroke="${LIME}" stroke-width="2.4"/><path d="m11 16.4 3.3 3.3 6.7-7.4" fill="none" stroke="${LIME}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    certified: `<path d="M16 2.5l3.1 2.4 3.9-.5 1.5 3.6 3.6 1.5-.5 3.9 2.4 3.1-2.4 3.1.5 3.9-3.6 1.5-1.5 3.6-3.9-.5L16 29.5l-3.1-2.4-3.9.5-1.5-3.6-3.6-1.5.5-3.9L2.5 16l2.4-3.1-.5-3.9 3.6-1.5 1.5-3.6 3.9.5z" fill="${LIME}"/><path d="m11 16.4 3.3 3.3 6.7-7.4" fill="none" stroke="#121E1D" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  }[k];
  const inner = k === 'forum' ? `<text x="16" y="20" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-weight="600" font-size="10.5" fill="${FORUM}">F</text>`
    : k === 'early' ? `<circle cx="16" cy="16" r="3.2" fill="${LIME}"/>` : k === 'backed' ? `<circle cx="16" cy="16" r="4" fill="${LIME}"/>` : '';
  return ring + inner;
}
// disc: on a dark disc, for light backgrounds (the lime would wash out on white)
export function sealSvg(key, size = 28, disc = false) {
  const k = levelOf(key).key;
  const inner = disc ? `<circle cx="16" cy="16" r="16" fill="#121E1D"/><g transform="translate(4.5 4.5) scale(.72)">${sealInner(k)}</g>` : sealInner(k);
  return `<svg class="seal seal-${k}" viewBox="0 0 32 32" width="${size}" height="${size}" role="img" aria-label="${esc(levelOf(k).name)}">${inner}</svg>`;
}
// A seal placed inside a bigger drawing, at (x, y), size px wide
const sealAt = (key, x, y, size) => `<g transform="translate(${x} ${y}) scale(${(size / 32).toFixed(4)})">${sealInner(key)}</g>`;

// ---------------------------------------------------------------------------
// How the number is made: the forums and the members flow in, one number flows out
// ---------------------------------------------------------------------------
// sources: [{ name, n }] (public-source families and how many Signals use each)
// share: 0-100, how much of the Signals comes from members here on average
// reports, sames, signals: counts; levels: { forum: n, early: n, ... }
export function flowSvg({ sources = [], share = 0, reports = 0, sames = 0, signals = 0, levels = {}, weight = 50 }, { compact = false } = {}) {
  const s = Math.max(0, Math.min(100, Number(share) || 0)) / 100;
  const src = sources.slice(0, 4);
  while (src.length < 4) src.push({ name: '', n: 0 });
  const total = src.reduce((a, x) => a + (x.n || 0), 0) || 1;
  const forumW = 3 + 18 * (1 - s);
  const memberW = Math.max(2, 3 + 18 * s);
  const id = uid('fl');
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const level = (k) => Number(levels[k] || 0);
  const ladder = (gap, size) => LEVELS.map((l, i) => `${sealAt(l.key, i * gap, 0, size)}<text x="${i * gap + size / 2}" y="${size + 14}" text-anchor="middle" class="t-mono" font-size="10" fill="#FCFCFC" fill-opacity=".85">${level(l.key)}</text>`).join('');
  const defs = `<defs>
    <radialGradient id="${id}-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${LIME}" stop-opacity=".24"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient>
  </defs>`;
  // The engine: the formula as a ring (65 what happened, 15 agreement, 10 voices, 10 volume) and the share inside
  const engine = (cx, cy, r) => {
    const C = 2 * Math.PI * r;
    const parts = [[0.65, LIME], [0.15, '#B8E62A'], [0.10, '#9BE35A'], [0.10, '#6EE7B7']];
    let off = 0;
    const arcs = parts.map(([f, c]) => {
      const len = Math.max(0, f * C - 4);
      const a = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="13" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`;
      off += f * C;
      return a;
    }).join('');
    return `<circle cx="${cx}" cy="${cy}" r="${r + 40}" fill="url(#${id}-glow)"/>
      <circle class="spin" cx="${cx}" cy="${cy}" r="${r + 20}" fill="none" stroke="${LIME}" stroke-opacity=".3" stroke-width="1.3" stroke-dasharray="2 7" transform-origin="${cx} ${cy}"/>
      ${arcs}
      <circle cx="${cx}" cy="${cy}" r="${r - 13}" fill="#0C1413"/>
      <text x="${cx}" y="${cy - 22}" text-anchor="middle" class="t-mono" font-size="9" letter-spacing="1.2" fill="${FORUM}">${Math.round((1 - s) * 100)}% FORUMS</text>
      <text x="${cx}" y="${cy + 11}" text-anchor="middle" class="t-head" font-size="${compact ? 32 : 38}" fill="${LIME}">${Math.round(s * 100)}%</text>
      <text x="${cx}" y="${cy + 29}" text-anchor="middle" class="t-mono" font-size="9" letter-spacing="1.2" fill="#FCFCFC" fill-opacity=".75">FROM MEMBERS</text>`;
  };
  const pill = (x, y, w, hgt, label, sub, member) => `<g>
      <rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="${hgt / 2}" fill="${member ? 'rgba(216,255,61,.12)' : '#16231F'}" stroke="${member ? LIME : 'rgba(255,255,255,.16)'}" stroke-opacity="${member ? 0.65 : 1}"/>
      <circle cx="${x + hgt / 2}" cy="${y + hgt / 2}" r="${hgt / 2 - 8}" fill="${member ? LIME : 'rgba(159,179,200,.2)'}"/>
      <text x="${x + hgt / 2}" y="${y + hgt / 2 + 4.5}" text-anchor="middle" class="t-mono" font-size="12" font-weight="600" fill="${member ? '#121E1D' : FORUM}">${esc((label || ' ')[0])}</text>
      <text x="${x + hgt + 2}" y="${y + hgt / 2 - 1}" class="t-head" font-size="15" fill="#FCFCFC">${esc(label)}</text>
      <text x="${x + hgt + 2}" y="${y + hgt / 2 + 14}" class="t-mono" font-size="10" fill="#FCFCFC" fill-opacity=".62">${esc(sub)}</text>
    </g>`;
  const stream = (d, width, color, cls) => {
    const waiting = cls === 'm' && s === 0;
    return `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${waiting ? 0.18 : 0.26}" stroke-width="${width.toFixed(1)}" stroke-linecap="round"/>
      <path class="flow ${cls}" d="${d}" fill="none" stroke="${color}" stroke-width="${waiting ? 2 : 3.2}" stroke-linecap="round" stroke-dasharray="${waiting ? '0.5 12.5' : '0.5 12.5'}"/>`;
  };
  const head = (x, y, text, color) => `<text x="${x}" y="${y}" class="t-mono" font-size="10" letter-spacing="1.4" fill="${color}">${text}</text>`;
  const card = (x, y, wd, ht, big) => `<g transform="translate(${x} ${y})">
      <rect width="${wd}" height="${ht}" rx="16" fill="#101817" stroke="${LIME}" stroke-opacity=".4"/>
      <text x="16" y="26" class="t-mono" font-size="10" letter-spacing="1.4" fill="${LIME}">THE SIGNAL</text>
      <text x="16" y="${big ? 66 : 58}" class="t-head" font-size="${big ? 38 : 30}" fill="#FCFCFC">${fmt(signals)}</text>
      <text x="16" y="${big ? 86 : 76}" class="t-mono" font-size="9.5" fill="#FCFCFC" fill-opacity=".65">NUMBERS, 0–100</text>
      <g transform="translate(${big ? 14 : wd - 158} ${big ? 104 : 22})">${ladder(30, 22)}</g>
    </g>`;
  const label = `How the Signal is made: public forums and members' first-hand reports feed one number per compound. Right now ${Math.round(s * 100)}% of it comes from members.`;

  if (!compact) {
    const W = 748; const H = 330;
    const cx = 428; const cy = 168; const r = 82;
    const ys = [32, 88, 144, 200];
    const streams = src.map((x, i) => {
      const y0 = ys[i] + 22;
      const y1 = cy - 34 + i * 15;
      const w = forumW * ((x.n || 0) / total) * 2.2;
      return { x, y: ys[i], d: `M212 ${y0} C 290 ${y0}, ${cx - r - 86} ${y1}, ${cx - r - 16} ${y1}`, w: Math.max(1.2, Math.min(16, w)) };
    });
    const memberD = `M212 290 C 300 290, ${cx - r - 70} ${cy + 52}, ${cx - r - 12} ${cy + 40}`;
    const outD = `M${cx + r + 16} ${cy} C ${cx + r + 40} ${cy}, 540 ${cy}, 566 ${cy}`;
    return `<svg class="flowviz" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
      ${defs}
      ${head(12, 20, `PUBLIC FORUMS · ${weight} REPORTS EACH`, FORUM)}
      ${streams.map((p) => stream(p.d, p.w, FORUM, 'f')).join('')}
      ${stream(memberD, memberW, LIME, 'm')}
      ${stream(outD, 7, LIME, 'o')}
      ${streams.map((p) => (p.x.name ? pill(12, p.y, 200, 44, p.x.name, `${p.x.n} Signal${p.x.n === 1 ? '' : 's'} start here`, false) : '')).join('')}
      ${head(12, 262, 'MEMBERS HERE · FIRST-HAND', LIME)}
      ${pill(12, 268, 200, 46, `${fmt(reports)} report${reports === 1 ? '' : 's'}`, `+ ${fmt(sames)} “same for me”`, true)}
      ${engine(cx, cy, r)}
      <text x="${cx}" y="${cy + r + 46}" text-anchor="middle" class="t-mono" font-size="9.5" letter-spacing="1" fill="#FCFCFC" fill-opacity=".55">65 WHAT HAPPENED · 15 AGREEMENT · 10 VOICES · 10 VOLUME</text>
      ${card(566, cy - 78, 170, 156, true)}
    </svg>`;
  }
  // Phones, a funnel: the forums come down the sides, members straight down the middle, the
  // engine mixes them and the number comes out at the bottom
  const W = 360; const H = 508;
  const cx = 180; const cy = 318; const r = 60; const R = r + 14;
  const pos = [[8, 28], [184, 28], [8, 76], [184, 76]];
  const lane = [46, 314, 76, 284];        // where each forum's stream runs down
  const angle = [-62, 62, -38, 38];       // and where it meets the engine (degrees from the top)
  const streams = src.map((x, i) => {
    const [px, py] = pos[i];
    const x0 = lane[i]; const y0 = py + 40;
    const a = (angle[i] * Math.PI) / 180;
    const tx = cx + R * Math.sin(a); const ty = cy - R * Math.cos(a);
    const ux = (cx - tx) / R; const uy = (cy - ty) / R;
    const w = forumW * ((x.n || 0) / total) * 2;
    return { x, px, py, d: `M${x0} ${y0} C ${x0} ${(y0 + (ty - y0) * 0.62).toFixed(1)}, ${(tx - 38 * ux).toFixed(1)} ${(ty - 38 * uy).toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`, w: Math.max(1.2, Math.min(14, w)) };
  });
  const my = 162;                          // the members' pill
  const memberD = `M${cx} ${my + 46} L${cx} ${cy - R}`;
  const outD = `M${cx} ${cy + R} L${cx} ${cy + R + 26}`;
  const oy = cy + R + 26;                  // the number's card
  return `<svg class="flowviz compact" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
    ${defs}
    ${head(8, 18, `PUBLIC FORUMS · ${weight} REPORTS EACH`, FORUM)}
    ${streams.map((p) => stream(p.d, p.w, FORUM, 'f')).join('')}
    ${stream(memberD, memberW, LIME, 'm')}
    ${stream(outD, 6, LIME, 'o')}
    ${streams.map((p) => (p.x.name ? pill(p.px, p.py, 168, 40, p.x.name, `${p.x.n} Signal${p.x.n === 1 ? '' : 's'}`, false) : '')).join('')}
    <text x="${cx}" y="${my - 8}" text-anchor="middle" class="t-mono" font-size="9.5" letter-spacing="1.3" fill="${LIME}">MEMBERS HERE · FIRST-HAND</text>
    ${pill(cx - 82, my, 164, 46, `${fmt(reports)} report${reports === 1 ? '' : 's'}`, `+ ${fmt(sames)} “same for me”`, true)}
    ${engine(cx, cy, r)}
    <g transform="translate(${cx - 120} ${oy})">
      <rect width="240" height="84" rx="16" fill="#101817" stroke="${LIME}" stroke-opacity=".4"/>
      <text x="16" y="24" class="t-mono" font-size="9.5" letter-spacing="1.3" fill="${LIME}">THE SIGNAL</text>
      <text x="16" y="58" class="t-head" font-size="30" fill="#FCFCFC">${fmt(signals)}</text>
      <text x="16" y="74" class="t-mono" font-size="8.5" fill="#FCFCFC" fill-opacity=".6">NUMBERS, 0–100</text>
      <g transform="translate(112 26)">${LEVELS.map((l, i) => `${sealAt(l.key, i * 23, 0, 17)}<text x="${i * 23 + 8.5}" y="32" text-anchor="middle" class="t-mono" font-size="9" fill="#FCFCFC" fill-opacity=".85">${level(l.key)}</text>`).join('')}</g>
    </g>
  </svg>`;
}

// ---------------------------------------------------------------------------
// The takeover line: share of a Signal from members, by first-hand reports. The forums
// count as w reports, so after n reports members make up n / (w + n) of the number.
// ---------------------------------------------------------------------------
// points: [{ share: 0-100, level, label }]; w: what the forums count as; you: a point to call
// out ({ share, label } or { n, label } for a number of reports); still: don't draw the line in
export function takeoverSvg({ w = 50, points = [], max = 300, you = null } = {}, { compact = false, still = false, width = 0 } = {}) {
  const W = width || (compact ? 360 : 720); const H = compact ? 230 : 250;
  const L = compact ? 34 : 54; const R = compact ? 14 : 24; const T = 18; const B = compact ? 40 : 44;
  const pw = W - L - R; const ph = H - T - B;
  const X = (n) => L + (Math.min(n, max) / max) * pw;
  const Y = (share) => T + ph - (share / 100) * ph;
  const id = uid('tk');
  const curve = [];
  for (let n = 0; n <= max; n += max / 120) curve.push([X(n), Y((100 * n) / (w + n))]);
  const d = curve.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${d} L${X(max).toFixed(1)} ${Y(0)} L${X(0)} ${Y(0)} Z`;
  const above = `${d} L${X(max).toFixed(1)} ${Y(100)} L${X(0)} ${Y(100)} Z`;
  // The three thresholds: a dashed line across, named at the right end (under the curve there,
  // so the names never sit on the line), and the number of reports that reaches each
  const marks = [[25, 'Community-backed', 'Backed'], [50, 'Community-verified', 'Verified'], [75, 'Signal Certified', 'Certified']].map(([t, name, short]) => {
    const n = (w * t) / (100 - t);
    return `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="#FCFCFC" stroke-opacity=".14" stroke-dasharray="3 5"/>
      <line x1="${X(n)}" x2="${X(n)}" y1="${Y(t)}" y2="${Y(0)}" stroke="${LIME}" stroke-opacity=".28" stroke-dasharray="2 4"/>
      <circle cx="${X(n)}" cy="${Y(t)}" r="3.4" fill="${LIME}"/>
      <text x="${W - R - 4}" y="${Y(t) - 5}" text-anchor="end" class="t-mono" font-size="${compact ? 8 : 9}" fill="#FCFCFC" fill-opacity=".72">${t}% · ${(compact ? short : name).toUpperCase()}</text>
      <text x="${X(n)}" y="${Y(0) + 14}" text-anchor="middle" class="t-mono" font-size="${compact ? 8 : 9}" fill="${LIME}" fill-opacity=".85">${Math.round(n)}</text>`;
  }).join('');
  // Signals on the line: where their share puts them
  const groups = new Map();
  points.forEach((p) => {
    const sh = Math.max(0, Math.min(99, Number(p.share) || 0));
    const key = Math.round(sh);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  const dots = [...groups.entries()].map(([sh, list]) => {
    const n = (w * sh) / (100 - sh);
    const x = X(n); const y = Y(sh);
    const many = list.length > 1;
    return `<g class="tk-dot"><circle class="pulse" cx="${x}" cy="${y}" r="${many ? 9 : 6}" fill="${LIME}" fill-opacity=".25"/><circle cx="${x}" cy="${y}" r="${many ? 5.5 : 4}" fill="${LIME}" stroke="#0C1413" stroke-width="1.5"/>${many ? `<text x="${x + 12}" y="${y - 10}" class="t-mono" font-size="9.5" fill="#FCFCFC">${list.length} SIGNALS</text>` : ''}</g>`;
  }).join('');
  // The point to call out, labelled below and to the right (under the curve, off the line)
  const youMark = you ? (() => {
    const byN = you.n != null;
    const n = byN ? Math.max(0, Number(you.n) || 0) : (w * Math.max(0, Math.min(99, Number(you.share) || 0))) / (100 - Math.max(0, Math.min(99, Number(you.share) || 0)));
    const sh = byN ? shareAfter(n, w) : Math.max(0, Math.min(99, Number(you.share) || 0));
    const x = X(n); const y = Y(sh);
    const text = `${esc(you.label || 'NOW')} · ${Math.round(sh)}%`;
    const tw = text.length * (compact ? 5.6 : 6.2);
    const tx = x + 14 + tw > W - R ? x - 14 - tw : x + 14;
    return `<g class="tk-you">${byN ? `<line x1="${x}" x2="${x}" y1="${y}" y2="${Y(0)}" stroke="${LIME}" stroke-width="1.4" stroke-dasharray="3 3"/>` : ''}
      <circle class="pulse" cx="${x}" cy="${y}" r="11" fill="${LIME}" fill-opacity=".3"/><circle cx="${x}" cy="${y}" r="6" fill="${LIME}" stroke="#0C1413" stroke-width="2"/>
      <text x="${tx}" y="${Math.min(y + 20, Y(0) - 8)}" class="t-mono" font-size="${compact ? 9 : 10}" font-weight="600" fill="${LIME}">${text}</text></g>`;
  })() : '';
  const yTicks = [0, 25, 50, 75, 100].map((t) => `<text x="${L - 8}" y="${Y(t) + 3}" text-anchor="end" class="t-mono" font-size="${compact ? 8 : 9}" fill="#FCFCFC" fill-opacity=".5">${t}%</text>`).join('');
  return `<svg class="takeover${still ? ' still' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="The takeover line: the forums count as ${w} reports, so a Signal is 50% members' data after ${w} first-hand reports and 75% after ${w * 3}.">
    <defs>
      <linearGradient id="${id}-a" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${LIME}" stop-opacity=".32"/><stop offset="1" stop-color="${LIME}" stop-opacity=".02"/></linearGradient>
      <pattern id="${id}-h" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${FORUM}" stroke-opacity=".16" stroke-width="2"/></pattern>
    </defs>
    <path d="${above}" fill="url(#${id}-h)"/>
    <path d="${area}" fill="url(#${id}-a)"/>
    ${yTicks}
    ${marks}
    <path class="draw" d="${d}" fill="none" stroke="${LIME}" stroke-width="2.8" stroke-linecap="round" pathLength="1" stroke-dasharray="1 1"/>
    <line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="#FCFCFC" stroke-opacity=".3"/>
    <text x="${X(max * (compact ? 0.56 : 0.62))}" y="${Y(compact ? 93 : 93)}" class="t-mono" font-size="9.5" fill="${FORUM}" fill-opacity=".9">FORUM DATA</text>
    <text x="${X(max * (compact ? 0.56 : 0.62))}" y="${Y(9)}" class="t-mono" font-size="9.5" fill="${LIME}">MEMBERS’ DATA</text>
    ${dots}${youMark}
    <text x="${L + pw / 2}" y="${H - 8}" text-anchor="middle" class="t-mono" font-size="${compact ? 8.5 : 9.5}" fill="#FCFCFC" fill-opacity=".62">FIRST-HAND REPORTS FOR ONE COMPOUND →</text>
  </svg>`;
}

// ---------------------------------------------------------------------------
// How first-hand reports went: better, about the same, worse
// ---------------------------------------------------------------------------
export function splitBar({ better = 0, same = 0, worse = 0 } = {}) {
  const n = better + same + worse;
  const box = document.createElement('div');
  box.className = 'split';
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `${better} better, ${same} about the same, ${worse} worse`);
  [['b', better], ['s', same], ['w', worse]].forEach(([c, k]) => {
    const part = document.createElement('span');
    part.className = c;
    part.style.width = `${n ? (100 * k) / n : 0}%`;   // set through the DOM: the pages allow no inline styles
    box.append(part);
  });
  return box;
}

// ---------------------------------------------------------------------------
// A radar: one spoke per goal (values 0-1), with layers drawn in order: an outline for what
// studies look at, a fill for what members report. The shapes grow from the middle.
// ---------------------------------------------------------------------------
// axes: [{ id, label }]; layers: [{ values: { id: 0-1 }, cls: 'studied' | 'members' | 'forums', label }]
export function radarSvg({ axes = [], layers = [] } = {}, { size = 340, labels = true, title = 'Radar' } = {}) {
  const n = axes.length;
  if (!n) return '';
  const pad = labels ? 64 : 8;
  const W = size + (labels ? 60 : 0); const H = size;
  const cx = W / 2; const cy = H / 2; const R = size / 2 - pad + (labels ? 14 : 0);
  const at = (i, v) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + R * v * Math.cos(a), cy + R * v * Math.sin(a)];
  };
  const poly = (vals) => vals.map((v, i) => at(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
  const rings = [0.25, 0.5, 0.75, 1].map((r) => `<polygon points="${poly(axes.map(() => r))}" fill="none" stroke="currentColor" stroke-opacity="${r === 1 ? 0.28 : 0.12}"/>`).join('');
  const spokes = axes.map((_, i) => { const [x, y] = at(i, 1); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="currentColor" stroke-opacity=".12"/>`; }).join('');
  const shapes = layers.map((l) => {
    const vals = axes.map((a) => Math.max(0, Math.min(1, Number(l.values?.[a.id]) || 0)));
    if (!vals.some((v) => v > 0)) return '';
    const dots = vals.map((v, i) => (v > 0 ? `<circle cx="${at(i, v)[0].toFixed(1)}" cy="${at(i, v)[1].toFixed(1)}" r="3"/>` : '')).join('');
    return `<g class="rd-layer rd-${esc(l.cls || 'studied')}" transform-origin="${cx} ${cy}"><polygon points="${poly(vals)}"/>${dots}</g>`;
  }).join('');
  const text = labels ? axes.map((a, i) => {
    const [x, y] = at(i, 1.13);
    const anchor = Math.abs(x - cx) < 6 ? 'middle' : x > cx ? 'start' : 'end';
    const dy = y < cy - R * 0.9 ? -2 : y > cy + R * 0.9 ? 10 : 4;
    return `<text x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}" class="rd-label">${esc(a.label)}</text>`;
  }).join('') : '';
  return `<svg class="radar" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${rings}${spokes}${shapes}${text}</svg>`;
}

// ---------------------------------------------------------------------------
// A rose: the radar for sparse data. Each goal gets a slice, and each layer a petal in it
// whose length is its value (0-1), side by side, so a compound used for two things shows
// two clear petals instead of a collapsed polygon.
// ---------------------------------------------------------------------------
// axes: [{ id, label }]; layers: [{ values: { id: 0-1 }, cls }]
export function roseSvg({ axes = [], layers = [] } = {}, { size = 340, labels = true, title = 'Rose' } = {}) {
  const n = axes.length;
  if (!n) return '';
  const W = size + (labels ? 70 : 0); const H = size + (labels ? 10 : 0);
  const cx = W / 2; const cy = H / 2;
  const R = size / 2 - (labels ? 46 : 6); const r0 = R * 0.16;
  const slice = (2 * Math.PI) / n;
  const k = Math.max(1, layers.length);
  const width = (slice * 0.9) / k;
  const pt = (a, r) => [cx + r * Math.cos(a), cy + r * Math.sin(a)].map((x) => x.toFixed(1)).join(' ');
  const petal = (a0, a1, r) => `M${pt(a0, r0)} L${pt(a0, r)} A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${pt(a1, r)} L${pt(a1, r0)} A${r0.toFixed(1)} ${r0.toFixed(1)} 0 0 0 ${pt(a0, r0)} Z`;
  const rings = [0.25, 0.5, 0.75, 1].map((f) => `<circle cx="${cx}" cy="${cy}" r="${(r0 + (R - r0) * f).toFixed(1)}" fill="none" stroke="currentColor" stroke-opacity="${f === 1 ? 0.26 : 0.1}"/>`).join('')
    + `<circle cx="${cx}" cy="${cy}" r="${r0.toFixed(1)}" fill="none" stroke="currentColor" stroke-opacity=".18"/>`;
  const spokes = axes.map((_, i) => {
    const a = -Math.PI / 2 + slice * (i + 0.5);
    return `<line x1="${pt(a, r0).split(' ')[0]}" y1="${pt(a, r0).split(' ')[1]}" x2="${pt(a, R).split(' ')[0]}" y2="${pt(a, R).split(' ')[1]}" stroke="currentColor" stroke-opacity=".08"/>`;
  }).join('');
  const shapes = layers.map((l, j) => {
    const paths = axes.map((ax, i) => {
      const v = Math.max(0, Math.min(1, Number(l.values?.[ax.id]) || 0));
      if (!v) return '';
      const mid = -Math.PI / 2 + slice * i;
      const a0 = mid - (slice * 0.9) / 2 + width * j; const a1 = a0 + width;
      return `<path d="${petal(a0, a1, r0 + (R - r0) * v)}"/>`;
    }).join('');
    return paths ? `<g class="rd-layer rd-${esc(l.cls || 'studied')}" transform-origin="${cx} ${cy}">${paths}</g>` : '';
  }).join('');
  const text = labels ? axes.map((a, i) => {
    const ang = -Math.PI / 2 + slice * i;
    const x = cx + (R + 16) * Math.cos(ang); const y = cy + (R + 16) * Math.sin(ang);
    const anchor = Math.abs(x - cx) < 8 ? 'middle' : x > cx ? 'start' : 'end';
    const dy = y < cy - R * 0.8 ? -2 : y > cy + R * 0.8 ? 10 : 4;
    return `<text x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}" class="rd-label">${esc(a.label)}</text>`;
  }).join('') : '';
  return `<svg class="radar rose" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${rings}${spokes}${shapes}${text}</svg>`;
}
