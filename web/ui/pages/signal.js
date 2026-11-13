// The Signal: every number with where its data came from, the takeover line (with a slider to try
// it), the certification ladder, what's rising and falling, and the board.
import { h, icon, tick, bar, reduceMotion } from '../dom.js';
import { spaceTile, sig } from '../art.js';
import { fmt1, fmtN } from '../../core/format.js';
import { delta, sourceFamilies } from '../../core/signal.js';
import { spaceOf } from '../../app/store.js';
import { loadSignal, loadPulse, loadHistory } from '../../app/session.js';
import { render, sigSay } from '../shell.js';
import { fillRail } from '../rail.js';
import { movement, seal, both } from '../components/signal.js';
import { LEVELS, levelOf, levelAfter, shareAfter, flowSvg, takeoverSvg } from '../../kit/signalviz.js';

export async function renderSignalPage() {
  const list = h('div', { class: 'board' }, [1, 2, 3, 4].map(() => h('div', { class: 'skel' })));
  const movers = h('div', { class: 'movers' });
  const stats = h('div', { class: 'hero-stats' });
  const flow = h('div', { class: 'flow-box' }, h('div', { class: 'skel dark' }));
  const takeover = h('section', { class: 'card dark takeover-card' });
  const ladder = h('section', { class: 'ladder' });
  let sort = 'score';
  let only = 'all';
  const sortbar = h('div', { class: 'sortbar only' });
  const tail = h('section', { class: 'sig-tail', 'aria-label': 'The latest moves' });
  render(
    h('section', { class: 'hero signal-hero' },
      h('div', { class: 'kick' }, 'The Community Signal'),
      h('h1', {}, 'The Signal.'),
      h('p', { class: 'lede' }, 'One number from 0 to 100 for how it went for the people who took it. Each starts from what people say on public forums. Then members who took it themselves take over, report by report. One per compound, blend and stack.'),
      flow,
      stats),
    takeover,
    ladder,
    movers,
    h('div', { class: 'top-head' }, h('h2', {}, 'The Signal ', h('span', { class: 'top-dash' }, '— top')), h('p', { class: 'top-sub' }, 'every Signal, ranked; sort by any column')),
    sortbar, list, tail,
    h('section', { class: 'card mt16' },
      h('h3', {}, 'How the number moves'),
      h('p', { class: 'small muted' }, '65% is what people report happened, 15% how much those reports agree, 10% how many independent voices there are and 10% how much there is to go on. Every first-hand report Sig reads, every “same for me” and every post taken down recalculates the compound’s Signal in the database, and every change is kept as a new version. New accounts count half. Points go to taking part, never to how things turned out.'),
      h('a', { class: 'lnk small', href: '#/how' }, 'More on how it works')));
  const rail = fillRail('signal');
  const [rows, pulse] = await Promise.all([loadSignal(), loadPulse(), loadHistory()]);
  const live = rows.filter((x) => x.score != null);
  const levels = Object.fromEntries(LEVELS.map((l) => [l.key, live.filter((x) => (x.certification || 'forum') === l.key).length]));
  const share = pulse?.community_share ?? 0;
  const w = pulse?.external_weight ?? 50;
  const data = { sources: sourceFamilies(live), share, reports: pulse?.reports ?? 0, sames: pulse?.same_total ?? 0, signals: live.length, levels, weight: w };
  flow.replaceChildren(both((compact) => flowSvg(data, { compact })),
    h('p', { class: 'cap2 flow-cap' }, `${share}% of all Signals now comes from members here. Public forums count as ${w} reports for each compound; every first-hand report shifts the balance.`));
  stats.replaceChildren(
    h('div', {}, h('b', {}, fmtN(live.length)), h('span', {}, 'Signals')),
    h('div', {}, h('b', {}, fmtN(pulse?.moves_today ?? 0)), h('span', {}, 'Moves today')),
    h('div', {}, h('b', {}, fmtN(pulse?.reports ?? 0)), h('span', {}, 'First-hand reports')),
    h('div', {}, h('b', {}, fmtN(pulse?.community_signals ?? 0)), h('span', {}, 'Run by this community')),
    h('div', {}, h('b', {}, fmtN(levels.certified || 0)), h('span', {}, 'Signal Certified')));

  // The takeover line, with every Signal where its share puts it, and a slider to try it
  const points = live.map((x) => ({ share: x.internal_share, level: x.certification }));
  const chart = h('div');
  const out = h('output', { class: 'sim-out', for: 'sim-n', 'aria-live': 'polite' });
  const simulate = (n, still) => {
    chart.replaceChildren(both((compact) => takeoverSvg({ w, points, max: w * 6, you: { n, label: `${n} REPORT${n === 1 ? '' : 'S'}` } }, { compact, still })));
    const lvl = levelAfter(n, w);
    out.replaceChildren(seal(lvl, 26), h('span', {},
      h('b', {}, `${Math.round(shareAfter(n, w))}% from members`), ` after ${fmtN(n)} first-hand report${n === 1 ? '' : 's'}: `,
      h('b', {}, levelOf(lvl).name), lvl === 'forum' ? '' : ', if each comes from a different person'));
  };
  takeover.replaceChildren(
    h('div', { class: 'card-h' }, h('span', { class: 'kick' }, 'The takeover line'), h('span', { class: 'live' }, h('span', { class: 'live-dot' }), 'live')),
    h('h2', {}, 'From forum chatter to certified human data.'),
    h('p', { class: 'small' }, `Forums count as ${w} reports for each compound. After ${w} first-hand reports here, half of the number is members’ own experience; after ${w * 3}, three quarters. Each dot is a Signal today.`),
    chart,
    h('div', { class: 'sim' },
      h('label', { class: 'kick', for: 'sim-n' }, 'Try it: first-hand reports on one compound'),
      h('input', { type: 'range', id: 'sim-n', min: '0', max: String(w * 6), step: '1', value: String(w), oninput: (e) => simulate(Number(e.target.value), true) }),
      out));
  simulate(w, false);

  // The certification ladder
  ladder.replaceChildren(
    h('div', { class: 'card-h' }, h('span', { class: 'kick' }, 'Certification'), h('span', { class: 'xs muted' }, 'Each Signal earns its level from the database, live')),
    h('div', { class: 'ladder-steps' }, LEVELS.map((l, i) => h('div', { class: `step-l card ${levels[l.key] ? 'has' : ''}` },
      h('div', { class: 'row nw' }, seal(l.key, 34, true), h('span', { class: 'n mono' }, `0${i + 1}`)),
      h('b', {}, l.name), h('p', { class: 'xs muted' }, l.rule),
      h('div', { class: 'cnt' }, h('b', { class: 'num' }, fmtN(levels[l.key] || 0)), h('span', { class: 'xs muted' }, ` Signal${levels[l.key] === 1 ? '' : 's'}`))))));

  const rising = live.filter((x) => delta(x) > 0).sort((a, b) => delta(b) - delta(a)).slice(0, 4);
  const falling = live.filter((x) => delta(x) < 0).sort((a, b) => delta(a) - delta(b)).slice(0, 4);
  const board = (title, items, cls) => h('section', { class: 'card' },
    h('div', { class: 'card-h' }, h('span', { class: 'kick' }, title), icon(cls === 'up' ? 'up' : 'dn', 16, cls)),
    items.length ? items.map((x) => h('a', { class: 'mover', href: `#/s/${encodeURIComponent(x.compound_id)}` },
      spaceTile(spaceOf(x.compound_id) || x, 28), h('span', { class: 'grow' }, x.compound_name),
      h('b', { class: 'num mono' }, fmt1(x.score)), movement(x)))
      : h('p', { class: 'xs muted' }, 'Nothing yet.'));
  movers.replaceChildren(board('Rising', rising, 'up'), board('Falling', falling, 'dn'));

  // The board, as a table like top: the rank, the compound, its Signal with its bar, the four
  // parts of the score (what happened 65, agreement 15, voices 10, volume 10), where the data comes
  // from, its last move and how it reads. Any column sorts it; the filters pick what's in it.
  const COLS = [
    ['rank', '#', null], ['name', 'compound', null], ['score', 'signal', (x) => x.score],
    ['efficacy', 'what happened', (x) => x.efficacy], ['consistency', 'agreement', (x) => x.consistency],
    ['diversity', 'voices', (x) => x.diversity], ['confidence', 'volume', (x) => x.confidence],
    ['community', 'from', (x) => x.internal_share], ['move', 'last move', (x) => Math.abs(delta(x))], ['read', 'read', null],
  ];
  const NUMERIC = new Set(['score', 'efficacy', 'consistency', 'diversity', 'confidence']);
  // on a narrower screen the table keeps the rank, the compound, the Signal and its last move; the
  // parts of the score go first, then where it comes from and how it reads
  const OPT = new Set(['efficacy', 'consistency', 'diversity', 'confidence', 'community', 'read']);
  const OPT2 = new Set(['community', 'read']);
  const draw = () => {
    const shown = live.filter((x) => only === 'all' || (only === 'stacks' ? ['stack', 'blend'].includes(x.kind) : only === 'certified' ? ['verified', 'certified'].includes(x.certification) : !['stack', 'blend'].includes(x.kind)));
    const key = COLS.find(([k]) => k === sort)?.[2] || ((x) => x.score);
    const ranked = [...shown].sort((a, b) => (key(b) ?? -1) - (key(a) ?? -1) || b.score - a.score);
    sortbar.replaceChildren(...[['all', 'all'], ['single', 'compounds'], ['stacks', 'stacks & blends'], ['certified', 'verified+']].map(([k, l]) =>
      h('a', { href: '#/signal', 'aria-current': only === k ? 'page' : null, onclick: (e) => { e.preventDefault(); only = k; draw(); } }, l)));
    const nums = [];
    const head = h('tr', {}, COLS.map(([k, label, by]) => h('th', { scope: 'col', class: `${NUMERIC.has(k) ? 'n' : ''}${OPT.has(k) ? ' opt' : ''}${OPT2.has(k) ? ' opt2' : ''}`.trim() || null, 'aria-sort': by && sort === k ? 'descending' : null },
      by ? h('button', { type: 'button', class: 'th-sort', onclick: () => { sort = k; draw(); } }, label, sort === k ? h('span', { 'aria-hidden': 'true' }, ' ▾') : null) : label)));
    const body = ranked.map((x, i) => {
      const num = h('b', { class: 'sc', 'data-sig-of': x.compound_id }, fmt1(x.prev_score ?? x.score));
      nums.push([num, x]);
      const n0 = (v) => (v == null ? '–' : String(Math.round(v)));
      return h('tr', { 'data-signal': x.compound_id },
        h('td', { class: 'rk' }, String(i + 1)),
        h('th', { scope: 'row' }, h('a', { href: `#/s/${encodeURIComponent(x.compound_id)}` }, x.compound_name)),
        h('td', { class: 'sigc' }, h('span', { class: 'sigc-in' }, bar(x.score, 'tbar'), num)),
        h('td', { class: 'n opt' }, n0(x.efficacy)), h('td', { class: 'n opt' }, n0(x.consistency)),
        h('td', { class: 'n opt' }, n0(x.diversity)), h('td', { class: 'n opt' }, n0(x.confidence)),
        h('td', { class: 'opt opt2' }, x.internal_share > 0 ? `members ${Math.round(x.internal_share)}%` : 'forums'),
        h('td', { class: 'mvc' }, movement(x)),
        h('td', { class: 'opt opt2 rd' }, (x.summary_label || '').toLowerCase()));
    });
    list.replaceChildren(ranked.length
      ? h('div', { class: 'top-wrap' }, h('table', { class: 'top-table' }, h('thead', {}, head), h('tbody', {}, body)))
      : h('div', { class: 'empty card' }, sig(60, 'curious'), h('p', {}, 'None yet. Every first-hand report moves a Signal up the line.')));
    // The ticker: each number runs from its last version to now
    if (!reduceMotion()) nums.forEach(([el, x]) => tick(el, x.prev_score, x.score));
    else nums.forEach(([el, x]) => { el.textContent = fmt1(x.score); });
  };
  // The latest moves, newest first, as lines in a log: when, what moved, to what
  const stamp = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const moved = live.filter((x) => x.prev_score != null && x.computed_at).sort((a, b) => Date.parse(b.computed_at) - Date.parse(a.computed_at)).slice(0, 6);
  tail.replaceChildren(
    h('p', { class: 'tl-cmd', 'aria-hidden': 'true' }, '$ tail -f signal.log'),
    ...(moved.length ? moved.map((x) => h('p', { class: 'tl-line' }, h('span', { class: 'tl-when' }, stamp.format(new Date(x.computed_at)).toLowerCase()),
      h('a', { href: `#/s/${encodeURIComponent(x.compound_id)}` }, x.compound_name), ` ${fmt1(x.score)} `, movement(x)))
      : [h('p', { class: 'tl-line' }, h('span', { class: 'tl-when' }, 'now'), 'waiting for the first move')]),
    h('p', { class: 'tl-note' }, 'Each report lands here as a line, signed by ', h('span', { class: 'tl-co' }, 'the community'), ', and the row above moves with it.'));
  draw();
  if (window.innerWidth > 860) sigSay('Every number here moves when someone shares how it went. Tap one to see its space.', 'watching', 4000);
  await rail;
}
