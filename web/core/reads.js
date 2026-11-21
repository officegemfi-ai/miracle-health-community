// Sig's read of a report, as its author sees it, and the choices offered when fixing it. Pure.

import { OUTCOME } from './signal.js';

// How long, in the words the database reads into weeks (private.weeks_of)
export const HOW_LONG = ['Under a week', '1–4 weeks', '1–3 months', '3–6 months', '6 months or more'];

// A sentence's first letter in lower case, to run on inside another
export const lower = (s) => String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1);

// Sig's read of a report in one line, as sentences (never bits strung on dots): how it went and how
// far in, what for, then the side effects. useLabel names a use. It ends without its full stop.
export function readLine(p, useLabel) {
  const uses = (p.read_uses || []).map((u) => `${lower(useLabel(u.use))}${u.outcome !== p.outcome && OUTCOME[u.outcome] ? ` (${lower(OUTCOME[u.outcome][0])})` : ''}`);
  return `${[OUTCOME[p.outcome][0], p.duration ? `${lower(p.duration)} in` : null, uses.length ? `for ${uses.join(', ')}` : null].filter(Boolean).join(', ')}. ${
    (p.side_effects || []).length ? `Side effects: ${p.side_effects.map(lower).join(', ')}` : 'No side effects'}`;
}

// What it may have been for: the uses people mention most for this compound (x, its Signal),
// then the rest of the list of uses
export function likelyUses(x, uses) {
  const seen = (x?.by_use || []).map((u) => u.use);
  const all = (uses?.uses || []).map((u) => u.id);
  return [...new Set([...seen, ...all])];
}
