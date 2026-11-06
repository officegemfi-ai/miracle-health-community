// The Mechanism agent, plain code: how each compound named could bear on what the Planner read,
// in the words of its own fact sheet (the sentences of "what it is" that are about it), or else
// the pathway it works through (axes.json, written from the same sheet). Always said as expected
// from how it works, not tested: how something works is a reason to study it, never proof.
import { cleanField, strict } from './guard.ts';
import type { Axis, Sheet } from './library.ts';
import type { Plan } from './outcomes.ts';

export type Mechanism = { id: string; name: string; how: string; from: 'sheet' | 'pathway' | null };
const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function mechanismFor(id: string, name: string, sheet: Sheet | null | undefined, plan: Plan, axes: Axis[]): Mechanism {
  const sentences = String(sheet?.what_it_is ?? '').split(/(?<=[.;])\s+(?=[A-Za-z])/).map((s) => s.trim()).filter(Boolean);
  const hits = sentences.filter((s) => plan.outcomes.some((o) => o.found.test(s)));
  if (hits.length) return { id, name, how: cleanField(strict(capFirst(hits.slice(0, 2).join(' ').replace(/;$/, '.'))), 280), from: 'sheet' };
  const m = axes.flatMap((a) => a.members).find((x) => x.id === id);
  if (m?.how) return { id, name, how: cleanField(`${capFirst(m.how)}.`, 220), from: 'pathway' };
  return { id, name, how: '', from: null };
}

const listOf = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const main = (plan: Plan) => plan.outcomes.find((o) => !o.related)?.label ?? plan.outcomes[0]?.label ?? 'it';
export const mechanismTitle = (plan: Plan) => `Read how each could bear on ${main(plan)}`;
export function mechanismNote(ms: Mechanism[], plan: Plan): string {
  const known = ms.filter((m) => m.how);
  if (!known.length) return '';
  return `Mechanism agent, how each could bear on ${listOf(plan.outcomes.filter((o) => !o.related).map((o) => o.label))}, from its own fact sheet (say it as expected from how it works, not tested):\n${known.map((m) => `- ${m.name}${m.from === 'pathway' ? ' (its pathway)' : ''}: ${m.how}`).join('\n')}`;
}
