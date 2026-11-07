// The Evidence librarian and the Relatives agent on the compounds a member named, and the
// evidence ladder the screen draws from what they found.
import type { Axis } from './library.ts';
import { type Evidence, evidenceFor, evidenceLines, evidenceTitle, type Plan } from './outcomes.ts';
import { candidatesFor, type Pairing, type Related, relativesNote, relativesTitle } from './relatives.ts';
import type { Mechanism } from './mechanism.ts';
import { chip, type Ctx, nextId, openSheets } from './context.ts';

// The Relatives agent on the compounds named: the closest relatives (the hormone a compound raises;
// for a hormone, what raises it; or what acts on the same receptor), their sheets read by the
// Evidence librarian for what the Planner read; at most two with findings per compound, six sheets
export async function relativesStep(ids: string[], own: Evidence[], axes: Axis[], ctx: Ctx): Promise<{ note: string; rel: Related[] }> {
  if (!axes.length) return { note: '', rel: [] };
  const exclude = new Set(ids);
  // Siblings on the same receptor only stand in when a compound's own sheet has nothing on it
  const per = ids.map((id) => candidatesFor(id, axes, exclude)
    .filter((c) => ctx.byId.has(c.id) && ctx.byId.get(c.id)!.sheet !== false && (c.kin !== 'receptor' || !own.find((e) => e.id === id)?.found.length)).slice(0, 3));
  const want = [...new Set(per.flat().map((c) => c.id))].slice(0, 6);
  if (!want.length) return { note: '', rel: [] };
  ctx.emit('step', { id: 'relatives', agent: 'relatives', status: 'run', title: 'Looking at relatives through the same hormone or receptor' });
  await openSheets(want, ctx);
  const rel: Related[] = [];
  ids.forEach((id, i) => {
    let n = 0;
    for (const c of per[i]) {
      if (n >= 2 || !want.includes(c.id)) continue;
      const ev = evidenceFor(c.id, ctx.byId.get(c.id)!.name, ctx.sheets.get(c.id), ctx.plan.outcomes);
      if (!ev.found.length) continue;
      n++;
      rel.push({ ...c, name: ev.name, ofName: ctx.byId.get(id)!.name, ev, own: own.find((e) => e.id === id)?.found.length ?? 0 });
    }
  });
  rel.forEach((r) => ctx.opened.add(r.id));
  ctx.emit('step', { id: 'relatives', agent: 'relatives', status: 'done', title: relativesTitle(rel), chips: [...new Set(rel.map((r) => r.id))].map((id) => chip(id, ctx)) });
  return { note: relativesNote(rel, ctx.plan), rel };
}
// What the screen draws as the evidence ladder for what the Planner read: each compound's own
// findings, its relatives', how it could bear on it, and how the compounds relate (all from the
// Library's own sheets and pathways)
export type Ladder = { own: Evidence[]; rel: Related[]; mech: Mechanism[]; pairs: Pairing[] };
export function ladderOf(l: Ladder, plan: Plan) {
  const found = (e: Evidence) => e.found.map((f) => ({ outcome: f.outcome, claim: f.claim, grade: f.evidence, src: f.src ?? [] }));
  return {
    outcomes: plan.outcomes.map((o) => ({ id: o.id, label: o.label, related: !!o.related })),
    rows: l.own.map((e) => ({ id: e.id, sheet: e.sheet, found: found(e), how: l.mech.find((m) => m.id === e.id)?.how ?? '', howFrom: l.mech.find((m) => m.id === e.id)?.from ?? null })),
    via: l.rel.map((r) => ({ of: r.of, id: r.id, kin: r.kin, axis: r.axis.name, found: found(r.ev) })),
    pairs: l.pairs.map((x) => ({ a: x.a, b: x.b, kind: x.kind, on: x.on })),
  };
}
// The Evidence librarian on the fact sheets just opened: their findings on what the Planner read,
// for the guide and for the final check (rule 9)
export function evidenceStep(ids: string[], ctx: Ctx): Evidence[] {
  const ev = ids.filter((id) => ctx.byId.has(id)).map((id) => evidenceFor(id, ctx.byId.get(id)!.name, ctx.sheets.get(id), ctx.plan.outcomes, ctx.unread.has(id)));
  if (!ev.length) return ev;
  ctx.emit('step', { id: nextId(ctx, 'ev'), agent: 'evidence', status: 'done', title: evidenceTitle(ev), chips: ev.filter((e) => e.found.length).map((e) => chip(e.id, ctx)) });
  ctx.gate.findings(evidenceLines(ev));
  return ev;
}
