// The Community Signal on screen: the ticker across the top, the readiness card (the big number, the
// red-to-lime scale, rated by use, the measuring tools), the numbers that follow it live
// ([data-sig-of]), and the chips a post shows.
import { h, tick, bar, svg } from '../dom.js';
import { scale, sparkline, sig } from '../art.js';
import { fmt1, fmtN } from '../../core/format.js';
import { MEDWATCH, STOPPED, FORUM_WORD, OUTCOME, delta } from '../../core/signal.js';
import { S, signalOf, spaceOf, nameOf, useLabel, baselineOf } from '../../app/store.js';
import { loadSignal } from '../../app/session.js';
import { levelOf, sealSvg, takeoverSvg, splitBar } from '../../kit/signalviz.js';

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
  const fams = (x.source_families || []).join(', ');
  const hist = S.history.get(cid);
  const card = h('section', { class: 'card dark sigcard', 'aria-label': `${name} Community Signal` },
    h('div', { class: 'lbl' }, h('span', { class: 'kick' }, opts.title || `${name} · Community Signal`), h('span', { class: 'live' }, h('span', { class: 'live-dot' }), 'live')),
    h('div', { class: 'sig-big' }, h('b', { 'data-sig-of': cid }, fmt1(x.score)), h('span', {}, '/100'), h('span', { class: 'grow' }), h('span', { 'data-mv-of': cid }, movement(x))),
    scale(x.score),
    h('div', { class: 'cap2' }, `Overall rating · ${x.summary_label} · ${x.confidence_label} confidence`),
    hist && hist.length > 1 ? h('div', { class: 'mt8' }, sparkline(hist.slice(-24), 280, 40, 'lime')) : null,
    opts.compact ? byUse(x, 3, true) : byUse(x),
    opts.compact ? null : measuringTools(x, name),
    h('div', { class: 'share-meter' },
      h('div', { class: 'row between' }, h('span', {}, 'This community’s share'), h('b', {}, `${x.internal_share}%`)),
      h('div', { class: 'mt8' }, bar(Math.min(100, (x.internal_share / 50) * 100))),
      h('div', { class: 'cap2 mt8' }, x.internal_share >= 50
        ? 'Most of this number now comes from members here.'
        : `${x.first_hand ? `${fmtN(x.first_hand)} first-hand report${x.first_hand === 1 ? '' : 's'} here` : 'No reports here yet'}${x.same_for_me ? ` + ${fmtN(x.same_for_me)} “same for me”` : ''}${fams ? ` · the rest from ${fams}` : ''}. At 50% it’s ours.`)));
  return card;
}

// Rated by use: what members took it for and how it went, from first-hand reports (a use
// gets its 0-100 rating once three reports name it), next to how often the forums mention it
function byUse(x, max = 6, compact = false) {
  const list = x.by_use || [];
  if (!list.length) return null;
  const rated = list.filter((u) => u.rating != null);
  if (compact && !rated.length) return null;
  const shown = (compact ? rated : list).slice(0, max);
  return h('div', { class: `uses ${compact ? 'compact' : ''}`.trim(), 'aria-label': 'Rated by use' },
    h('div', { class: 'row between' }, h('span', { class: 'kick' }, 'Rated by use'),
      h('span', { class: 'xs mono dim' }, rated.length ? 'From first-hand reports' : 'Each use is rated after 3 reports')),
    shown.map((u) => {
      const base = u.rating != null && u.better_pct != null ? baselineOf(u.use) : null;
      return h('div', { class: `use ${u.rating != null ? 'rated' : 'waiting'}`, 'data-use': u.use },
        h('span', { class: 'use-n' }, useLabel(u.use)),
        h('b', { class: 'num', title: u.low != null ? `Likely between ${u.low} and ${u.high}` : null }, u.rating != null ? String(u.rating) : '—',
          u.low != null && !compact ? h('span', { class: 'rng' }, ` ${u.low}–${u.high}`) : null),
        u.rating != null ? rangeBar(u.rating, u.low, u.high) : h('div', { class: 'bar wait' }),
        h('span', { class: 'use-meta' }, [
          u.reports ? `${fmtN(u.reports)} report${u.reports === 1 ? '' : 's'}` : 'No reports yet',
          u.better_pct != null ? `${u.better_pct}% said better` : null,
          base ? `in trials: ${base.short}` : null,
          u.forum ? `forums: ${FORUM_WORD[u.forum] || String(u.forum).toLowerCase()}` : null,
          u.rating == null && u.reports < 3 ? `${3 - (u.reports || 0)} more to rate` : null,
        ].filter(Boolean).join(' · ')));
    }),
    rated.length && !compact ? h('p', { class: 'xs dim' }, 'Each rating starts from what members report for that use across every compound and moves toward this one’s own reports, so a handful of glowing reports can’t outrank many good ones. The band is the likely range.') : null,
    !compact && list.length > max ? h('p', { class: 'xs dim' }, `+ ${list.length - max} more use${list.length - max === 1 ? '' : 's'}`) : null);
}

// A rating with its likely range: the band from low to high, the bar up to the rating
function rangeBar(rating, low, high) {
  const el = bar(rating, 'rbar');
  if (low != null && high != null) {
    const band = h('span', { class: 'band', 'aria-hidden': 'true' });
    band.style.left = `${Math.max(0, low)}%`;
    band.style.width = `${Math.max(1, Math.min(100, high) - Math.max(0, low))}%`;
    el.append(band);
  }
  return el;
}

// The side-effect watch, serious reactions and check-ins under a Signal
function watchTool(x) {
  const watch = x.watch || [];
  const serious = x.serious_reports || 0;
  if (!watch.length && !serious) return null;
  return h('div', { class: 'tool watch' },
    h('span', { class: 'kick' }, 'Side-effect watch'),
    watch.length ? h('div', { class: 'post-chips' }, watch.map((w) => h('span', { class: 'chip fx warn', title: `Reported ${w.ratio}× as often as for other compounds` },
      `${w.effect} · ${w.n} of ${w.of} reports (${w.pct}%) · ${w.others_pct}% for others`))) : null,
    h('p', { class: 'xs' }, [
      watch.length ? 'Reported unusually often with this compound compared with every other one here. ' : '',
      serious ? `${fmtN(serious)} report${serious === 1 ? '' : 's'} describe${serious === 1 ? 's' : ''} a reaction that sounded serious. ` : '',
      'A serious reaction needs medical help; anyone can report one to the FDA through ',
    ], h('a', { href: MEDWATCH, target: '_blank', rel: 'noopener' }, 'MedWatch'), '.'));
}

function checkinTool(x) {
  const c = x.checkins || {};
  if (!c.reports) return null;
  const reasons = Object.entries(c.reasons || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${STOPPED[k] ? STOPPED[k].toLowerCase() : k} ${n}`);
  return h('div', { class: 'tool' },
    h('span', { class: 'kick' }, 'Check-ins, 2 to 12 weeks on'),
    h('p', { class: 'xs' }, `${fmtN(c.reports)} report${c.reports === 1 ? '' : 's'} followed up: ${fmtN(c.still)} still taking it, ${fmtN(c.stopped)} stopped${reasons.length ? ` (${reasons.join(', ')})` : ''}.`
      + (c.at12 ? ` At 12 weeks, ${fmtN(c.still12)} of ${fmtN(c.at12)} were still taking it.` : '')));
}

// The measuring tools under a Signal: its level, how first-hand reports split (with a 95%
// interval for "better"), the side effects members mention, where it sits on the line, and
// how the overall number is built
function measuringTools(x, name) {
  const lvl = levelOf(x.certification);
  const n = (x.reports_better || 0) + (x.reports_same || 0) + (x.reports_worse || 0);
  const w = S.pulse?.external_weight ?? 50;
  const parts = [['What happened', 'efficacy', 65], ['Agreement', 'consistency', 15], ['Voices', 'diversity', 10], ['Volume', 'confidence', 10]];
  return h('div', { class: 'tools' },
    h('div', { class: 'cert-row' }, seal(x.certification, 30),
      h('div', { class: 'grow' }, h('b', {}, lvl.name), h('div', { class: 'xs' }, lvl.rule))),
    n ? h('div', { class: 'tool' },
      h('div', { class: 'row between' }, h('span', { class: 'kick' }, `How ${n} first-hand report${n === 1 ? '' : 's'} went`),
        x.better_pct != null ? h('span', { class: 'xs mono', title: 'A 95% Wilson interval: with this many reports, the true share is likely in this range' }, `${x.better_pct}% better · 95% CI ${x.better_low}–${x.better_high}%`) : null),
      splitBar({ better: x.reports_better || 0, same: x.reports_same || 0, worse: x.reports_worse || 0 }),
      h('div', { class: 'split-key xs' }, h('span', { class: 'b' }, `Better ${x.reports_better || 0}`), h('span', { class: 's' }, `About the same ${x.reports_same || 0}`), h('span', { class: 'w' }, `Worse ${x.reports_worse || 0}`)))
      : h('p', { class: 'xs tool' }, 'No first-hand reports here yet. With the first one you’ll see how reports split: better, about the same or worse.'),
    (x.side_effects_top || []).length ? h('div', { class: 'tool' }, h('span', { class: 'kick' }, 'Side effects members mention'),
      h('div', { class: 'post-chips' }, x.side_effects_top.map((e) => h('span', { class: 'chip fx' }, `${e.effect} · ${e.n}`)))) : null,
    watchTool(x),
    checkinTool(x),
    h('div', { class: 'tool' }, h('span', { class: 'kick' }, 'On the takeover line'),
      both((compact) => takeoverSvg({ w, max: w * 6, you: { share: x.internal_share, label: name.toUpperCase().slice(0, 18) } }, { compact }))),
    h('details', { class: 'tool built' },
      h('summary', { class: 'kick' }, 'How the overall number is built'),
      h('div', { class: 'comp' }, parts.map(([label, key, wt]) => [
        h('span', {}, `${label} · ${wt}%`), h('b', {}, String(x[key] ?? '–')), bar(x[key])]))));
}

// The two drawings for whatever screen this is: wide, or phone-sized
export function both(make) {
  return h('div', { class: 'viz' }, h('div', { class: 'viz-wide' }, svg(make(false))), h('div', { class: 'viz-compact' }, svg(make(true))));
}

export function seal(key, size = 22, disc = false) { return svg(sealSvg(key, size, disc)); }

export function outcomeChip(p) {
  if (!p.counts_for_signal || !OUTCOME[p.outcome]) return null;
  const [label, cls] = OUTCOME[p.outcome];
  return h('span', { class: `chip oc ${cls}`, title: 'Sig read this as a first-hand report. It feeds the Signal.' }, h('span', { class: 'dot' }), `Feeds the Signal · ${label}`);
}

export function readMini(p) {
  if (p.kind === 'question') return null;
  if (p.read_pending) return h('span', { class: 'read-mini' }, sig(18, 'think'), 'Sig is reading…');
  return null;
}
