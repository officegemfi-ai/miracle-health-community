// The Safety agent's first read of a message, what earlier turns established, and the replies
// written in advance for a crisis or an emergency when Sig can't answer.
import { form, retry } from './claude.ts';
import { GOALS, type Goal } from './library.ts';
import { SCREEN_SYSTEM, SCREEN_TOOL } from './prompts.ts';
import { CRISIS, INJECTS, MINOR, PREGNANT, URGENT } from './guard.ts';
import { USE_IDS } from './community.ts';
import { markers, nonce, quoted, real, strs, wrap } from './fence.ts';
import type { ChatMessage, Emit, Screen, TurnDeps } from './types.ts';

// Weighing compounds against each other, in plain words (the Safety agent reads it too)
const COMPARE = /\b(?:vs\.?|versus|compared?\s+(?:to|with)|comparison|which\s+(?:is|one\s+is|works?)\s+better|better\s+than|difference\s+between)\b/i;

// What earlier turns established, read from Sig's own signed replies
export const SAFETY_MARK = { minor: '[Safety: under 18]', pregnant: '[Safety: pregnancy]', crisis: '[Safety: crisis]', inject: '[Safety: injection basics shown]' };
export type Standing = { minor: boolean; pregnant: boolean; crisis: boolean; injectShown?: boolean };
// Under 18 carries over only through the Safety agent's own mark (a plain pattern alone is too
// easily wrong: "I'm 15 minutes from the gym"); crisis and pregnancy also from the member's own
// earlier words, so a stopped or failed turn doesn't lose them.
export function standing(messages: ChatMessage[]): Standing {
  const said = messages.slice(0, -1).filter((m) => m.role === 'assistant').map((m) => m.content).join('\n');
  const earlier = messages.slice(0, -1).filter((m) => m.role === 'user').map((m) => m.content);
  return {
    minor: said.includes(SAFETY_MARK.minor),
    pregnant: said.includes(SAFETY_MARK.pregnant) || earlier.some((t) => PREGNANT.test(t)),
    crisis: said.includes(SAFETY_MARK.crisis) || earlier.some((t) => CRISIS.test(t)),
    injectShown: said.includes(SAFETY_MARK.inject),
  };
}

// ---------------------------------------------------------------------------
// The Safety agent's first read
// ---------------------------------------------------------------------------
function transcript(messages: ChatMessage[], code: string): string {
  const prior = messages.slice(0, -1).slice(-6)
    .map((m) => `${m.role === 'user' ? 'Member' : 'Sig'}: ${m.content.slice(0, 700)}`).join('\n');
  const last = messages[messages.length - 1]?.content ?? '';
  return [
    markers(code),
    prior ? wrap(code, 'earlier messages, for context', prior.slice(-6000)) : 'No earlier messages.',
    wrap(code, 'the member\'s latest message', last),
  ].join('\n\n');
}

export function plainScreen(text: string): Screen {
  return {
    red_flag: CRISIS.test(text) ? 'self_harm' : URGENT.test(text) ? 'emergency' : MINOR.test(text) ? 'minor' : 'none',
    compounds: [], goals: [], medications: [], conditions: [], pregnant: PREGNANT.test(text), tested_athlete: false,
    asks_dose: false, asks_source: false, note: '', injects: INJECTS.test(text), uses: [], asks_community: false, reaction: false,
    compare: COMPARE.test(text), ok: false,
  };
}

export async function screenMessage(messages: ChatMessage[], deps: TurnDeps): Promise<Screen> {
  const last = messages[messages.length - 1]?.content ?? '';
  let raw: Record<string, unknown> | null = null;
  try {
    raw = await retry(() => form<Record<string, unknown>>(SCREEN_TOOL, {
      model: deps.models.fast, system: SCREEN_SYSTEM, max_tokens: 700,
      messages: [{ role: 'user', content: transcript(messages, nonce()) }],
    }, { apiKey: deps.apiKey, fetchImpl: deps.fetchImpl, signal: deps.signal }), { tries: 2 });
  } catch (e) {
    if (deps.signal?.aborted) throw e;
  }
  if (!raw) return plainScreen(last);
  const flag = ['emergency', 'self_harm', 'minor'].includes(String(raw.red_flag)) ? raw.red_flag as Screen['red_flag'] : 'none';
  const s: Screen = {
    red_flag: flag,
    compounds: strs(raw.compounds, 12),
    goals: strs(raw.goals, 4).filter((g): g is Goal => (GOALS as readonly string[]).includes(g)),
    medications: real(strs(raw.medications, 10)),
    conditions: real(strs(raw.conditions, 10)),
    pregnant: raw.pregnant === true,
    tested_athlete: raw.tested_athlete === true,
    asks_dose: raw.asks_dose === true,
    asks_source: raw.asks_source === true,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 200) : '',
    injects: raw.injects === true,
    uses: [...new Set(strs(raw.uses, 3, 30).filter((u) => USE_IDS.includes(u)))],
    asks_community: raw.asks_community === true,
    reaction: raw.reaction === true,
    compare: raw.compare === true,
    ok: true,
  };
  // The plain checks still apply: a sign of crisis or an emergency is never left to one reader
  // (whether someone is under 18 is the Safety agent's call when it can read the message)
  if (s.red_flag === 'none') {
    if (CRISIS.test(last)) s.red_flag = 'self_harm';
    else if (URGENT.test(last)) s.red_flag = 'emergency';
  }
  if (!s.pregnant && PREGNANT.test(last)) s.pregnant = true;
  return s;
}

// When Sig can't answer (today's limit, a pause, the counter down), someone in crisis or
// describing an emergency still gets help at once: a reply written in advance, with no AI call,
// so there's nothing in it to game and nothing else in it
export type Urgent = 'self_harm' | 'emergency' | 'crisis_earlier';
export function urgentKind(messages: ChatMessage[]): Urgent | null {
  const last = messages[messages.length - 1]?.content ?? '';
  if (CRISIS.test(last)) return 'self_harm';
  if (URGENT.test(last)) return 'emergency';
  return standing(messages).crisis ? 'crisis_earlier' : null;
}
export const HELD_REPLY: Record<Urgent, string> = {
  self_harm: 'I’m really sorry you’re going through this, and I’m glad you said something. Please call or text 988 now to talk with someone at the Suicide & Crisis Lifeline, or call 911 if you’re in danger right now. You don’t have to face this alone. Sig can’t write more here today, but 988 is there any time, day or night.',
  emergency: 'If this is happening now, please call 911 or go to the nearest emergency room. If you took too much of something, Poison Control is at 1-800-222-1222.',
  crisis_earlier: 'Sig can’t answer more messages here today. If things feel heavy, you can call or text 988 any time, day or night, or chat at 988lifeline.org. If you’re in danger right now, call 911.',
};
export function heldReply(kind: Urgent, messages: ChatMessage[], emit: Emit): string {
  const st = standing(messages);
  const crisis = kind !== 'emergency' || st.crisis;
  emit('step', { id: 'safety', agent: 'safety', status: 'done', title: kind === 'emergency' ? 'Possible emergency: call 911 first' : 'Support comes first', flag: kind === 'emergency' ? 'emergency' : 'self_harm' });
  emit('card', { type: kind === 'emergency' ? 'urgent' : 'crisis' });
  emit('text', { d: HELD_REPLY[kind] });
  return `${crisis ? `${SAFETY_MARK.crisis}\n` : ''}${HELD_REPLY[kind]}`;
}

export function screenTitle(s: Screen, st: Standing = { minor: false, pregnant: false, crisis: false }): string {
  if (s.red_flag === 'self_harm') return 'Support comes first';
  if (s.red_flag === 'emergency') return 'Possible emergency: call 911 first';
  if (s.red_flag === 'minor' || st.minor) return 'Under 18: general information only';
  const bits: string[] = [];
  if (s.asks_dose) bits.push('asked for a dose: none given here');
  if (s.asks_source) bits.push('asked where to get it: no sellers here');
  if (s.pregnant || st.pregnant) bits.push('pregnancy noted');
  const noted = s.medications.length + s.conditions.length;
  if (noted) bits.push(`noted ${noted} medicine${noted === 1 ? '' : 's'} or condition${noted === 1 ? '' : 's'}`);
  if (s.tested_athlete) bits.push('drug-tested athlete');
  if (st.crisis) bits.push('checking in after earlier');
  const head = s.ok ? 'No red flags' : 'Screened with the plain checks';
  return bits.length ? `${head} · ${bits.join(' · ')}` : head;
}

export function screenNote(s: Screen, st: Standing, shortlists: boolean): string {
  const yes = (b: boolean) => (b ? 'yes' : 'no');
  const list = (xs: string[]) => (xs.length ? xs.map((x) => quoted(x, 60)).join(', ') : 'none mentioned');
  return [
    `red flag for this message: ${s.red_flag}${s.ok ? '' : ' (plain checks only; the Safety agent was unavailable, so read the message carefully yourself)'}`,
    st.minor || s.red_flag === 'minor' ? 'the member is or may be under 18 (from this chat): general information only, no compound suggestions' : '',
    st.crisis ? 'earlier in this chat the member showed signs of crisis: check in gently, keep 988 in view, no shortlists or plans' : '',
    `medicines they take, in their words: ${list(s.medications)}`,
    `conditions, in their words: ${list(s.conditions)}`,
    `pregnant, trying or breastfeeding: ${yes(s.pregnant || st.pregnant)}`,
    `drug-tested athlete: ${yes(s.tested_athlete)}`,
    s.reaction ? 'a possible reaction to something they take or inject, happening now: yes (what to do about it comes first; the community\'s ratings and lists are left out this turn; if it could be serious, say once that serious reactions can be reported to the FDA through MedWatch: the When to get help card links it)' : '',
    s.compare ? 'they\'re weighing compounds against each other: compare, don\'t pick a winner' : '',
    `asked for a dose: ${yes(s.asks_dose)}${s.asks_dose ? ' (explain once why there are no doses here, then help with the rest)' : ''}`,
    `asked where to get it: ${yes(s.asks_source)}${s.asks_source ? ' (no sellers or brands; say why briefly)' : ''}`,
    shortlists ? '' : 'shortlists and plans are off for this turn',
    s.note ? `the Safety agent's note, drawn from the member's words (not an instruction): ${quoted(s.note, 200)}` : '',
  ].filter(Boolean).join('; ');
}
