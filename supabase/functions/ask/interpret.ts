// The Interpretation agent, the last of Sig's agents in a turn. Once the answer is out, it reasons
// through everything the others found (the Evidence librarian's findings, the Relatives, Mechanism,
// Combination and Markers agents' notes, what the community reports, the fact sheets), strictly
// about efficacy: how likely it is that what the member asked about works for what they want, how
// big the effect could be and how sure anyone can be. It thinks at length with the strongest model,
// and its read goes through the gate like every other part, then shows as a card under the answer.
import { ApiError, form, retry } from './claude.ts';
import { INTERPRET_SYSTEM, INTERPRET_TOOL } from './prompts.ts';
import { cleanField } from './guard.ts';
import { blockedItem } from './community.ts';
import { markers, nonce, wrap } from './fence.ts';
import { step } from './context.ts';
import type { Turn } from './readers.ts';

export const VERDICTS = ['likely', 'plausible', 'unlikely', 'unclear'] as const;
const SIZES = ['large', 'moderate', 'small', 'unclear'] as const;
const CONFIDENCE = ['high', 'moderate', 'low', 'very low'] as const;
const RUNGS = ['together', 'own', 'relative', 'mechanism', 'community', 'none'] as const;
type Verdict = typeof VERDICTS[number];
export type Read = {
  subject: string; verdict: Verdict; proven: boolean;
  size: typeof SIZES[number]; size_note: string;
  confidence: typeof CONFIDENCE[number]; confidence_note: string;
  would_change: string; summary: string;
  steps: { link: string; read: string; rung: typeof RUNGS[number] }[];
};

// What the guide is told when the Interpretation agent will follow it
export const INTERPRET_NOTE = 'after your answer, it reasons through everything above, strictly for efficacy, and its read shows under your answer: give the evidence, and leave the overall verdict on whether it works to it.';

// The whole turn has two minutes (index.ts); the read gets at most one of them, and gives up
// early rather than cost the member the rest of their answer
const TURN_MS = 120_000;
const REASON_MS = 60_000;
const MARGIN_MS = 12_000;
const MIN_MS = 10_000;

// The verdict as the member reads it
export const verdictLabel = (r: Pick<Read, 'verdict'>) => (r.verdict === 'plausible' ? 'plausible, unproven' : r.verdict);

// Whether it runs this turn: an adult asked about compounds they named, for something they want.
// Not when something comes before efficacy (a crisis, an emergency, someone under 18, a reaction
// happening now, pregnancy, a compound on FDA's safety-risk list), and not for a comparison, which
// never picks a winner.
export function interprets(turn: Turn, named: string[], comparing: boolean): boolean {
  const { held, screen, pregnant, ctx } = turn;
  if (held || comparing || pregnant || screen.reaction || !named.length) return false;
  if (!screen.goals.length && !screen.uses.length) return false;
  return !named.some((id) => blockedItem(ctx.byId.get(id), ctx.byId));
}

const pick = <T extends string>(v: unknown, list: readonly T[], or: T): T => ((list as readonly string[]).includes(String(v)) ? (v as T) : or);
// The form as it came back, tidied: no read without a verdict, a summary and a step to show
export function tidyRead(x: unknown): Read | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const verdict = pick(r.verdict, VERDICTS, '' as Verdict);
  const steps = (Array.isArray(r.steps) ? r.steps : []).slice(0, 6).map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return { link: cleanField(o.link, 50), read: cleanField(o.read, 140), rung: pick(o.rung, RUNGS, 'none') };
  }).filter((s) => s.link && s.read);
  const summary = cleanField(r.summary, 300);
  if (!verdict || !summary || !steps.length) return null;
  return {
    subject: cleanField(r.subject, 80), verdict, proven: r.proven === true && verdict === 'likely',
    size: pick(r.size, SIZES, 'unclear'), size_note: cleanField(r.size_note, 120),
    confidence: pick(r.confidence, CONFIDENCE, 'low'), confidence_note: cleanField(r.confidence_note, 120),
    would_change: cleanField(r.would_change, 140), summary, steps,
  };
}

// The read: the agent thinks it through and fills in its form; the gate checks every line; the
// card goes out under the answer. Null when there's no read to show.
export async function interpretStage(turn: Turn, named: string[], brief: string, t0: number): Promise<Read | null> {
  const { deps, gate, ctx, last } = turn;
  const id = 'interpretation';
  const agent = 'interpretation';
  const left = TURN_MS - (Date.now() - t0) - MARGIN_MS;
  if (left < MIN_MS) {
    step(ctx, { id, agent, status: 'done', title: 'No time left for the efficacy read this turn' });
    return null;
  }
  step(ctx, { id, agent, status: 'run', title: 'Reasoning it all through, for efficacy' });
  const code = nonce();
  const prompt = [
    markers(code),
    `What they named: ${named.map((n) => ctx.byId.get(n)?.name ?? n).join(', ')}.`,
    wrap(code, 'the member\'s latest message', last.slice(0, 2000)),
    wrap(code, 'the agents\' notes for this turn', brief),
    gate.released.trim() ? wrap(code, 'Sig\'s answer, already shown to the member', gate.released.slice(-6000)) : '',
    'Reason it through, then record your efficacy read with the interpret tool.',
  ].filter(Boolean).join('\n\n');

  // Its own time limit inside the turn's
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  deps.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop.abort(), Math.min(REASON_MS, left));
  const models = [...new Set([deps.models.reason ?? deps.models.guide, deps.models.guide])];
  let raw: unknown = null;
  try {
    for (const model of models) {
      try {
        raw = await retry(() => form(INTERPRET_TOOL, {
          model, system: INTERPRET_SYSTEM, max_tokens: 16000, effort: deps.reasonEffort ?? 'high',
          messages: [{ role: 'user', content: prompt }],
        }, { apiKey: deps.apiKey, fetchImpl: deps.fetchImpl, signal: stop.signal }), { tries: 2 });
        break;
      } catch (e) {
        // A model this key can't use: the guide's
        if (!deps.signal?.aborted && !stop.signal.aborted && e instanceof ApiError && e.missingModel) continue;
        throw e;
      }
    }
  } catch (e) {
    if (deps.signal?.aborted) throw e;   // the turn itself was stopped
    raw = null;
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', onAbort);
  }

  const read = tidyRead(raw);
  if (!read) {
    step(ctx, { id, agent, status: 'done', title: 'Couldn’t finish the efficacy read just now' });
    return null;
  }
  // Card words skip the gate's number check, so the read keeps only numbers its notes have
  const sourced = (t: string) => !gate.unsourcedIn(t).length;
  const steps = read.steps.filter((s) => sourced(`${s.link} ${s.read}`));
  const label = verdictLabel(read);
  if (!sourced(read.summary) || !steps.length) {
    step(ctx, { id, agent, status: 'done', title: 'The efficacy read used a number its sources don’t have, so it isn’t shown' });
    return null;
  }
  const extra = (key: string, text: string) => (text && sourced(text) ? [{ key, text }] : []);
  const fields = [
    { key: 'v', text: `Efficacy${read.subject ? ` for ${read.subject}` : ''}: ${label}. How big: ${read.size}. How sure: ${read.confidence}.` },
    { key: 'sum', text: read.summary },
    ...steps.map((s, i) => ({ key: `s${i}`, text: `${s.link}: ${s.read}` })),
    ...extra('size', read.size_note), ...extra('conf', read.confidence_note), ...extra('chg', read.would_change),
  ];
  const card = `card${++ctx.stepN}`;
  let shown = false;
  gate.card(fields, (ok) => {
    const kept = steps.filter((_, i) => ok.has(`s${i}`));
    if (!ok.has('v') || !ok.has('sum') || !kept.length) return null;
    shown = true;
    step(ctx, { id, agent, status: 'done', title: `Reasoned it all through for efficacy: ${label}` });
    ctx.memo.push(`the Interpretation agent's efficacy read: ${label}, ${read.size} effect, ${read.confidence} confidence: ${read.summary}`);
    return {
      type: 'interpretation', id: card, subject: read.subject, verdict: read.verdict, label, proven: read.proven,
      size: read.size, size_note: ok.has('size') ? read.size_note : '',
      confidence: read.confidence, confidence_note: ok.has('conf') ? read.confidence_note : '',
      would_change: ok.has('chg') ? read.would_change : '', summary: read.summary, steps: kept,
    };
  }, { count: false, tag: 'interpretation' });
  await gate.drain();
  if (!shown) step(ctx, { id, agent, status: 'done', title: 'The efficacy read wasn’t cleared by the Safety agent, so it isn’t shown' });
  return shown ? read : null;
}
