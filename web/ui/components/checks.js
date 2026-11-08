// Checks on a report, and what they feed:
// - "Did we read you right?": the author sees Sig's read in one line and confirms or fixes it (how
//   it went, how long, what for, side effects). When something important is missing (usually how
//   long), it asks that one question first.
// - "How is it now?": check-ins 2, 6 and 12 weeks after a report, in two or three taps, and texts
//   when one is due.
// - A reaction that sounds serious: get medical help, and the FDA's MedWatch.
// - The pairs the community fills first (focus pairs), with how far along each is.
import { h, icon, toast, bar } from '../dom.js';
import { sig } from '../art.js';
import { fmtN } from '../../core/format.js';
import { friendly } from '../../core/errors.js';
import { OUTCOME, MEDWATCH, STOPPED } from '../../core/signal.js';
import { HOW_LONG, lower, readLine, likelyUses } from '../../core/reads.js';
import * as Checks from '../../data/checks.js';
import * as Members from '../../data/members.js';
import { C } from '../../data/config.js';
import { track } from '../../data/telemetry.js';
import { S, signalOf, useLabel } from '../../app/store.js';
import { sigSay } from '../shell.js';
import { sigNum, refreshSignal } from './signal.js';
import { afterEarn } from './game.js';

// A row of one-tap answers; the one picked is pressed
function taps(options, picked, onPick, cls = '') {
  return h('div', { class: `taps ${cls}`.trim(), role: 'group' }, options.map(([value, label]) => h('button', {
    class: `btn xs ${picked === value ? 'ink' : 'ghost'}`, type: 'button', 'aria-pressed': String(picked === value),
    onclick: (e) => onPick(value, e.currentTarget),
  }, label)));
}

// A serious reaction
export function safetyNote(p) {
  if (!p.read_serious) return null;
  return h('div', { class: 'safety', role: 'note' },
    icon('shield', 18),
    h('p', {}, h('b', {}, 'This describes a reaction that sounds serious. '),
      p.is_mine
        ? 'If it’s still happening or getting worse, get medical help now (in an emergency, call 911). You can also tell the FDA through '
        : 'If something like it happens to you, get medical help (in an emergency, call 911). Reactions can be reported to the FDA through ',
      h('a', { href: MEDWATCH, target: '_blank', rel: 'noopener' }, 'MedWatch'), '.'));
}

async function saveRead(p, args, btn, done) {
  btn.disabled = true;
  const { error } = await Checks.fixRead(p.id, args);
  btn.disabled = false;
  if (error) { toast(friendly(error)); return false; }
  track('fix_read', { confirm: args.confirm !== false, fields: Object.keys(args).filter((k) => k !== 'confirm').join(',') });
  if (args.confirm !== false) await afterEarn(btn, '· thanks for checking the read');
  await refreshSignal();
  done();
  return true;
}

// The side effects a member can pick (the database's one name for each), loaded once
let effectNames = null;
async function loadEffectNames() {
  if (effectNames) return effectNames;
  const { data } = await Checks.sideEffectNames();
  effectNames = (data || []).map((x) => (typeof x === 'string' ? x : Object.values(x || {})[0])).filter((x) => typeof x === 'string');
  return effectNames;
}

// The editor: every part of the read, each a tap away
function fixForm(p, close, done) {
  let outcome = p.outcome;
  let duration = p.duration || '';
  const uses = new Set((p.read_uses || []).map((u) => u.use));
  const effects = (p.side_effects || []).slice(0, 3);
  const box = h('div', { class: 'fix' });
  const draw = () => {
    const usePick = h('select', { class: 'input xs', 'aria-label': 'Add what you took it for', disabled: uses.size >= 3 ? true : null },
      h('option', { value: '' }, uses.size >= 3 ? 'Three at most' : 'Add a use…'),
      likelyUses(signalOf(p.compound_id), S.uses).filter((id) => !uses.has(id)).map((id) => h('option', { value: id }, useLabel(id))));
    usePick.addEventListener('change', () => { if (usePick.value && uses.size < 3) { uses.add(usePick.value); draw(); } });
    // Side effects are picked from the names the side-effect watch counts, so the totals stay clean
    const fx = h('select', { class: 'input xs', 'aria-label': 'Add a side effect', disabled: effects.length >= 3 ? true : null },
      h('option', { value: '' }, effects.length >= 3 ? 'Three at most' : 'Add a side effect…'),
      (effectNames || []).filter((n) => !effects.some((e) => e.toLowerCase() === n.toLowerCase())).map((n) => h('option', { value: n }, n)));
    const addFx = () => { const v = fx.value; if (v && effects.length < 3 && !effects.some((e) => e.toLowerCase() === v.toLowerCase())) { effects.push(v); draw(); } };
    fx.addEventListener('change', addFx);
    const save = h('button', { class: 'btn lime sm', type: 'button' }, 'Save +10');
    save.addEventListener('click', () => saveRead(p, { outcome, duration: duration || '', uses: [...uses], side_effects: effects, confirm: true }, save, done));
    const longs = HOW_LONG.includes(duration) || !duration ? HOW_LONG : [duration, ...HOW_LONG];
    box.replaceChildren(
      h('div', { class: 'fix-row' }, h('span', { class: 'kick' }, 'How it went'),
        taps(Object.entries(OUTCOME).map(([k, [label]]) => [k, label]), outcome, (v) => { outcome = v; draw(); })),
      h('div', { class: 'fix-row' }, h('span', { class: 'kick' }, 'How long'),
        taps(longs.map((l) => [l, l]), duration, (v) => { duration = v; draw(); })),
      h('div', { class: 'fix-row' }, h('span', { class: 'kick' }, 'What for'),
        h('div', { class: 'taps' }, [...uses].map((id) => h('button', { class: 'chip rm', type: 'button', 'aria-label': `Remove ${useLabel(id)}`, onclick: () => { uses.delete(id); draw(); } }, useLabel(id), icon('x', 12))), usePick)),
      h('div', { class: 'fix-row' }, h('span', { class: 'kick' }, 'Side effects'),
        h('div', { class: 'taps' }, effects.map((e, i) => h('button', { class: 'chip rm', type: 'button', 'aria-label': `Remove ${e}`, onclick: () => { effects.splice(i, 1); draw(); } }, e, icon('x', 12))),
          fx)),
      h('div', { class: 'row end mt8' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: close }, 'Cancel'), save));
  };
  draw();
  if (!effectNames) loadEffectNames().then(() => { if (box.isConnected) draw(); });
  return box;
}

export function readCheck(p, refresh) {
  if (p.kind === 'question') return null;
  const mine = p.is_mine && p.status === 'visible';
  if (p.counts_for_signal && OUTCOME[p.outcome]) {
    const x = signalOf(p.compound_id);
    const actions = h('div', {});
    const feeds = x && x.score != null
      ? ['It feeds the ', h('a', { href: `#/s/${encodeURIComponent(p.compound_id)}` }, `${p.compound_name} Signal`), ', now ', sigNum(p.compound_id), '.']
      : `It counts toward the first ${p.compound_name} Signal${p.compound_kind === 'stack' ? ' (this exact stack)' : ''}.`;
    const kick = p.read_confirmed ? (p.read_corrected ? 'Corrected by the author' : 'Confirmed by the author')
      : mine ? 'Did we read you right?' : 'Sig’s read';
    const panel = h('section', { class: 'airead', 'aria-label': 'What Sig read' },
      sig(40, p.read_confirmed ? 'happy' : mine ? 'curious' : 'watching'),
      h('div', { class: 'grow' }, h('div', { class: 'kick' }, kick), h('p', {}, h('b', {}, `${readLine(p, useLabel)}. `), feeds), actions));
    const showConfirm = () => actions.replaceChildren(h('div', { class: 'confirm' },
      h('button', { class: 'btn xs ink', type: 'button', onclick: async (e) => {
        if (await saveRead(p, { outcome: p.outcome, confirm: true }, e.currentTarget, refresh)) {
          sigSay(['Thanks. A read you confirmed ', h('b', {}, 'counts more'), ' in the Signal.'], 'happy', 4200);
        }
      } }, 'Yes, that’s right +10'),
      h('button', { class: 'btn xs ghost', type: 'button', onclick: () => actions.replaceChildren(fixForm(p, showConfirm, () => {
        sigSay(['Got it. ', h('b', {}, 'Your word wins'), ' over my read, and it counts more.'], 'happy', 4200);
        refresh();
      })) }, 'Fix something')));
    if (mine && !p.read_confirmed) {
      // One question first, only when something important is missing: how long, then what for
      if (!p.duration) {
        actions.replaceChildren(h('div', { class: 'ask1' },
          h('span', { class: 'small' }, h('b', {}, 'One question: '), 'how long have you taken it?'),
          taps(HOW_LONG.map((l) => [l, l]), null, (v, btn) => saveRead(p, { duration: v, confirm: false }, btn, refresh)),
          h('button', { class: 'lnk xs', type: 'button', onclick: showConfirm }, 'Skip')));
      } else if (!(p.read_uses || []).length) {
        actions.replaceChildren(h('div', { class: 'ask1' },
          h('span', { class: 'small' }, h('b', {}, 'One question: '), 'what did you take it for?'),
          taps(likelyUses(signalOf(p.compound_id), S.uses).slice(0, 6).map((id) => [id, useLabel(id)]), null, (v, btn) => saveRead(p, { uses: [v], confirm: false }, btn, refresh)),
          h('button', { class: 'lnk xs', type: 'button', onclick: showConfirm }, 'Skip')));
      } else {
        showConfirm();
      }
    } else if (mine) {
      actions.replaceChildren(h('button', { class: 'lnk xs mt8', type: 'button', onclick: () => actions.replaceChildren(fixForm(p, () => actions.replaceChildren(), () => refresh())) }, 'Fix something'));
    }
    return panel;
  }
  if (p.read_pending) {
    return h('section', { class: 'airead', 'aria-label': 'Sig is reading', 'data-reading': p.id },
      sig(40, 'think'), h('div', {}, h('div', { class: 'kick' }, 'Sig is reading'), h('p', {}, 'I’m reading how it went, for the Signal. This takes a moment; the page updates by itself.')));
  }
  if (mine) {
    return h('section', { class: 'airead' }, sig(40, 'curious'),
      h('div', { class: 'grow' }, h('div', { class: 'kick' }, 'Not in the Signal yet'),
        h('p', {}, 'I couldn’t tell how it went. Tell me and your report counts:'),
        h('div', { class: 'confirm' }, taps(Object.entries(OUTCOME).map(([k, [label]]) => [k, label]), null, (v, btn) => saveRead(p, { outcome: v, confirm: true }, btn, () => {
          sigSay(['Got it: ', h('b', {}, OUTCOME[v][0]), '. Your own word counts more than my read.'], 'happy', 4200);
          refresh();
        })))));
  }
  return null;
}

// The latest check-in, as the post shows it to everyone
export function checkinLine(p) {
  const c = p.checkin;
  if (!c || !OUTCOME[c.outcome]) return null;
  const state = c.still_taking ? 'still taking it' : `stopped${c.stop_reason ? ` (${lower(STOPPED[c.stop_reason])})` : ''}`;
  return h('div', { class: 'checkin-line' }, icon('clock', 15),
    h('span', {}, h('b', {}, `${c.week} weeks on: `), `${OUTCOME[c.outcome][0]}, ${state}.`));
}

// item: { post_id, week, compound_name, title }
export function checkinBox(item, onDone, opts = {}) {
  const answer = { outcome: null, still: null, reason: null };
  const box = h('section', { class: `card checkin ${opts.dark ? 'dark' : ''}`.trim(), 'aria-label': 'How is it now?', 'data-checkin': item.post_id });
  const send = async (btn) => {
    btn.disabled = true;
    const { error } = await Checks.checkIn({ post_id: item.post_id, week: item.week, outcome: answer.outcome, still_taking: answer.still, stop_reason: answer.reason });
    btn.disabled = false;
    if (error) { toast(friendly(error)); return; }
    track('check_in', { week: item.week, still: answer.still });
    await afterEarn(btn, '· thanks for checking in');
    await refreshSignal();
    // After the last check-in (12 weeks) there's no next one to text about
    const offer = item.week < 12 ? textsChoice({ compact: true }) : null;
    box.replaceChildren(...[h('div', { class: 'row nw' }, sig(44, 'cheer'),
      h('p', { class: 'small' }, h('b', {}, 'Thanks. '), `Your report now says how it is ${item.week} weeks on, and it counts more in the ${item.compound_name} Signal.`)), offer].filter(Boolean));
    onDone?.();
  };
  const draw = () => {
    const steps = [
      h('div', { class: 'ci-q' }, h('span', { class: 'small' }, 'Compared with before you started:'),
        taps(Object.entries(OUTCOME).map(([k, [label]]) => [k, label]), answer.outcome, (v) => { answer.outcome = v; draw(); })),
    ];
    if (answer.outcome) {
      steps.push(h('div', { class: 'ci-q' }, h('span', { class: 'small' }, 'Still taking it?'),
        taps([[true, 'Yes'], [false, 'No, I stopped']], answer.still, (v, btn) => { answer.still = v; answer.reason = null; if (v) send(btn); else draw(); })));
    }
    if (answer.outcome && answer.still === false) {
      steps.push(h('div', { class: 'ci-q' }, h('span', { class: 'small' }, 'What made you stop?'),
        taps([...Object.entries(STOPPED), [null, 'Rather not say']], undefined, (v, btn) => { answer.reason = v; send(btn); })));
    }
    box.replaceChildren(
      h('div', { class: 'row nw' }, sig(40, 'curious'),
        h('div', { class: 'grow' }, h('div', { class: 'kick' }, `How is it now? · ${item.week} weeks on`),
          h('b', {}, item.compound_name), item.title ? h('div', { class: 'xs muted' }, item.title) : null)),
      ...steps);
  };
  draw();
  return box;
}

// Check-in texts, by the member's choice: a text when a report is due for its check-in. Only
// shown once texts are set up for the community (C.checkinTexts: the CHECKIN_TEXTS variable,
// set once the messaging service is registered with US carriers). compact: the one-line offer
// after a check-in, shown only to members who haven't turned them on.
export function textsChoice({ compact = false } = {}) {
  if (!C.checkinTexts) return null;
  const box = h('div', { class: compact ? 'texts-offer' : 'texts-choice', 'aria-live': 'polite' });
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
  const terms = 'At most one a day, between 9am and 8pm your time, and they never say what you took. Message and data rates may apply. Reply STOP to stop or HELP for help. Your number is never shared.';
  const draw = (on) => {
    const btn = h('button', {
      class: on ? 'btn ghost sm' : 'btn lime sm', type: 'button',
      onclick: async () => {
        btn.disabled = true;
        const { data, error } = await Checks.setTexts(!on, tz);
        btn.disabled = false;
        if (error) { toast(friendly(error)); return; }
        track('checkin_texts', { on: !on });
        if (compact && !on) { box.replaceChildren(icon('check', 16), h('span', { class: 'small' }, 'Done: you’ll get a text when the next one is due. Turn them off any time in Account.')); return; }
        draw(!!data?.on);
      },
    }, on ? 'Stop check-in texts' : compact ? 'Text me next time' : 'Text me when a check-in is due');
    if (compact) {
      box.replaceChildren(icon('phone', 16), h('span', { class: 'small' }, 'Want a text when the next check-in is due? ', h('span', { class: 'xs muted' }, terms)), btn);
      return;
    }
    box.replaceChildren(
      h('p', {}, on ? h('b', {}, 'On. ') : null, 'A text when one of your reports is due for a check-in: 2, 6 and 12 weeks after you post it. ', h('span', { class: 'small muted' }, terms)),
      h('div', { class: 'row' }, btn));
  };
  Checks.texts().then(({ data }) => {
    const on = !!data?.on;
    if (compact && on) { box.remove(); return; }
    draw(on);
  });
  return box;
}

// The check-in due now on Home, if any (the oldest report first)
export async function dueCheckin(onDone) {
  const { data } = await Checks.due();
  const item = data && data[0];
  return item ? checkinBox(item, onDone) : null;
}

export async function focusCard() {
  const { data } = await Members.focus();
  const open = (data || []).filter((f) => f.reports < f.goal);
  if (!open.length) return null;
  return h('section', { class: 'card focus' },
    h('div', { class: 'card-h' }, h('span', { class: 'kick' }, 'Filling these first'), h('span', { class: 'xs muted' }, `${fmtN(open.length)} to go`)),
    h('p', { class: 'xs muted' }, 'Ten members’ reports unlock the community’s own rating for each. Taken one of these? Yours counts most here.'),
    h('div', { class: 'focus-list' }, open.map((f) => h('a', { class: 'focus-i', href: `#/new?c=${encodeURIComponent(f.compound_id)}` },
      h('span', { class: 'focus-n' }, h('b', {}, f.compound_name), ` for ${lower(f.use_label)}`),
      h('span', { class: 'focus-c mono' }, `${fmtN(f.reports)} of ${fmtN(f.goal)}`),
      bar((100 * f.reports) / Math.max(1, f.goal))))));
}
