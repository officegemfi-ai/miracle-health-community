// Two more of Sig's agents, plain code over the Library's pathways (axes.json, written from each
// member's own fact sheet):
//   the Relatives agent finds, for each compound named, the compounds that work through the same
//   hormone or receptor and have findings on what the Planner read. They stand a rung below the
//   compound's own studies: a compound that raises a hormone the body makes gets that hormone's
//   findings as "expected from how it works, not tested"; the hormone itself gets the findings of
//   what raises it as support through the same hormone, never as a test of it;
//   the Combination agent says how compounds taken together relate: the same receptor (overlap),
//   the same hormone by different routes (its effects and risks can add up), or different
//   pathways (separate roads to the goal; only a study of the pair shows whether they add up).
import type { Axis, AxisMember } from './library.ts';
import { type Evidence, type Plan, evidenceNoteLines } from './outcomes.ts';

export type Kin = 'hormone' | 'raises' | 'receptor';
export type Candidate = { of: string; id: string; kin: Kin; axis: Axis; ofHow: string; how: string };

const memberOf = (axis: Axis, id: string) => axis.members.find((m) => m.id === id);
const shares = (a: AxisMember, b: AxisMember) => a.via.some((v) => b.via.includes(v));

// The Relatives agent's candidates for one compound, closest first: the hormone it raises; for the
// hormone itself, what raises it; with no hormone, what acts on the same receptor
export function candidatesFor(id: string, axes: Axis[], exclude: Set<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const axis of axes) {
    const me = memberOf(axis, id);
    if (!me) continue;
    const add = (m: AxisMember, kin: Kin) => { if (!exclude.has(m.id) && m.id !== id && !out.some((c) => c.id === m.id)) out.push({ of: id, id: m.id, kin, axis, ofHow: me.how, how: m.how }); };
    if (axis.hormone && axis.hormone !== id) {
      const h = memberOf(axis, axis.hormone);
      if (h) add(h, 'hormone');
    } else if (axis.hormone === id) {
      axis.members.filter((m) => m.id !== id).forEach((m) => add(m, 'raises'));
    } else {
      axis.members.filter((m) => shares(m, me)).forEach((m) => add(m, 'receptor'));
    }
  }
  return out;
}

export type Related = Candidate & { name: string; ofName: string; ev: Evidence; own: number };
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function relativesTitle(rel: Related[]): string {
  const names = [...new Set(rel.map((r) => r.name))];
  return names.length ? `Found evidence through ${listOf(names)}` : 'No relative has findings on these';
}
// For Sig's notes: each relative's findings once, whose evidence it is, and how to say it (two
// compounds that raise the same hormone share its line)
export function relativesNote(rel: Related[], plan: Plan): string {
  if (!rel.length) return '';
  const groups: Related[][] = [];
  for (const r of rel) {
    const g = groups.find((x) => x[0].id === r.id && x[0].kin === r.kin && r.kin === 'hormone');
    if (g) g.push(r); else groups.push([r]);
  }
  const lines = groups.map((g) => {
    const r = g[0];
    const ofs = listOf(g.map((x) => x.ofName));
    const found = evidenceNoteLines(r.ev);
    if (r.kin === 'hormone') {
      const how = g.map((x) => `${x.ofName} ${x.ofHow}`).join('; ');
      const none = g.filter((x) => !x.own).map((x) => x.ofName);
      return `- ${how} (from ${g.length > 1 ? 'their' : 'its'} fact sheet${g.length > 1 ? 's' : ''}). ${r.name}'s own findings: ${found}. These are ${r.name}'s evidence: for ${ofs} they're expected from how ${g.length > 1 ? 'they work' : 'it works'}, not tested${none.length ? ` (${listOf(none)} ha${none.length > 1 ? 've' : 's'} no finding on this in ${none.length > 1 ? 'their' : 'its'} own fact sheet${none.length > 1 ? 's' : ''})` : ''}.`;
    }
    if (r.kin === 'raises') return `- ${r.ofName} ${r.ofHow}; ${r.name} ${r.how}. ${r.name}'s findings: ${found}. They support what raising ${r.axis.name} does; they aren't a test of ${r.ofName} itself.`;
    return `- ${r.ofName} and ${r.name} both act on ${r.axis.name}. ${r.name}'s findings: ${found}. They're evidence for ${r.name}: for ${r.ofName} they're expected from how it works, not tested.`;
  });
  const what = listOf(plan.outcomes.map((o) => o.label));
  return `Relatives agent, a rung below each compound's own studies on ${what} (never proof for it, and the relative's risks aren't its risks; say whose evidence each one is, and who was studied):\n${lines.join('\n')}`;
}

export type Pairing = { a: string; b: string; kind: 'overlap' | 'same' | 'apart'; on: string[] };
// The Combination agent: how each pair of the compounds named relate, by their pathways
export function pairings(ids: string[], axes: Axis[]): Pairing[] {
  const out: Pairing[] = [];
  const of = (id: string) => axes.filter((x) => memberOf(x, id));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [ids[i], ids[j]];
      const ax = of(a), bx = of(b);
      if (!ax.length || !bx.length) continue;
      const both = ax.filter((x) => bx.includes(x));
      if (!both.length) { out.push({ a, b, kind: 'apart', on: [ax[0].name, bx[0].name] }); continue; }
      const overlap = both.find((x) => shares(memberOf(x, a)!, memberOf(x, b)!));
      out.push(overlap ? { a, b, kind: 'overlap', on: [overlap.name] } : { a, b, kind: 'same', on: [both[0].name] });
    }
  }
  return out;
}
export function pairingTitle(p: Pairing[], name: (id: string) => string): string {
  const x = p.find((y) => y.kind === 'overlap') ?? p.find((y) => y.kind === 'same') ?? p[0];
  const more = p.length > 1 ? ` (and ${p.length - 1} more pair${p.length === 2 ? '' : 's'})` : '';
  return (x.kind === 'overlap' ? `Overlap: ${name(x.a)} and ${name(x.b)} both act on ${x.on[0]}`
    : x.kind === 'same' ? `Same hormone by different routes: ${x.on[0]}`
    : `Different pathways: ${x.on[0]} and ${x.on[1]}`) + more;
}
export function pairingNote(p: Pairing[], name: (id: string) => string): string {
  if (!p.length) return '';
  const lines = p.map((x) => {
    const pair = `${name(x.a)} and ${name(x.b)}`;
    return x.kind === 'overlap' ? `- ${pair} both act on ${x.on[0]}: they overlap, so little extra is expected from taking both, while side effects add up. Whether to take both is a question for their prescriber.`
      : x.kind === 'same' ? `- ${pair} both work on ${x.on[0]}, by different routes: its effects, and its risks, can add up. Whether to take both is a question for their clinician.`
      : `- ${pair} work through different pathways (${x.on[0]}; ${x.on[1]}): separate roads to a goal in theory, and only a study of the two together can show whether they add up (your other notes and their fact sheets say whether there is one).`;
  });
  return `Combination agent, from the Library's pathways (each member's fact sheet), for what they named together:\n${lines.join('\n')}`;
}
