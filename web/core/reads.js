// Sig's read of a report, as its author sees it, and the choices offered when fixing it. Pure.

import { OUTCOME } from './signal.js';

// How long, in the words the database reads into weeks (private.weeks_of)
export const HOW_LONG = ['Under a week', '1–4 weeks', '1–3 months', '3–6 months', '6 months or more'];

// A sentence's first letter in lower case, to run on inside another
export const lower = (s) => String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1);

// Sig's read of a report in one line: how it went, how long, what for, side effects. useLabel
// names a use.
export function readLine(p, useLabel) {
  const uses = (p.read_uses || []).map((u) => `${lower(useLabel(u.use))}${u.outcome !== p.outcome && OUTCOME[u.outcome] ? ` (${lower(OUTCOME[u.outcome][0])})` : ''}`);
  return [OUTCOME[p.outcome][0], p.duration, uses.length ? `for ${uses.join(', ')}` : null,
    (p.side_effects || []).length ? `side effects: ${p.side_effects.join(', ')}` : 'no side effects'].filter(Boolean).join(' · ');
}

// What it may have been for: the uses people mention most for this compound (x, its Signal),
// then the rest of the list of uses
export function likelyUses(x, uses) {
  const seen = (x?.by_use || []).map((u) => u.use);
  const all = (uses?.uses || []).map((u) => u.id);
  return [...new Set([...seen, ...all])];
}
