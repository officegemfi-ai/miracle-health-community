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
// Drawn as an instrument: slim inputs with ports, smooth curves that meet the dial square on,
// particles that flow along them (SMIL, so no script; hidden for reduced motion by the page's
// CSS via .pt), a dial that shows only the members-versus-forums share, the formula as its own
// segmented bar, and the output card with the levels as a stacked bar and seals.
export function flowSvg({ sources = [], share = 0, reports = 0, sames = 0, signals = 0, levels = {}, weight = 50 }, { compact = false } = {}) {
  const s = Math.max(0, Math.min(100, Number(share) || 0)) / 100;
  const src = sources.slice(0, 4);
  while (src.length < 4) src.push({ name: '', n: 0 });
  const total = src.reduce((a, x) => a + (x.n || 0), 0) || 1;
  const id = uid('fl');
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const level = (k) => Number(levels[k] || 0);
  const pct = Math.round(s * 100);
  const f1 = (n) => Number(n).toFixed(1);
  const rad = (deg) => (deg * Math.PI) / 180;
  const WHITE = '#FCFCFC';

  // Particles along a path: n dots, evenly spaced in time, fading in and out at the ends
  const dots = (pid, n, dur, color, r = 2.1) => Array.from({ length: n }, (_, i) => {
    const b = `${f1((-i * dur) / n)}s`;
    return `<circle class="pt" r="${r}" fill="${color}" opacity="0"><animateMotion dur="${dur}s" begin="${b}" repeatCount="indefinite"><mpath href="#${pid}" xlink:href="#${pid}"/></animateMotion><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.15;.8;1" dur="${dur}s" begin="${b}" repeatCount="indefinite"/></circle>`;
  }).join('');
  // A wire: a faint track, the visible line, a port where it lands, and its particles
  const wire = (pid, d, color, width, n, dur, end, still) => `<path id="${pid}" d="${d}" fill="none" stroke="${color}" stroke-opacity="${still ? 0.16 : 0.12}" stroke-width="${f1(width + 5)}" stroke-linecap="round"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-opacity="${still ? 0.3 : 0.62}" stroke-width="${f1(width)}" stroke-linecap="round"${still ? ' stroke-dasharray="2 5"' : ''}/>
      ${end ? `<circle cx="${f1(end[0])}" cy="${f1(end[1])}" r="2.6" fill="${color}" fill-opacity="${still ? 0.4 : 0.9}"/>` : ''}
      ${still ? '' : dots(pid, n, dur, color)}`;
  const head = (x, y, text, color, anchor = 'start') => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="t-mono" font-size="9.5" letter-spacing="1.4" fill="${color}">${text}</text>`;

  // An input: a slim row with an initial tile, the name, how many Signals use it, and a port
  const chip = (x, y, w, name, n, portX, portY) => `<g>
      <rect x="${x}" y="${y}" width="${w}" height="40" rx="11" fill="#121B19"/>
      <rect x="${x}" y="${y}" width="${w}" height="40" rx="11" fill="${WHITE}" fill-opacity=".035" stroke="${WHITE}" stroke-opacity=".1"/>
      <rect x="${x + 8}" y="${y + 8}" width="24" height="24" rx="7" fill="${FORUM}" fill-opacity=".14"/>
      <text x="${x + 20}" y="${y + 24}" text-anchor="middle" class="t-mono" font-size="11" font-weight="600" fill="${FORUM}">${esc((name || ' ')[0])}</text>
      <text x="${x + 42}" y="${y + 18}" class="t-head" font-size="13.5" fill="${WHITE}">${esc(name)}</text>
      <text x="${x + 42}" y="${y + 31}" class="t-mono" font-size="9" letter-spacing=".5" fill="${WHITE}" fill-opacity=".55">IN ${fmt(n)} SIGNAL${n === 1 ? '' : 'S'}</text>
      <circle cx="${portX}" cy="${portY}" r="3" fill="#0C1413" stroke="${FORUM}" stroke-width="1.4"/>
    </g>`;
  const member = (x, y, w, portX, portY) => `<g>
      <rect x="${x}" y="${y}" width="${w}" height="48" rx="13" fill="#121B19"/>
      <rect x="${x}" y="${y}" width="${w}" height="48" rx="13" fill="${LIME}" fill-opacity=".07" stroke="${LIME}" stroke-opacity=".5"/>
      <circle cx="${x + 24}" cy="${y + 24}" r="11" fill="none" stroke="${LIME}" stroke-width="1.6"/>
      <circle cx="${x + 24}" cy="${y + 24}" r="4.2" fill="${LIME}"/>
      <text x="${x + 44}" y="${y + 21}" class="t-head" font-size="14" fill="${WHITE}">${fmt(reports)} first-hand report${reports === 1 ? '' : 's'}</text>
      <text x="${x + 44}" y="${y + 36}" class="t-mono" font-size="9" letter-spacing=".5" fill="${LIME}" fill-opacity=".85">+ ${fmt(sames)} “SAME FOR ME”</text>
      <circle cx="${portX}" cy="${portY}" r="3" fill="#0C1413" stroke="${LIME}" stroke-width="1.4"/>
    </g>`;

  // The dial: the members' share in lime, the forums' in blue-grey, a tick ring, a slow orbit
  const dial = (cx, cy, r, big) => {
    const C = 2 * Math.PI * r;
    const gap = s > 0 && s < 1 ? 3 : 0;
    const mLen = Math.max(0, s * C - gap);
    const fLen = Math.max(0, (1 - s) * C - gap);
    const ticks = Array.from({ length: 60 }, (_, i) => {
      const a = rad(i * 6); const major = i % 15 === 0;
      const r1 = r + 11; const r2 = r + (major ? 19 : 14);
      return `<line x1="${f1(cx + r1 * Math.sin(a))}" y1="${f1(cy - r1 * Math.cos(a))}" x2="${f1(cx + r2 * Math.sin(a))}" y2="${f1(cy - r2 * Math.cos(a))}" stroke="${WHITE}" stroke-opacity="${major ? 0.42 : 0.13}" stroke-width="${major ? 1.4 : 1}"/>`;
    }).join('');
    const arc = (len, off, color, width, op) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-opacity="${op}" stroke-width="${width}" stroke-linecap="${gap ? 'round' : 'butt'}" stroke-dasharray="${f1(len)} ${f1(C)}" stroke-dashoffset="${f1(-off)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    return `<circle cx="${cx}" cy="${cy}" r="${r + 64}" fill="url(#${id}-glow)"/>
      ${ticks}
      <circle class="spin" cx="${cx}" cy="${cy}" r="${r + 28}" fill="none" stroke="${LIME}" stroke-opacity=".22" stroke-width="1" stroke-dasharray="1.5 7" transform-origin="${cx} ${cy}"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${WHITE}" stroke-opacity=".06" stroke-width="11"/>
      ${fLen > 0 ? arc(fLen, s * C + gap / 2, FORUM, 11, 0.5) : ''}
      ${mLen > 0 ? `${arc(mLen, gap / 2, LIME, 22, 0.13)}${arc(mLen, gap / 2, LIME, 11, 1)}` : `<circle cx="${cx}" cy="${cy - r}" r="3.4" fill="${LIME}"/>`}
      <circle cx="${cx}" cy="${cy}" r="${r - 15}" fill="url(#${id}-core)" stroke="${WHITE}" stroke-opacity=".07"/>
      <text x="${cx}" y="${cy + (big ? 6 : 3)}" text-anchor="middle" class="t-head" font-size="${big ? 40 : 30}" fill="${LIME}">${pct}%</text>
      <text x="${cx}" y="${cy + (big ? 23 : 17)}" text-anchor="middle" class="t-mono" font-size="${big ? 8.5 : 7.5}" letter-spacing="1.2" fill="${WHITE}" fill-opacity=".75">FROM MEMBERS</text>
      <line x1="${cx - 16}" y1="${cy + (big ? 31 : 23)}" x2="${cx + 16}" y2="${cy + (big ? 31 : 23)}" stroke="${WHITE}" stroke-opacity=".14"/>
      <text x="${cx}" y="${cy + (big ? 43 : 33)}" text-anchor="middle" class="t-mono" font-size="${big ? 8 : 7}" letter-spacing="1" fill="${FORUM}">${100 - pct}% FORUMS</text>`;
  };

  // The formula: 65 what happened, 15 agreement, 10 voices, 10 volume
  const formula = (cx, y, w) => {
    const parts = [[65, 'WHAT HAPPENED', LIME], [15, 'AGREEMENT', '#B8E62A'], [10, 'VOICES', '#9BE35A'], [10, 'VOLUME', '#6EE7B7']];
    let x = cx - w / 2;
    const bar = parts.map(([p, , c]) => { const wd = (w * p) / 100 - 2; const r = `<rect x="${f1(x)}" y="${y}" width="${f1(wd)}" height="5" rx="2.5" fill="${c}"/>`; x += (w * p) / 100; return r; }).join('');
    const item = ([p, t, c]) => `<tspan fill="${c}">●</tspan><tspan fill="${WHITE}" fill-opacity=".62">\u00A0${p} ${t}</tspan>`;
    const sep = '<tspan>\u00A0\u00A0\u00A0</tspan>';
    return `<text x="${cx}" y="${y - 9}" text-anchor="middle" class="t-mono" font-size="9" letter-spacing="1.4" fill="${WHITE}" fill-opacity=".45">THE FORMULA</text>
      ${bar}
      <text x="${cx}" y="${y + 21}" text-anchor="middle" class="t-mono" font-size="8.5" letter-spacing=".6">${item(parts[0])}${sep}${item(parts[1])}</text>
      <text x="${cx}" y="${y + 35}" text-anchor="middle" class="t-mono" font-size="8.5" letter-spacing=".6">${item(parts[2])}${sep}${item(parts[3])}</text>`;
  };

  // The output: the number of live Signals, the levels as a stacked bar and as seals
  const levelColors = { forum: FORUM, early: 'rgba(216,255,61,.38)', backed: 'rgba(216,255,61,.6)', verified: 'rgba(216,255,61,.82)', certified: LIME };
  const stack = (x, y, w) => {
    const tot = LEVELS.reduce((a, l) => a + level(l.key), 0);
    if (!tot) return `<rect x="${x}" y="${y}" width="${w}" height="5" rx="2.5" fill="${WHITE}" fill-opacity=".08"/>`;
    let cx = x;
    return `<rect x="${x}" y="${y}" width="${w}" height="5" rx="2.5" fill="${WHITE}" fill-opacity=".08"/>${LEVELS.map((l) => {
      const wd = (w * level(l.key)) / tot; if (!wd) return '';
      const r = `<rect x="${f1(cx)}" y="${y}" width="${f1(Math.max(1.5, wd - 1.5))}" height="5" rx="2" fill="${levelColors[l.key]}"/>`; cx += wd; return r;
    }).join('')}`;
  };
  const seals = (x, y, w, size) => {
    const step = (w - size) / 4;
    return LEVELS.map((l, i) => `${sealAt(l.key, x + i * step, y, size)}<text x="${f1(x + i * step + size / 2)}" y="${y + size + 13}" text-anchor="middle" class="t-mono" font-size="9.5" fill="${WHITE}" fill-opacity="${level(l.key) ? 0.9 : 0.45}">${level(l.key)}</text>`).join('');
  };
  const liveDot = (x, y) => `<circle class="ping" cx="${x}" cy="${y}" r="3.4" fill="${LIME}" fill-opacity=".5"/><circle cx="${x}" cy="${y}" r="3.4" fill="${LIME}"/>`;

  const defs = `<defs>
    <radialGradient id="${id}-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${LIME}" stop-opacity=".2"/><stop offset=".55" stop-color="${LIME}" stop-opacity=".05"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}-core" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="#17231F"/><stop offset="1" stop-color="#0A110F"/></radialGradient>
    <linearGradient id="${id}-card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#15201E"/><stop offset="1" stop-color="#0D1513"/></linearGradient>
  </defs>`;
  const label = `How the Signal is made: public forums and members' first-hand reports feed one number per compound. Right now ${pct}% of it comes from members.`;
  const quiet = s === 0;   // no member data yet: the members' wire waits, dashed

  if (!compact) {
    const W = 760; const H = 332;
    const cx = 442; const cy = 150; const r = 74; const R = r + 23;
    const chipX = 12; const chipW = 212; const ys = [28, 74, 120, 166];
    const angles = [150, 165, 180, 195]; const mAngle = 216;
    const at = (deg) => [cx + R * Math.cos(rad(deg)), cy - R * Math.sin(rad(deg))];
    const curve = (x0, y0, deg) => {
      const [ex, ey] = at(deg);
      const c2 = [ex + 52 * Math.cos(rad(deg)), ey - 52 * Math.sin(rad(deg))];
      return { d: `M${x0} ${y0} C ${x0 + 70} ${y0}, ${f1(c2[0])} ${f1(c2[1])}, ${f1(ex)} ${f1(ey)}`, end: [ex, ey] };
    };
    const forumWires = src.map((x, i) => {
      if (!x.name) return '';
      const c = curve(chipX + chipW, ys[i] + 20, angles[i]);
      const n = Math.max(1, Math.round(1 + 3 * ((x.n || 0) / total) * (1 - s)));
      return wire(`${id}-f${i}`, c.d, FORUM, 1 + 2.2 * ((x.n || 0) / total) * (1 - s) + 0.6, n, 3.4 + i * 0.25, c.end, false);
    }).join('');
    const mc = curve(chipX + chipW, 240 + 24, mAngle);
    const memberWire = wire(`${id}-m`, mc.d, LIME, 1.4 + 2.4 * s, Math.max(1, Math.round(1 + 4 * s)), 2.8, mc.end, quiet);
    const cardX = 592; const cardY = cy - 82; const cardW = 156; const cardH = 164;
    const outWire = wire(`${id}-o`, `M${cx + R} ${cy} L${cardX} ${cy}`, LIME, 1.8, 3, 1.6, null, false);
    return `<svg class="flowviz" viewBox="0 0 ${W} ${H}" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="${label}">
      ${defs}
      ${head(chipX, 16, `PUBLIC FORUMS · COUNT AS ${weight} REPORTS`, FORUM)}
      ${forumWires}
      ${memberWire}
      ${outWire}
      ${src.map((x, i) => (x.name ? chip(chipX, ys[i], chipW, x.name, x.n || 0, chipX + chipW, ys[i] + 20) : '')).join('')}
      ${head(chipX, 232, 'MEMBERS HERE · FIRST-HAND', LIME)}
      ${member(chipX, 240, chipW, chipX + chipW, 264)}
      ${dial(cx, cy, r, true)}
      ${formula(cx, 283, 200)}
      <g transform="translate(${cardX} ${cardY})">
        <rect width="${cardW}" height="${cardH}" rx="16" fill="url(#${id}-card)" stroke="${LIME}" stroke-opacity=".38"/>
        <circle cx="0" cy="${cardH / 2}" r="3" fill="#0C1413" stroke="${LIME}" stroke-width="1.4"/>
        ${head(16, 25, 'THE SIGNAL', LIME)}${liveDot(cardW - 18, 21.5)}
        <text x="16" y="68" class="t-head" font-size="40" fill="${WHITE}">${fmt(signals)}</text>
        <text x="16" y="86" class="t-mono" font-size="8.5" letter-spacing=".8" fill="${WHITE}" fill-opacity=".6">LIVE SIGNALS, 0–100</text>
        ${stack(16, 98, cardW - 32)}
        ${seals(16, 114, cardW - 32, 18)}
      </g>
    </svg>`;
  }
  // Phones, a funnel: the forums come down the sides, members straight down the middle, the
  // dial mixes them, the number comes out below and the formula sits at the foot
  const W = 360; const H = 612;
  const cx = 180; const cy = 318; const r = 60; const R = r + 21;
  const pos = [[8, 26], [184, 26], [8, 72], [184, 72]];
  const starts = [[30, 66], [330, 66], [62, 112], [298, 112]];
  const angles = [128, 52, 148, 32];
  const at = (deg) => [cx + R * Math.cos(rad(deg)), cy - R * Math.sin(rad(deg))];
  const forumWires = src.map((x, i) => {
    if (!x.name) return '';
    const [x0, y0] = starts[i]; const [ex, ey] = at(angles[i]);
    const c2 = [ex + 46 * Math.cos(rad(angles[i])), ey - 46 * Math.sin(rad(angles[i]))];
    const d = `M${x0} ${y0} C ${x0} ${y0 + 96}, ${f1(c2[0])} ${f1(c2[1])}, ${f1(ex)} ${f1(ey)}`;
    const n = Math.max(1, Math.round(1 + 2 * ((x.n || 0) / total) * (1 - s)));
    return wire(`${id}-f${i}`, d, FORUM, 1 + 1.8 * ((x.n || 0) / total) * (1 - s) + 0.5, n, 3.2 + i * 0.2, [ex, ey], false);
  }).join('');
  const my = 148;
  const memberWire = wire(`${id}-m`, `M${cx} ${my + 48} L${cx} ${cy - R}`, LIME, 1.4 + 2 * s, Math.max(1, Math.round(1 + 3 * s)), 2.2, [cx, cy - R], quiet);
  const oy = cy + R + 24; const cardW = 260; const cardH = 108;
  const outWire = wire(`${id}-o`, `M${cx} ${cy + R} L${cx} ${oy}`, LIME, 1.8, 2, 1.2, null, false);
  return `<svg class="flowviz compact" viewBox="0 0 ${W} ${H}" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="${label}">
    ${defs}
    ${head(8, 16, `PUBLIC FORUMS · COUNT AS ${weight} REPORTS`, FORUM)}
    ${forumWires}
    ${memberWire}
    ${outWire}
    ${src.map((x, i) => (x.name ? chip(pos[i][0], pos[i][1], 168, x.name, x.n || 0, starts[i][0], pos[i][1] + 40) : '')).join('')}
    ${head(cx, my - 8, 'MEMBERS HERE · FIRST-HAND', LIME, 'middle')}
    ${member(cx - 104, my, 208, cx, my + 48)}
    ${dial(cx, cy, r, false)}
    <g transform="translate(${cx - cardW / 2} ${oy})">
      <rect width="${cardW}" height="${cardH}" rx="16" fill="url(#${id}-card)" stroke="${LIME}" stroke-opacity=".38"/>
      <circle cx="${cardW / 2}" cy="0" r="3" fill="#0C1413" stroke="${LIME}" stroke-width="1.4"/>
      ${head(16, 24, 'THE SIGNAL', LIME)}${liveDot(98, 20.5)}
      <text x="16" y="60" class="t-head" font-size="32" fill="${WHITE}">${fmt(signals)}</text>
      <text x="16" y="76" class="t-mono" font-size="8" letter-spacing=".6" fill="${WHITE}" fill-opacity=".6">LIVE SIGNALS</text>
      ${seals(126, 26, 118, 16)}
      ${stack(16, 90, cardW - 32)}
    </g>
    ${formula(cx, oy + cardH + 34, 220)}
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
