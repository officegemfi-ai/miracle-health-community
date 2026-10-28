// The Community Signal on screen: the live ticker, the readiness-style card,
// live numbers everywhere ([data-sig-of]), the moves feed and The Signal page.
import { h, icon, fmt1, fmtN, ago, tick, bar, reduceMotion } from './ui.js';
import { scale, sparkline, spaceTile, sig } from './art.js';
import { S, sb, on, signalOf, spaceOf, nameOf, delta, loadSignal, loadHistory, loadPulse } from './state.js';
import { render, setRail, railCards, sigSay } from './shell.js';

export const OUTCOME = { better: ['Better', 'pos'], same: ['About the same', 'neu'], worse: ['Worse', 'neg'] };
const CAUSE = {
  report: 'a first-hand report', same: 'a “same for me”', removed: 'a post taken down', restored: 'a post restored',
  edit: 'a report edited', deleted: 'a report deleted',
};

export function movement(s, cls = '') {
  const d = typeof s === 'number' ? s : delta(s);
  if (d > 0) return h('span', { class: `mv up ${cls}`, title: 'Change at the last move' }, `▲ ${d.toFixed(1)}`);
  if (d < 0) return h('span', { class: `mv dn ${cls}`, title: 'Change at the last move' }, `▼ ${Math.abs(d).toFixed(1)}`);
  return h('span', { class: `mv eq ${cls}`, title: 'No change at the last move' }, '– 0.0');
}

// A number that follows its compound's Signal live
export function sigNum(cid, cls = '') {
  const x = signalOf(cid);
  return h('b', { class: `num ${cls}`.trim(), 'data-sig-of': cid }, fmt1(x?.score));
}

// ---------------------------------------------------------------------------
// The ticker across the top: every compound, its number and its last move
// ---------------------------------------------------------------------------
export function renderTicker() {
  const track = document.getElementById('tick-track');
  if (!track) return;
  const rows = S.signal.filter((x) => x.score != null);
  if (!rows.length) { track.replaceChildren(); return; }
  // Busiest first: what moved most recently leads
  const ordered = [...rows].sort((a, b) => (Math.abs(delta(b)) - Math.abs(delta(a))) || (b.score - a.score));
  const item = (x) => {
    const d = delta(x);
    return h('a', { class: 'tick-i', href: `#/s/${encodeURIComponent(x.compound_id)}` },
      x.compound_name, h('b', { 'data-sig-of': x.compound_id }, fmt1(x.score)),
      h('span', { class: d > 0 ? 'up' : d < 0 ? 'dn' : 'eq' }, d > 0 ? `▲${d.toFixed(1)}` : d < 0 ? `▼${Math.abs(d).toFixed(1)}` : '–'));
  };
  // Two copies so the loop is seamless
  track.replaceChildren(...ordered.map(item), ...ordered.map(item));
  track.style.setProperty('--tick-dur', `${Math.max(40, ordered.length * 3.2)}s`);
}

// ---------------------------------------------------------------------------
// Refresh after a change: fetch the new numbers and tick what's on screen
// ---------------------------------------------------------------------------
let pending = null;
export function refreshSignal() {
  if (pending) return pending;
  pending = (async () => {
    await new Promise((r) => setTimeout(r, 120));
    const before = new Map(S.signal.map((x) => [x.compound_id, x.score]));
    await loadSignal();
    document.querySelectorAll('[data-sig-of]').forEach((el) => {
      const cid = el.dataset.sigOf;
      const now = signalOf(cid);
      if (!now) return;
      const was = before.get(cid);
      if (was != null && now.score != null && Number(was) !== Number(now.score)) tick(el, was, now.score);
      else if (now.score != null) el.textContent = fmt1(now.score);
    });
    document.querySelectorAll('[data-mv-of]').forEach((el) => el.replaceChildren(movement(signalOf(el.dataset.mvOf))));
    const moved = S.signal.filter((x) => before.has(x.compound_id) && Number(before.get(x.compound_id)) !== Number(x.score));
    if (moved.length) {
      renderTicker();
      moved.forEach((x) => { const hist = S.history.get(x.compound_id); if (hist) hist.push(Number(x.score)); });
    }
    pending = null;
    return moved;
  })();
  return pending;
}

// Live: when the database writes a new version, everyone's screen ticks. Sig
// mentions a move now and then (yours and your spaces' first), not every one.
let movesBox = null;
let lastSaid = 0;
on('signal', async (row) => {
  const moved = await refreshSignal();
  if (!row || row.version <= 1) return;
  const x = signalOf(row.compound_id);
  const was = moved?.find((m) => m.compound_id === row.compound_id);
  if (movesBox && x) prependMove(movesBox, { compound_id: x.compound_id, compound_name: x.compound_name, delta: delta(x), score: x.score, cause: row.cause, computed_at: new Date().toISOString() });
  const mine = spaceOf(row.compound_id)?.joined;
  if (row.cause_post && S.mine.has(row.cause_post)) return;   // the author hears about it from the read itself
  if (was && !document.hidden && (mine ? Date.now() - lastSaid > 45000 : Date.now() - lastSaid > 120000)) {
    lastSaid = Date.now();
    sigSay([h('b', {}, x.compound_name), ` just moved ${delta(x) > 0 ? '▲' : '▼'} ${Math.abs(delta(x)).toFixed(1)} after ${CAUSE[row.cause] || 'new reports'}.`], 'watching', 3800);
  }
});

// ---------------------------------------------------------------------------
// The readiness card: big number, the red-to-lime scale, what it's built from
// ---------------------------------------------------------------------------
export function signalCard(cid, opts = {}) {
  const x = signalOf(cid);
  const name = nameOf(cid);
  if (!x || x.score == null) {
    const sp = spaceOf(cid);
    return h('section', { class: 'card dark sigcard', 'aria-label': `${name} Community Signal` },
      h('div', { class: 'lbl' }, h('span', { class: 'kick' }, 'Community Signal'), h('span', { class: 'live' }, 'NOT YET')),
      h('div', { class: 'sig-big' }, h('b', {}, '—'), h('span', {}, '/100')),
      h('p', { class: 'small', text: `${name} has no Signal yet. It unlocks after three first-hand reports here: share yours, whether it worked or not.` }),
      sp ? h('div', { class: 'share-meter' }, h('div', { class: 'row between' }, h('span', {}, 'Reports so far'), h('b', {}, `${sp.reports} of 3`)), bar((sp.reports / 3) * 100)) : null);
  }
  const parts = [['Reported efficacy', 'efficacy', 65], ['Consistency', 'consistency', 15], ['Diversity of voices', 'diversity', 10], ['Confidence', 'confidence', 10]];
  const fams = (x.source_families || []).join(', ');
  const hist = S.history.get(cid);
  const card = h('section', { class: 'card dark sigcard', 'aria-label': `${name} Community Signal` },
    h('div', { class: 'lbl' }, h('span', { class: 'kick' }, opts.title || `${name} · Community Signal`), h('span', { class: 'live' }, h('span', { class: 'live-dot' }), 'LIVE')),
    h('div', { class: 'sig-big' }, h('b', { 'data-sig-of': cid }, fmt1(x.score)), h('span', {}, '/100'), h('span', { class: 'grow' }), h('span', { 'data-mv-of': cid }, movement(x))),
    scale(x.score),
    h('div', { class: 'cap2' }, `${x.summary_label} · ${x.confidence_label} confidence`),
    hist && hist.length > 1 ? h('div', { class: 'mt8' }, sparkline(hist.slice(-24), 280, 40, 'lime')) : null,
    opts.compact ? null : h('div', { class: 'comp' }, parts.map(([label, key, w]) => [
      h('span', {}, `${label} · ${w}%`), h('b', {}, String(x[key] ?? '–')), bar(x[key])])),
    h('div', { class: 'share-meter' },
      h('div', { class: 'row between' }, h('span', {}, 'This community’s share'), h('b', {}, `${x.internal_share}%`)),
      h('div', { class: 'mt8' }, bar(Math.min(100, (x.internal_share / 50) * 100))),
      h('div', { class: 'cap2 mt8' }, x.internal_share >= 50
        ? 'Most of this number now comes from members here.'
        : `${x.first_hand ? `${fmtN(x.first_hand)} first-hand report${x.first_hand === 1 ? '' : 's'} here` : 'No reports here yet'}${x.same_for_me ? ` + ${fmtN(x.same_for_me)} “same for me”` : ''}${fams ? ` · the rest from ${fams}` : ''}. At 50% it’s ours.`)));
  return card;
}

// ---------------------------------------------------------------------------
// The moves feed: what changed, by how much, and why
// ---------------------------------------------------------------------------
function moveRow(m, fresh = false) {
  const sp = spaceOf(m.compound_id) || { name: m.compound_name, category: '' };
  return h('a', { class: `move-i ${fresh ? 'fresh' : ''}`, href: `#/s/${encodeURIComponent(m.compound_id)}` },
    spaceTile(sp, 30),
    h('span', {}, h('b', {}, m.compound_name), h('span', { class: 'why' }, `${CAUSE[m.cause] || 'new reports'} · ${ago(m.computed_at)}`)),
    h('span', { class: 'row nw' }, h('span', { class: 'num mono small' }, fmt1(m.score)), movement(Number(m.delta))));
}
function prependMove(box, m) {
  box.prepend(moveRow(m, true));
  while (box.children.length > 8) box.lastChild.remove();
}
export async function movesCard(dark = true) {
  const box = h('div', { class: 'moves' }, h('p', { class: 'xs muted' }, 'Loading…'));
  movesBox = box;
  const card = h('section', { class: `card ${dark ? 'dark' : ''}` },
    h('div', { class: 'card-h' }, h('span', { class: 'kick row nw' }, h('span', { class: 'live-dot' }), ' Live moves'), h('a', { href: '#/signal' }, 'The Signal')), box);
  sb.from('signal_moves').select('*').order('computed_at', { ascending: false }).limit(8).then(({ data }) => {
    box.replaceChildren(...((data || []).length ? data.map((m) => moveRow(m)) : [h('p', { class: 'xs muted' }, 'No moves yet. The first report moves it.')]));
  });
  return card;
}

// ---------------------------------------------------------------------------
// The Signal page
// ---------------------------------------------------------------------------
export async function renderSignalPage() {
  const list = h('div', { class: 'board' }, [1, 2, 3, 4].map(() => h('div', { class: 'skel' })));
  const movers = h('div', { class: 'movers' });
  const stats = h('div', { class: 'hero-stats' });
  let sort = 'score';
  let only = 'all';
  const sortbar = h('div', { class: 'sortbar' });
  render(
    h('section', { class: 'hero' },
      h('div', { class: 'kick' }, '// The Community Signal'),
      h('h1', {}, 'The Signal.'),
      h('p', { class: 'lede' }, 'One number per compound, blend and stack, 0 to 100: 65% what people report happened, 15% how much those reports agree, 10% how many independent voices there are, 10% how much there is to go on. It starts from public forums and moves toward this community’s own first-hand reports, live.'),
      stats),
    movers, sortbar, list,
    h('section', { class: 'card mt16' },
      h('h3', {}, 'How the number moves'),
      h('p', { class: 'small muted' }, 'Every first-hand report Miracle AI reads, every “same for me” and every post taken down recalculates the compound’s Signal in the database, and every change is kept as a new version. New accounts count half. Points go to taking part, never to how things turned out.'),
      h('a', { class: 'lnk small', href: '#/how' }, 'More on how it works')));
  setRail(await railCards('signal'));
  const [rows, pulse] = await Promise.all([loadSignal(), loadPulse(), loadHistory()]);
  const live = rows.filter((x) => x.score != null);
  stats.replaceChildren(
    h('div', {}, h('b', {}, fmtN(live.length)), h('span', {}, 'Signals')),
    h('div', {}, h('b', {}, fmtN(pulse?.moves_today ?? 0)), h('span', {}, 'Moves today')),
    h('div', {}, h('b', {}, fmtN(pulse?.reports ?? 0)), h('span', {}, 'First-hand reports')),
    h('div', {}, h('b', {}, fmtN(pulse?.community_signals ?? 0)), h('span', {}, 'Run by this community')));
  const rising = live.filter((x) => delta(x) > 0).sort((a, b) => delta(b) - delta(a)).slice(0, 4);
  const falling = live.filter((x) => delta(x) < 0).sort((a, b) => delta(a) - delta(b)).slice(0, 4);
  const board = (title, items, cls) => h('section', { class: 'card' },
    h('div', { class: 'card-h' }, h('span', { class: 'kick' }, title), icon(cls === 'up' ? 'up' : 'dn', 16, cls)),
    items.length ? items.map((x) => h('a', { class: 'mover', href: `#/s/${encodeURIComponent(x.compound_id)}` },
      spaceTile(spaceOf(x.compound_id) || x, 28), h('span', { class: 'grow' }, x.compound_name),
      h('b', { class: 'num mono' }, fmt1(x.score)), movement(x)))
      : h('p', { class: 'xs muted' }, 'Nothing yet.'));
  movers.replaceChildren(board('Rising', rising, 'up'), board('Falling', falling, 'dn'));

  const draw = () => {
    const shown = live.filter((x) => only === 'all' || (only === 'stacks' ? ['stack', 'blend'].includes(x.kind) : !['stack', 'blend'].includes(x.kind)));
    const ranked = [...shown].sort(sort === 'move' ? (a, b) => Math.abs(delta(b)) - Math.abs(delta(a))
      : sort === 'community' ? (a, b) => b.internal_share - a.internal_share || b.score - a.score
        : (a, b) => b.score - a.score);
    sortbar.replaceChildren(...[['score', 'Highest'], ['move', 'Biggest moves'], ['community', 'Most community data']].map(([k, l]) =>
      h('a', { href: '#/signal', 'aria-current': sort === k ? 'page' : null, onclick: (e) => { e.preventDefault(); sort = k; draw(); } }, l)),
    h('span', { class: 'grow' }),
    ...[['all', 'All'], ['single', 'Compounds'], ['stacks', 'Stacks & blends']].map(([k, l]) =>
      h('a', { href: '#/signal', 'aria-current': only === k ? 'page' : null, onclick: (e) => { e.preventDefault(); only = k; draw(); } }, l)));
    const nums = [];
    list.replaceChildren(...ranked.map((x, i) => {
      const num = h('span', { class: 'sc', 'data-sig-of': x.compound_id }, fmt1(x.prev_score ?? x.score));
      nums.push([num, x]);
      return h('a', { class: 'brow card sig-row', href: `#/s/${encodeURIComponent(x.compound_id)}`, 'data-signal': x.compound_id },
        h('span', { class: 'rk' }, String(i + 1).padStart(2, '0')),
        spaceTile(spaceOf(x.compound_id) || x, 36),
        h('span', { class: 'nm' }, h('b', {}, x.compound_name), h('span', {}, `${x.category} · ${x.summary_label}`)),
        sparkline((S.history.get(x.compound_id) || []).slice(-20), 100, 30),
        h('span', { class: 'sh' }, `${x.internal_share}% here`, bar(Math.min(100, x.internal_share * 2))),
        h('span', { class: 'row nw end' }, num));
    }));
    // The ticker: each number runs from its last version to now
    if (!reduceMotion()) nums.forEach(([el, x]) => tick(el, x.prev_score, x.score));
    else nums.forEach(([el, x]) => { el.textContent = fmt1(x.score); });
  };
  draw();
  if (window.innerWidth > 860) sigSay('Every number here moves when someone shares how it went. Tap one to see its space.', 'watching', 4000);
}

export function outcomeChip(p) {
  if (!p.counts_for_signal || !OUTCOME[p.outcome]) return null;
  const [label, cls] = OUTCOME[p.outcome];
  return h('span', { class: `chip oc ${cls}`, title: 'Miracle AI read this as a first-hand report. It feeds the Signal.' }, h('span', { class: 'dot' }), `Feeds the Signal · ${label}`);
}

export function readMini(p) {
  if (p.kind === 'question') return null;
  if (p.read_pending) return h('span', { class: 'read-mini' }, sig(18, 'think'), 'Miracle AI is reading…');
  return null;
}
