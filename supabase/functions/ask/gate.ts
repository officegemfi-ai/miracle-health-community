import { form, retry } from './claude.ts';
import { REVIEW_SYSTEM, REVIEW_TOOL } from './prompts.ts';
import { maskTargets, scan, strict, unmaskTargets } from './guard.ts';
import { markers, nonce, wrap } from './fence.ts';
import type { Standing } from './screen.ts';
import type { Emit, Screen, TurnDeps } from './types.ts';

// ---------------------------------------------------------------------------
// The gate: the Safety agent reads every part of a reply, the words and the cards, before
// the member sees it. Parts are paragraphs (and each card's labels); they're checked in
// small batches while the guide keeps writing, and go out in order.
// ---------------------------------------------------------------------------
type Fix = { find: string; replace: string };

// ---------------------------------------------------------------------------
// The number check: a number in a reply should come from what Sig was given (its
// instructions, the notes and fact sheets for the turn, what the tools returned, the member's own
// words). One that doesn't (like "51 forum posts" when the notes said 51 Signals) is flagged to the
// Safety agent's check, which cuts it or says it without a number. Small counts (up to 12) need
// no source; numbers in names (BPC-157, GLP-1, 5-HTP) aren't numbers.
// ---------------------------------------------------------------------------
const SOURCE_NUM = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const REPLY_NUM = /(?<![\w.\-\/])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\w\-]|\.\d|\/\d)/g;
const numKey = (raw: string) => {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '';
};
export function sourceNumbers(text: string, into: Set<string> = new Set()): Set<string> {
  for (const m of String(text ?? '').matchAll(SOURCE_NUM)) {
    const k = numKey(m[0]);
    if (!k) continue;
    into.add(k);
    // A decimal also stands for its whole number either way ("74.6" covers "about 75")
    const n = Number(k);
    if (!Number.isInteger(n)) { into.add(String(Math.floor(n))); into.add(String(Math.ceil(n))); }
  }
  return into;
}
// Numbers that need no source: phone numbers ("(800) 222-1222"), temperatures ("100.4°F") and
// years ("a 2019 review")
const PHONE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|\b1[-.\s]\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g;
const TEMPERATURE = /\b\d{2,3}(?:\.\d)?\s?(?:°\s?[FC]\b|degrees\b)/gi;
const isYear = (k: string) => /^(?:19|20)\d{2}$/.test(k);
export function unsourcedNumbers(text: string, known: Set<string>): string[] {
  const plain = String(text ?? '').replace(/\]\([^)]*\)/g, ']').replace(PHONE, ' ').replace(TEMPERATURE, ' ');
  const out: string[] = [];
  for (const m of plain.matchAll(REPLY_NUM)) {
    const k = numKey(m[1] + (m[2] ?? ''));
    if (!k || (Number(k) <= 12 && Number.isInteger(Number(k))) || isYear(k) || known.has(k) || out.includes(m[0])) continue;
    out.push(m[0]);
  }
  return out.slice(0, 6);
}
type Verdict = { ok: boolean; revised?: string; broken?: number[]; fixes?: Fix[] };
// Disclaimers belong in the reply's one caution line. A change that only adds one to a part that
// describes benefits (and makes no strong claim) isn't made; a claim that goes too far is softened.
const CAVEAT = /\bnot\s+(?:been\s+)?(?:fda[- ])?(?:approved|established|proven)\b|\bunproven\b|\black(?:s|ing)?\b|\blittle\s+(?:or\s+no\s+)?(?:human\s+)?(?:data|evidence)\b|\bno\s+(?:good\s+|real\s+)?human\b|\bsafety\s+(?:is|are)\s+(?:unknown|not)\b|\bresearch[- ]stage\b|\b(?:isn|aren)'?t\s+approved\b|\b(?:talk|speak|check)\s+(?:to|with)\s+(?:your|a)\s+(?:clinician|doctor|prescriber)\b|\bnot\s+medical\s+advice\b|\bnot\s+a\s+measure\b|\bunverified\b|\b(?:isn|aren)'?t\s+(?:evidence|proof)\b|\bnot\s+(?:evidence|proof)\b/i;
const STRONG = /\b(?:cures?|cured|prevents?|reverses?|safe(?:ly)?|proven|guarantee\w*|definitely|will\s+(?:heal|fix|cure|build|burn|work|repair))\b/i;
export const addsCaveat = (before: string, after: string) => CAVEAT.test(after) && !CAVEAT.test(before) && !STRONG.test(before);
// A sentence said twice in a row in other words ("The studies are animal-only so far. Studies so
// far are animal-only.") is said once: the second goes when most of its words are the first's
const SENTENCE = /[^.!?]+(?:[.!?]+|$)\s*/g;
const wordsOf = (s: string) => new Set(s.toLowerCase().replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').match(/[a-z0-9][a-z0-9'’-]*/g)?.filter((w) => !['the', 'a', 'an'].includes(w)) ?? []);
export function dedupeSentences(text: string): string {
  return String(text ?? '').split('\n').map((line) => {
    const parts = [...line.matchAll(SENTENCE)];
    if (parts.length < 2) return line;
    let prev = '';
    const drop: [number, number][] = [];
    for (const m of parts) {
      if (prev) {
        const a = wordsOf(prev), b = wordsOf(m[0]);
        const shared = [...b].filter((w) => a.has(w)).length;
        if (b.size >= 3 && shared / Math.max(a.size, b.size) >= 0.8) { drop.push([m.index!, m.index! + m[0].length]); continue; }
      }
      prev = m[0];
    }
    if (!drop.length) return line;
    let out = '';
    let at = 0;
    for (const [from, to] of drop) { out += line.slice(at, from); at = to; }
    return (out + line.slice(at)).replace(/\s+$/, '');
  }).join('\n');
}
// What the check's verdict on a part comes to: the part as written, a fixed version, or nothing
export function settle(text: string, v: Verdict): { out: string | null; edited: boolean } {
  const r = settleRaw(text, v);
  return r.out ? { ...r, out: dedupeSentences(r.out) } : r;
}
function settleRaw(text: string, v: Verdict): { out: string | null; edited: boolean } {
  if (v.ok) return { out: text, edited: false };
  const onlyClaims = (v.broken ?? []).length > 0 && (v.broken ?? []).every((n) => n === 4);
  const fixes = (v.fixes ?? []).filter((f) => !(onlyClaims && addsCaveat(f.find, f.replace)));
  const fixed = applyFixes(text, fixes);
  if (fixed) return { out: fixed, edited: true };
  const revised = v.revised?.trim() || '';
  // About claims only, and all the check would do is add a disclaimer: the part stands as written
  if (onlyClaims && !STRONG.test(text) && (v.fixes ?? []).length + (revised ? 1 : 0) > 0
    && (v.fixes ?? []).every((f) => addsCaveat(f.find, f.replace)) && (!revised || addsCaveat(text, revised))) {
    return { out: text, edited: false };
  }
  return revised ? { out: revised, edited: true } : { out: null, edited: false };
}
// The check's smallest changes, applied to the part as written; null if any of them doesn't fit
export function applyFixes(text: string, fixes?: Fix[]): string | null {
  if (!fixes?.length) return null;
  let out = text;
  for (const f of fixes) {
    if (!f.find || !out.includes(f.find)) return null;
    out = out.split(f.find).join(f.replace);
  }
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,;:!?])/g, '$1').trim();
  return out || null;
}
type Field = { key: string; text: string };
type Out =
  | { type: 'text'; text: string; trusted?: boolean }
  | { type: 'card'; fields: Field[]; build: (ok: Set<string>) => Record<string, unknown> | null; first?: boolean; tag?: string };

// Words first: once the guide starts writing, a card it asks for before it has explained its
// answer in this many characters waits, and goes out right after the words
const WORDS_FIRST = 200;

// A part that says nothing is known: the final check is given what the fact sheets do show, so
// it can put back a finding the reply left out (rule 9)
export const DENIES = /\bno\s+(?:good\s+|real\s+|solid\s+|clear\s+|direct\s+|strong\s+|human\s+|clinical\s+|scientific\s+)?(?:evidence|proof|data|studies|research|trials?)\b|\bnothing\s+(?:shows|suggests|proves|is\s+known)\b|\b(?:hasn.t|has\s+not|haven.t|have\s+not|isn.t|is\s+not|aren.t|are\s+not|wasn.t|weren.t|never)\s+(?:been\s+)?(?:studied|tested|shown|proven)\b|\bunstudied\b|\bunproven\b/i;
// An answer that names compounds and never says anything about their risks or status gets the
// Library's own caution line at the end
export const FULL_ANSWER = 400;
export const CAUTIONED = /\b(?:cautions?|risks?|risky|side[- ]effects?|warnings?|warns?|watch\s+for|careful|not\s+(?:fda[- ])?approved|unapproved|illegal|prescriptions?|prescriber|clinician|doctor|physician|monitor(?:ed|ing)?|safety|unsafe|dangerous|clots?)\b/i;

export class Gate {
  released = '';
  cards = 0;
  checked = 0; edited = 0; held = 0; unchecked = 0;
  // Numbers flagged to the check as not found in Sig's sources (for the log)
  unsourced = 0;
  private known = new Set<string>();
  // Everything Sig was given this turn: the numbers in it are the ones a reply may use
  sources(text: string) { sourceNumbers(text, this.known); }
  // What the fact sheets this turn show was studied, for rule 9
  private studied: string[] = [];
  findings(lines: string[]) { this.studied = [...new Set([...this.studied, ...lines.map((l) => l.slice(0, 320))])].slice(0, 12); }
  // Which rules the check found broken, by number (no text): for tuning the guide
  rules: number[] = [];
  wordsFirst = false;
  offered = 0;
  private words = 0;
  private later: Out[] = [];
  private pending = '';
  private queue: Out[] = [];
  private working: Promise<void> | null = null;
  private started = false;
  constructor(private emit: Emit, private deps: TurnDeps, private screen: Screen, private st: Standing, private last: string) {}

  get waiting() { return this.later.length; }
  get written() { return this.words; }
  text(t: string) { this.words += t.length; this.pending += t; this.cut(false); }
  // The words so far go out; cards waiting for words follow when there are enough
  endText() { this.cut(true); }
  // Words not yet sent that won't be shown after all (a reply that was almost only cards gets
  // written again)
  dropPending() { this.words -= this.pending.length; this.pending = ''; }
  flush() { this.cut(true); this.catchUp(false); }
  trusted(text: string) { this.flush(); this.push({ type: 'text', text, trusted: true }); }
  // A safety card (when to get help, injection basics) goes ahead of any card still waiting.
  // count false: a card that comes with every such answer (the studies and the community side by
  // side), which doesn't make a short answer "almost only cards"
  card(fields: Field[], build: (ok: Set<string>) => Record<string, unknown> | null, opts: { first?: boolean; tag?: string; count?: boolean } = {}) {
    this.cut(true);
    if (opts.count !== false) this.offered++;
    const o: Out = { type: 'card', fields, build, first: opts.first, tag: opts.tag };
    if (this.wordsFirst && this.words < WORDS_FIRST) {
      if (o.first) this.later.splice(this.later.filter((x) => x.type === 'card' && x.first).length, 0, o);
      else this.later.push(o);
      return;
    }
    if (o.first) {
      // Safety cards keep their order: any still waiting go first, then this one, then the rest
      for (const w of this.later.filter((x) => x.type === 'card' && x.first)) this.push(w);
      this.later = this.later.filter((x) => !(x.type === 'card' && x.first));
      this.push(o);
      this.catchUp(false);
    } else { this.catchUp(false); this.push(o); }
  }
  // Cards still waiting for words that are no longer wanted (their stack, when the guide asks
  // about their medicines first): they're never shown
  dropWaiting(tag: string): number {
    const before = this.later.length;
    this.later = this.later.filter((o) => !(o.type === 'card' && o.tag === tag));
    return before - this.later.length;
  }
  // Wait until everything queued has been checked and sent (or the turn was stopped)
  async drain() {
    this.cut(true);
    this.catchUp(true);
    while (this.working || this.queue.length) {
      if (!this.working) this.kick();
      await this.working;
    }
  }
  // Cards that were waiting for words go out, in the order they came, once there are words
  // before them (or at the end of the turn, whatever there is)
  private catchUp(force: boolean) {
    if (!this.later.length || (!force && this.words < WORDS_FIRST)) return;
    for (const o of this.later.splice(0)) this.push(o);
  }

  private cut(final: boolean) {
    for (;;) {
      const i = this.pending.search(/\n\s*\n/);
      if (i < 0) break;
      const chunk = this.pending.slice(0, i);
      this.pending = this.pending.slice(i).replace(/^\n\s*\n/, '');
      if (chunk.trim()) this.push({ type: 'text', text: chunk.trim() });
    }
    if (final && this.pending.trim()) {
      this.push({ type: 'text', text: this.pending.trim() });
      this.pending = '';
    }
  }
  private push(o: Out) {
    if (!this.started) {
      this.started = true;
      this.emit('step', { id: 'review', agent: 'review', status: 'run', title: 'Checking each part before you see it' });
    }
    this.queue.push(o);
    this.kick();
  }
  // One worker at a time. It clears itself in the same step that finds the queue empty, so a
  // part queued a moment later always starts a new one; a stopped turn ends it quietly.
  private kick() {
    if (this.working) return;
    this.working = (async () => {
      try {
        await this.run();
      } catch {
        this.unchecked += this.queue.length;
        this.queue.length = 0;
      } finally {
        this.working = null;
      }
    })();
  }
  private async run() {
    while (this.queue.length) {
      const batch = this.queue.splice(0, 6);
      const parts: { id: string; kind: 'text' | 'label'; text: string }[] = [];
      // Food-protein targets go to the check as markers, and back into the words it passes
      const masked = new Map<number, { text: string; targets: string[] }>();
      batch.forEach((o, i) => {
        if (o.type === 'text' && !o.trusted) {
          const m = maskTargets(o.text);
          masked.set(i, m);
          parts.push({ id: `t${i}`, kind: 'text', text: m.text });
        }
        if (o.type === 'card') o.fields.forEach((f) => parts.push({ id: `c${i}-${f.key}`, kind: 'label', text: maskTargets(f.text).text }));
      });
      const verdicts = parts.length ? await this.check(parts) : new Map<string, Verdict>();
      for (const [i, o] of batch.entries()) {
        if (o.type === 'text') {
          if (o.trusted) { this.release(o.text); continue; }
          const v = verdicts?.get(`t${i}`);
          if (!v) { this.unchecked++; continue; }            // couldn't be checked: held back
          this.checked++;
          if (!v.ok) this.rules.push(...(v.broken?.length ? v.broken : [0]));
          const m = masked.get(i)!;
          const { out, edited } = settle(m.text, v);
          if (out == null) this.held++;
          else { if (edited) this.edited++; this.release(unmaskTargets(out, m.targets)); }
        } else {
          const ok = new Set<string>();
          let missed = 0;
          for (const f of o.fields) {
            const v = verdicts?.get(`c${i}-${f.key}`);
            if (!v) missed++;
            else { this.checked++; if (v.ok) ok.add(f.key); else { this.edited++; this.rules.push(...(v.broken?.length ? v.broken : [0])); } }
          }
          // A card the check couldn't read isn't shown at all
          if (missed) { this.unchecked += missed; continue; }
          const card = o.build(ok);
          if (card) { this.cards++; this.emit('card', card); }
        }
      }
    }
  }
  private release(text: string) {
    const clean = strict(text);
    const sep = this.released ? '\n\n' : '';
    this.released += sep + clean;
    this.emit('text', { d: sep + clean });
  }
  private async check(parts: { id: string; kind: 'text' | 'label'; text: string }[]): Promise<Map<string, Verdict> | null> {
    const code = nonce();
    const s = this.screen;
    const hits = parts.flatMap((p) => scan(p.text).map((h) => `${p.id}: "${h.text}" (${h.kind})`)).slice(0, 12);
    const nums = parts.filter((p) => p.kind === 'text').flatMap((p) => unsourcedNumbers(p.text, this.known).map((n) => `${p.id}: "${n}"`));
    this.unsourced += nums.length;
    const prompt = [
      markers(code),
      `Flags for this turn: red flag ${s.red_flag}${this.st.minor ? '; under 18 (from this chat)' : ''}${this.st.crisis ? '; signs of crisis earlier in this chat' : ''}${s.pregnant || this.st.pregnant ? '; pregnant, trying to conceive or breastfeeding' : ''}; asked for a dose: ${s.asks_dose ? 'yes' : 'no'}; asked where to get it: ${s.asks_source ? 'yes' : 'no'}.`,
      hits.length ? `Plain checks flagged these words to look at: ${hits.join(', ')}.` : 'Plain checks flagged nothing.',
      nums.length ? `Numbers not found in what Sig was given this turn (rule 8): ${nums.join(', ')}.` : '',
      this.studied.length && parts.some((p) => p.kind === 'text' && DENIES.test(p.text))
        ? wrap(code, 'fact sheet findings for this question, for rule 9 (what was studied, and in whom)', this.studied.join('\n')) : '',
      wrap(code, 'the member\'s latest message', this.last.slice(0, 2000)),
      this.released ? wrap(code, 'already shown to the member, for context only', maskTargets(this.released.slice(-2500)).text) : '',
      ...parts.map((p) => wrap(code, `part ${p.id} (${p.kind === 'text' ? 'reply text' : 'card label'})`, p.text)),
    ].filter(Boolean).join('\n\n');
    try {
      const raw = await retry(() => form<{ parts?: unknown }>(REVIEW_TOOL, {
        model: this.deps.models.fast, system: REVIEW_SYSTEM, max_tokens: 3000, messages: [{ role: 'user', content: prompt }],
      }, { apiKey: this.deps.apiKey, fetchImpl: this.deps.fetchImpl, signal: this.deps.signal }), { tries: 2 });
      if (!raw || !Array.isArray(raw.parts)) return null;
      const out = new Map<string, Verdict>();
      for (const v of raw.parts as Record<string, unknown>[]) {
        if (typeof v?.id !== 'string') continue;
        out.set(v.id, {
          ok: v.ok === true,
          revised: typeof v.revised === 'string' ? v.revised.slice(0, 4000) : undefined,
          fixes: Array.isArray(v.fixes)
            ? (v.fixes as Record<string, unknown>[]).filter((f) => typeof f?.find === 'string' && f.find).slice(0, 8)
              .map((f) => ({ find: String(f.find).slice(0, 600), replace: typeof f.replace === 'string' ? f.replace.slice(0, 600) : '' }))
            : undefined,
          broken: (Array.isArray(v.broken) ? v.broken : []).map(Number).filter((n) => n >= 1 && n <= 9),
        });
      }
      return out;
    } catch (e) {
      if (this.deps.signal?.aborted) throw e;
      return null;
    }
  }
}
