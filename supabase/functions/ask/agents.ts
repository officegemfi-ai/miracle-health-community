// One turn of a conversation with Sig, agent by agent (runTurn below is the outline):
//   1. The Safety agent's first read sets up the turn                        readers.ts, screen.ts
//   2. The Planner (what they want, in what studies measure), the Recommender's lookup, the
//      Evidence librarian (each fact sheet's findings on exactly that), the Relatives, Mechanism,
//      Combination and Markers agents                                         readers.ts, evidence.ts
//   2f. The community (what members and the public forums report, and which voice leads), and
//   3. the Synergy auditor (when compounds meet)                             readers.ts, audit.ts
//   4. The guide writes, with the Library tools and the Stack builder's cards   tools.ts, cards.ts
//      -> the gate: the Safety agent checks every part of the reply, text and cards alike,
//         before the member sees it                                           gate.ts
//   5. Where the answer came from, and 6. the Safety agent's tally
// Every step is announced to the page as it happens. Nothing the member writes is stored.
import { ApiError, type Block, type Message, retry, stream, tuning } from './claude.ts';
import { indexText } from './library.ts';
import { guideSystem, GUIDE_TOOLS, turnNotes } from './prompts.ts';
import type { Community, TopRow, Use, Voice } from './community.ts';
import { INJECT_CARD, INJECT_SIGNS } from './urgency.ts';
import type { Audit, ChatMessage, Emit, TurnDeps } from './types.ts';
import { SAFETY_MARK, screenNote } from './screen.ts';
import { CAUTIONED, FULL_ANSWER } from './gate.ts';
import { cautionFor } from './items.ts';
import { ladderOf } from './evidence.ts';
import { auditCard, compareCard, crowdCard, stackCard, voicesCard } from './cards.ts';
import { runTool } from './tools.ts';
import { begin, combinationStage, communityStage, markerStage, studies, synergyStage, type Turn } from './readers.ts';

// What this module exported before it was split, from where it lives now
export type { Audit, ChatMessage, Emit, Finding, Models, Screen, TurnDeps } from './types.ts';
export { HELD_REPLY, heldReply, plainScreen, SAFETY_MARK, screenMessage, screenTitle, type Standing, standing, type Urgent, urgentKind } from './screen.ts';
export { auditSet, auditTitle } from './audit.ts';
export { addsCaveat, applyFixes, CAUTIONED, dedupeSentences, DENIES, Gate, settle, sourceNumbers, unsourcedNumbers } from './gate.ts';
export { benefitsOf, type CardItem, cautionFor, PILLAR_STATES, PILLARS, studiesOf, type StudyFinding, tagFor, useOf } from './items.ts';

const MAX_ROUNDS = 6;
// A reply with cards but fewer characters of words than this gets written again, once
const FEW_WORDS = 240;
const MORE_WORDS = '(A note from Miracle Health, not the member.) That reply isn\'t shown: it was almost only cards. Write the reply now, in words: the bottom line of what they asked (two sentences, key point in **bold**), what to do now about anything they described happening, the benefits and how it works if they asked about compounds, the one caution line, and at most one short question at the end. The cards are already on their screen: don\'t call the same tools again or restate the cards.';
const MAX_TOOLS_PER_ROUND = 6;

// The last message gets the cache mark (so each round of the loop reuses the one before)
function withCacheMark(convo: Message[]): Message[] {
  return convo.map((m, i) => {
    if (i !== convo.length - 1) return m;
    const blocks: Block[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content.map((b) => ({ ...b }));
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } };
    return { role: m.role, content: blocks };
  });
}

export async function runTurn(messages: ChatMessage[], deps: TurnDeps, emit: Emit): Promise<{ memo: string; text: string }> {
  const t0 = Date.now();
  const turn = await begin(messages, deps, emit);
  const { named, recNote, evNote, sheetsForTurn, ladder } = await studies(turn);
  // Weighing two to four compounds against each other: a comparison, side by side, not their stack
  const comparing = !turn.held && turn.screen.compare && named.length >= 2 && named.length <= 4;
  // 2d. The Combination agent: how what they named together relates, by the Library's pathways
  const comboNote = combinationStage(turn, named, comparing, ladder);
  // 2e. The Markers agent: the blood markers what they named may move, and any pushed both ways
  const markNote = markerStage(turn, named);
  // The screen draws the evidence ladder before the community's step puts the compounds on it
  if (ladder) turn.emit('ladder', { ...ladderOf(ladder, turn.ctx.plan), compare: comparing });
  // 2f. The community, and 3. the Synergy auditor
  const heard = communityStage(turn, named, comparing);
  const { synNote, upfront } = await synergyStage(turn, named, comparing);

  // 4. The guide writes, with the Library tools; every part goes through the gate
  const notes = { recNote, evNote, communityNote: heard.communityNote, comboNote, markNote, synNote, sheetsForTurn };
  const written = await guide(turn, notes, { named, comparing, upfront, ...heard });
  await closingWords(turn, named, written.wrote);
  // 5. Where the answer came from, and 6. the Safety agent's tally
  const signals = sources(turn);
  return tally(turn, { t0, ...written, signals, comparing });
}

type Notes = { recNote: string; evNote: string; communityNote: string; comboNote: string; markNote: string; synNote: string; sheetsForTurn: string[] };
type Laid = { named: string[]; comparing: boolean; upfront: Audit | null; voices: Voice[]; top: TopRow[]; listUse: Use | null };
type Written = { wrote: string; rounds: number; model: string; usage: { in: number; out: number; cacheRead: number; cacheWrite: number } };

// The guide's turn: its instructions and notes, the cards laid out before its words, then its
// rounds of writing and tool calls
async function guide(turn: Turn, notes: Notes, laid: Laid): Promise<Written> {
  const { messages, deps, emit, screen, items, snap, minor, held, pregnant, gate, ctx } = turn;
  const { recNote, evNote, communityNote, comboNote, markNote, synNote, sheetsForTurn } = notes;
  const { named, comparing, upfront, voices, top, listUse } = laid;
  const system = [
    { type: 'text', text: guideSystem(indexText(items)), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: turnNotes({ safety: screenNote(screen, ctx.st, ctx.shortlistsOn), recommender: recNote, evidence: evNote, community: communityNote, combination: comboNote, markers: markNote, synergy: synNote, sheets: sheetsForTurn }) },
  ];
  gate.sources(system.map((b) => b.text).join('\n'));
  const convo: Message[] = messages.map((m) => ({ role: m.role, content: m.content }));
  // Held turns: someone under 18 can still get questions to take to their doctor; a crisis or
  // an emergency gets words only
  const tools = !held ? GUIDE_TOOLS
    : minor && screen.red_flag !== 'self_harm' && screen.red_flag !== 'emergency' ? GUIDE_TOOLS.filter((t) => t.name === 'clinician_questions' || t.name === 'warning_signs')
    : [];
  if (!tools.length) system[1].text += '\nNo tools this turn: answer in words only, and don\'t write tool names or card lists.';
  if (!held) emit('step', { id: 'write', agent: 'recommender', status: 'run', title: 'Writing your answer' });
  gate.wordsFirst = true;
  // Someone who injects gets the safety basics once in a chat, right after the short version
  // (adults only: someone under 18 is told to talk to a parent and a doctor)
  if (screen.injects && !ctx.injectShown && !held) {
    ctx.injectShown = true;
    INJECT_SIGNS.forEach((id) => ctx.signs.add(id));
    emit('step', { id: 'inject', agent: 'safety', status: 'done', title: 'Added the safety basics for injecting' });
    gate.card([], () => { ctx.memo.push('injection safety basics'); return INJECT_CARD; }, { first: true });
  }
  // The Stack builder lays out what the member named, after the guide's opening words; one
  // compound on its own gets the studies and the community side by side
  const cmp = comparing && ctx.shortlistsOn ? compareCard(named, ctx) : null;
  if (cmp) {
    // What the auditor found for them shows under the comparison, on its own card
    if (upfront && upfront.ok && upfront.findings.length) auditCard(upfront, ctx);
  } else if (upfront && ctx.shortlistsOn && !comparing) stackCard(named, upfront, ctx);
  else if (upfront && upfront.ok && upfront.findings.length) auditCard(upfront, ctx);
  else if (!upfront && voices.length && ctx.shortlistsOn && snap.ok !== false && !screen.reaction) voicesCard(voices.map((v) => v.id), ctx);
  // What the community reports most for what they want it for, when they ask
  if (top.length && listUse && screen.asks_community && ctx.shortlistsOn && !pregnant && !screen.reaction) crowdCard(top, listUse, ctx);
  let wrote = '';
  let model = deps.models.guide;
  let rounds = 0;
  let rewrote = false;
  const usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
  for (; rounds < MAX_ROUNDS; rounds++) {
    let sawText = false;
    const onText = (t: string) => { sawText = true; wrote += t; gate.text(t); };
    const req = {
      model, max_tokens: 3000, system, messages: withCacheMark(convo),
      ...(tools.length ? { tools } : {}),
      ...tuning(model, { effort: deps.effort }),
    };
    let r;
    try {
      r = await retry(() => stream({ ...req, model }, { apiKey: deps.apiKey, fetchImpl: deps.fetchImpl, signal: deps.signal, onText }), { canRetry: () => !sawText });
    } catch (e) {
      if (deps.signal?.aborted) throw e;
      if (e instanceof ApiError && !sawText && model !== deps.models.fallback && (e.missingModel || e.retryable)) {
        model = deps.models.fallback;
        rounds--;
        continue;
      }
      throw e;
    }
    const uses = r.content.filter((b) => b.type === 'tool_use');
    const last = r.stop !== 'tool_use' || !uses.length;
    // Words first and words that carry the answer: a reply that came out as cards and a line
    // gets one more go (what it wrote isn't shown, unless it already went out)
    const again = last && !rewrote && tools.length > 0 && r.stop !== 'refusal' && !ctx.asked
      && gate.offered > 0 && wrote.trim().length < FEW_WORDS && rounds < MAX_ROUNDS - 1;
    if (again) { gate.dropPending(); rewrote = true; wrote = ''; } else gate.endText();
    usage.in += Number(r.usage.input_tokens ?? 0);
    usage.out += Number(r.usage.output_tokens ?? 0);
    usage.cacheRead += Number(r.usage.cache_read_input_tokens ?? 0);
    usage.cacheWrite += Number(r.usage.cache_creation_input_tokens ?? 0);
    if (r.content.length || !again) convo.push({ role: 'assistant', content: r.content });
    if (r.stop === 'refusal' && !wrote.trim()) {
      gate.trusted('I can’t help with that one. I’m happy to talk through what the evidence says about a compound, how it might fit a goal, and what to ask a clinician.');
      wrote = 'refusal';
      break;
    }
    if (again) {
      const note: Block = { type: 'text', text: MORE_WORDS };
      const prev = convo[convo.length - 1];
      if (prev.role === 'user') prev.content = [...(typeof prev.content === 'string' ? [{ type: 'text', text: prev.content }] : prev.content), note];
      else convo.push({ role: 'user', content: [note] });
      ctx.wordsOnly = true;
      continue;
    }
    if (last) break;
    // When to get help goes first among this round's cards, whatever order they were asked in
    const outs = new Map<string, string>();
    const order = uses.slice(0, MAX_TOOLS_PER_ROUND).sort((a, b) => Number(b.name === 'warning_signs') - Number(a.name === 'warning_signs'));
    for (const u of order) {
      try {
        outs.set(String(u.id), await runTool(String(u.name), (u.input ?? {}) as Record<string, unknown>, ctx));
      } catch (e) {
        if (deps.signal?.aborted) throw e;
        outs.set(String(u.id), 'That tool failed just now; carry on without it.');
      }
    }
    gate.flush();
    for (const out of outs.values()) gate.sources(out);
    const results: Block[] = uses.map((u) => ({ type: 'tool_result', tool_use_id: String(u.id), content: outs.get(String(u.id)) ?? 'Skipped: too many tool calls at once.' }));
    convo.push({ role: 'user', content: results });
    // Questions for the member end the reply (once there are words before them): the answers
    // come back as their next message, so nothing more is written after the card
    if (ctx.asked && !gate.waiting) break;
  }
  return { wrote, rounds, model, usage };
}

// After the guide: help that must be there (a crisis, an emergency), why nothing was shown when
// nothing was, and the Library's caution line when a full answer never got to the risks
async function closingWords(turn: Turn, named: string[], wrote: string) {
  const { emit, screen, held, pregnant, gate, ctx } = turn;
  if (!wrote.trim()) gate.trusted('I couldn’t put an answer together just now. Could you ask that again, maybe in other words?');
  if (!held) emit('step', { id: 'write', agent: 'recommender', status: 'done', title: 'Answer written' });
  await gate.drain();
  if (screen.red_flag === 'self_harm' && !gate.released.trim()) {
    gate.trusted('I’m really sorry you’re going through this, and I’m glad you said something. Please call or text 988 now to talk with someone at the Suicide & Crisis Lifeline, or call 911 if you’re in danger right now. You don’t have to face this alone.');
  } else if (screen.red_flag === 'emergency' && !gate.released.trim()) {
    gate.trusted('If this is happening now, please call 911 or go to the nearest emergency room. If you took too much of something, Poison Control is at 1-800-222-1222.');
  } else if (gate.unchecked) {
    gate.trusted(gate.released.trim() || gate.cards
      ? 'Part of this answer couldn’t be checked by the Safety agent just now, so it isn’t shown. Ask again in a moment to see the rest.'
      : 'The Safety agent couldn’t check this answer just now, so it isn’t shown. Please try again in a moment.');
  } else if (!gate.released.trim() && !gate.cards) {
    gate.trusted('The Safety agent held this answer back because it broke Miracle Health’s rules. Try asking in a different way, for example about the evidence, the risks or what to ask a clinician.');
  } else if (!held && named.length && !ctx.asked && !screen.asks_dose && !screen.asks_source
    && gate.released.trim().length >= FULL_ANSWER && !CAUTIONED.test(gate.released)) {
    // A full answer about compounds that never got to their risks or status: the Library's own line
    const lines = named.slice(0, 3).map((id) => {
      const it = ctx.byId.get(id);
      const c = it ? cautionFor(it, ctx.sheets.get(id), pregnant) : '';
      return c ? `${it!.name}: ${c}` : '';
    }).filter(Boolean);
    if (lines.length) {
      gate.trusted(`**Caution:** ${lines.join(' ')}`);
      ctx.memo.push('a caution line from the Library');
    }
  }
  await gate.drain();
}

  // 5. Where the answer came from: the fact sheets (the studies) and the Community Signals (the
  // community) it drew on, in totals
function sources(turn: Turn): number {
  const { emit, snap, held, ctx } = turn;
  const studied = [...ctx.opened].filter((id) => ctx.sheets.get(id));
  const heard = [...ctx.heard.entries()].filter((e): e is [string, Community] => !!e[1]);
  if (!held && (studied.length || heard.length)) {
    const p = snap.community ?? {};
    emit('sources', {
      studies: {
        sheets: studied.length, sources: studied.reduce((t, id) => t + (ctx.sheets.get(id)?.sources?.length ?? 0), 0),
        names: studied.slice(0, 8).map((id) => ({ id, name: ctx.sheets.get(id)!.name })),
      },
      community: {
        signals: heard.length, reports: heard.reduce((t, [, c]) => t + c.firstHand, 0), forum: heard.some(([, c]) => c.memberShare < 100),
        names: heard.slice(0, 8).map(([id]) => ({ id, name: ctx.byId.get(id)?.name ?? id })),
      },
      crowd: { members: Math.max(0, Math.round(Number(p.members) || 0)), reports: Math.max(0, Math.round(Number(p.reports) || 0)) },
      // Which version of the community's numbers answered (the library's pages read the same one)
      version: typeof snap.generated_at === 'string' ? snap.generated_at.slice(0, 40) : null,
    });
  }
  return heard.length;
}

  // 6. The Safety agent's tally
function tally(turn: Turn, run: Written & { t0: number; signals: number; comparing: boolean }): { memo: string; text: string } {
  const { deps, emit, st, screen, minor, pregnant, use, gate, ctx } = turn;
  const { t0, rounds, model, usage, signals, comparing } = run;
  const notShown = gate.held + gate.unchecked;
  const title = notShown || gate.edited
    ? `Every part checked before you saw it · ${[gate.edited ? `edited ${gate.edited}` : '', notShown ? `held back ${notShown}` : ''].filter(Boolean).join(' · ')}`
    : 'Every part checked before you saw it: no doses, no sellers';
  emit('step', { id: 'review', agent: 'review', status: 'done', title, fixed: !!(gate.edited || notShown) });
  emit('review', { ok: !(gate.edited || notShown), edited: gate.edited, held: notShown, rules: gate.rules.slice(0, 20), numbers: gate.unsourced });
  const marks = [
    minor ? SAFETY_MARK.minor : '',
    pregnant ? SAFETY_MARK.pregnant : '',
    screen.red_flag === 'self_harm' || st.crisis ? SAFETY_MARK.crisis : '',
    ctx.injectShown ? SAFETY_MARK.inject : '',
  ].filter(Boolean);
  const memo = ((marks.length ? `${marks.join(' ')}\n` : '')
    + (ctx.memo.length ? `[Shown to the member: ${ctx.memo.join('; ')}]\n\n` : '')
    + gate.released).slice(0, 6000);
  deps.log?.({
    ask: {
      ms: Date.now() - t0, rounds: rounds + 1, model, screened: screen.ok, sheets: ctx.opened.size, signals, use: use?.id ?? null, shortlists: ctx.shortlists, stacks: ctx.stacks, asked: ctx.asked,
      parts: { checked: gate.checked, edited: gate.edited, held: gate.held, unchecked: gate.unchecked, unsourced: gate.unsourced }, tokens: usage, compare: comparing,
    },
  });
  return { memo, text: gate.released };
}
