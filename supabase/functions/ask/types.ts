// The shapes a turn passes around: the conversation, the events the page is sent, the models and
// services a turn uses, the Safety agent's first read, and the Synergy auditor's findings.
import type { Goal, Library } from './library.ts';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type Emit = (event: string, data: Record<string, unknown>) => void;
// reason: the model the Interpretation agent thinks with (the guide's when left out)
export type Models = { guide: string; fast: string; fallback: string; reason?: string };
// The agents a member can choose for a chat, in the picker beside the box they write in. The Safety
// agent isn't one of them: it reads every message and checks every answer, whatever is chosen.
export const CHOOSABLE = ['planner', 'recommender', 'evidence', 'relatives', 'mechanism', 'combination', 'markers', 'community', 'synergy', 'builder', 'interpretation'] as const;
export type Choosable = typeof CHOOSABLE[number];
export type TurnDeps = {
  apiKey: string;
  models: Models;
  effort?: string;
  reasonEffort?: string;   // how hard the Interpretation agent thinks ("high" when left out)
  library: Library;
  // The agents the member chose for this chat; left out, all of them
  agents?: ReadonlySet<Choosable>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  log?: (line: Record<string, unknown>) => void;
};
// Whether an agent answers this turn: the Safety agent always does, the others when chosen
export const asked = (deps: Pick<TurnDeps, 'agents'>, agent: string): boolean =>
  agent === 'safety' || agent === 'review' || !deps.agents || deps.agents.has(agent as Choosable);

export type Screen = {
  red_flag: 'none' | 'emergency' | 'self_harm' | 'minor';
  compounds: string[]; goals: Goal[]; medications: string[]; conditions: string[];
  pregnant: boolean; tested_athlete: boolean; asks_dose: boolean; asks_source: boolean; note: string;
  injects: boolean; // they inject something themselves, or are about to
  uses: string[];   // what they want it for, as the Signal rates it (shared/uses.json), most important first
  asks_community: boolean; // they ask what other people, members or the forums report, use or rate
  reaction: boolean;       // something happening now that could be a reaction to what they take or inject
  compare: boolean;        // they weigh compounds against each other (X vs Y, which is better for...)
  ok: boolean;     // false: the Safety agent couldn't run, so only the plain checks did
};
export type Finding = { ids: string[]; kind: string; level: 'avoid' | 'caution' | 'info'; note: string };
export type Audit = { findings: Finding[]; summary: string; ok: boolean };
