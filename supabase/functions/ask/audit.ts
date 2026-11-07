import { form, retry } from './claude.ts';
import { familyOne, type Item, type Sheet } from './library.ts';
import { AUDIT_SYSTEM, AUDIT_TOOL } from './prompts.ts';
import { cleanField } from './guard.ts';
import { markers, nonce, strs, wrap } from './fence.ts';
import type { Audit, Finding, TurnDeps } from './types.ts';

// ---------------------------------------------------------------------------
// The Synergy auditor
// ---------------------------------------------------------------------------
function auditNotes(ids: string[], byId: Map<string, Item>, sheets: Map<string, Sheet | null>): string {
  return ids.map((id) => {
    const it = byId.get(id);
    const sh = sheets.get(id);
    if (!it) return '';
    if (!sh) return `- ${it.name} [${id}] (${familyOne(it.family)}, ${it.category}${it.parts.length ? `, blend of ${it.parts.join(', ')}` : ''}): no fact sheet yet.`;
    return `- ${sh.name} [${id}] (${familyOne(it.family)}, ${it.category}; US status: ${sh.status_us?.label ?? '?'})\n  What it is: ${String(sh.what_it_is ?? '').slice(0, 420)}\n  Interactions: ${(sh.interactions ?? []).join('; ') || 'none listed'}\n  Avoid or check first: ${(sh.avoid_if ?? []).join('; ') || 'none listed'}\n  Main risks: ${(sh.risks ?? []).slice(0, 3).map((r) => r.risk).join('; ')}`;
  }).filter(Boolean).join('\n');
}

export async function auditSet(
  ids: string[], meds: string[], conditions: string[], pregnant: boolean,
  ctx: { byId: Map<string, Item>; sheets: Map<string, Sheet | null>; ownMeds?: Set<string> }, deps: TurnDeps,
): Promise<Audit> {
  const code = nonce();
  const prompt = [
    markers(code),
    `Compounds to check together (from Miracle Health's Library):\n${auditNotes(ids, ctx.byId, ctx.sheets)}`,
    wrap(code, 'the member\'s medicines, in their words', meds.join('; ') || 'none mentioned'),
    wrap(code, 'the member\'s conditions, in their words', `${conditions.join('; ') || 'none mentioned'}${pregnant ? '; pregnant, trying to conceive or breastfeeding' : ''}`),
  ].join('\n\n');
  try {
    const raw = await retry(() => form<{ findings?: unknown; summary?: unknown }>(AUDIT_TOOL, {
      model: deps.models.fast, system: AUDIT_SYSTEM, max_tokens: 1200, messages: [{ role: 'user', content: prompt }],
    }, { apiKey: deps.apiKey, fetchImpl: deps.fetchImpl, signal: deps.signal }), { tries: 2 });
    const known = new Set(ids);
    const own = ctx.ownMeds ?? new Set<string>();
    const findings = (Array.isArray(raw?.findings) ? raw!.findings as Record<string, unknown>[] : [])
      // "Never studied together" says nothing found: the card already says that when there's
      // nothing to report, so it isn't a finding
      .filter((f) => String(f.level) !== 'unknown')
      .map((f) => ({
        ids: strs(f.ids, 2, 40).filter((i) => known.has(i)),
        kind: ['overlap', 'additive', 'interaction', 'member'].includes(String(f.kind)) ? String(f.kind) : 'info',
        level: (['avoid', 'caution', 'info'].includes(String(f.level)) ? f.level : 'info') as Finding['level'],
        note: cleanField(f.note, 180),
      }))
      .filter((f) => f.ids.length && f.note)
      // The member's own prescribed medicines together are their prescriber's business
      .filter((f) => !(f.ids.length > 1 && f.ids.every((i) => own.has(i))))
      .map((f) => (f.ids.some((i) => own.has(i))
        ? { ...f, note: `${f.note.replace(/[.\s]+$/, '')}. Don’t stop or change your medicine on your own; ask your prescriber.` }
        : f))
      // Each thing once: one finding per compound or pair, the most serious (the first of equals)
      .filter((f, i, all) => {
        const key = (g: typeof f) => [...g.ids].sort().join('+');
        const rank = (g: typeof f) => ['info', 'caution', 'avoid'].indexOf(g.level);
        const top = Math.max(...all.filter((g) => key(g) === key(f)).map(rank));
        return rank(f) === top && all.findIndex((g) => key(g) === key(f) && rank(g) === top) === i;
      })
      .slice(0, 8);
    return { findings, summary: cleanField(raw?.summary, 240), ok: !!raw };
  } catch (e) {
    if (deps.signal?.aborted) throw e;
    return { findings: [], summary: '', ok: false };
  }
}

export function auditTitle(a: Audit, n: number): string {
  if (!a.ok) return 'Couldn’t run the check this time';
  const pairs = (n * (n - 1)) / 2;
  const avoid = a.findings.filter((f) => f.level === 'avoid').length;
  const caution = a.findings.filter((f) => f.level === 'caution').length;
  const head = n > 1 ? `${pairs} pair${pairs === 1 ? '' : 's'} checked` : 'Checked against your medicines and conditions';
  const tail = [avoid ? `${avoid} to avoid` : '', caution ? `${caution} caution${caution === 1 ? '' : 's'}` : ''].filter(Boolean);
  return tail.length ? `${head} · ${tail.join(' · ')}` : `${head} · no known clashes (absence of data, not a green light)`;
}

export function auditText(a: Audit, byId: Map<string, Item>): string {
  if (!a.ok) return 'The Synergy auditor could not run; don\'t claim the set was checked.';
  const name = (id: string) => byId.get(id)?.name ?? id;
  const lines = a.findings.map((f) => `- [${f.level}] ${f.ids.map(name).join(' + ')} (${f.kind}): ${f.note}`);
  return `${a.summary || ''}\n${lines.join('\n') || '- No known clashes in the data (an absence of data, not a green light).'}`.trim();
}
