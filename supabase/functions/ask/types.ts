// The shapes a turn passes around: the conversation, the events the page is sent, the models and
// services a turn uses, the Safety agent's first read, and the Synergy auditor's findings.
import type { Goal, Library } from './library.ts';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type Emit = (event: string, data: Record<string, unknown>) => void;
export type Models = { guide: string; fast: string; fallback: string };
export type TurnDeps = {
  apiKey: string;
  models: Models;
  effort?: string;
  library: Library;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  log?: (line: Record<string, unknown>) => void;
};

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
