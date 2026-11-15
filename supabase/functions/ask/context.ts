// A turn's working state (Ctx), shared by the agents, the cards and the tools, and the small
// things they all do with it: open fact sheets, read both voices on a compound, announce a step.
import { condense, type Goal, type Item, type Sheet, type Signal, type Snapshot, stub, BLOCKED } from './library.ts';
import { strict } from './guard.ts';
import { blockedItem, type Community, COMMUNITY_DOWN, communityOf, studiesAlone, type Use, type Voice, voiceLine, voiceOf } from './community.ts';
import type { Plan } from './outcomes.ts';
import type { Gate } from './gate.ts';
import type { Standing } from './screen.ts';
import { studiesOf } from './items.ts';
import type { Emit, Screen, TurnDeps } from './types.ts';

export type Ctx = {
  items: Item[]; byId: Map<string, Item>; snap: Snapshot; screen: Screen; st: Standing; ownMeds: Set<string>;
  sheets: Map<string, Sheet | null>; emit: Emit; deps: TurnDeps; gate: Gate; shortlistsOn: boolean;
  opened: Set<string>; stepN: number; memo: string[]; shortlists: number; stacks: number; questions: number; uses: Record<string, number>;
  wordsOnly?: boolean;
  plans: number;
  mine: Set<string>;      // compounds the member named anywhere in this chat: theirs
  audited: Set<string>;   // compounds the Synergy auditor already checked upfront this turn
  injectShown: boolean;
  signs: Set<string>;   // warning signs already on a card this turn
  goal?: Goal;          // what they want help with, for the studies' side
  use: Use | null;      // what they want it for, as the community rates it
  heard: Map<string, Community | null>;   // compounds whose community numbers the guide or a card used
  unread: Set<string>;  // compounds whose fact sheet exists but couldn't be loaded just now
  plan: Plan;           // the Planner's read: what they asked about, in what studies measure
  on: (agent: string) => boolean;   // whether an agent answers this turn (the member's choice; safety always)
};

export async function openSheets(ids: string[], ctx: Ctx): Promise<Map<string, Sheet | null>> {
  const want = ids.filter((id) => ctx.byId.has(id) && !ctx.sheets.has(id));
  const got = await Promise.all(want.map((id) => ctx.deps.library.sheet(id).catch(() => undefined)));
  // A sheet the Library has that couldn't be loaded just now isn't "no fact sheet": it's marked,
  // and nothing it might rule out (pregnancy, interactions) is taken as cleared
  want.forEach((id, i) => { ctx.sheets.set(id, got[i] ?? null); if (got[i] === undefined && ctx.byId.get(id)?.sheet) ctx.unread.add(id); });
  return ctx.sheets;
}

// Both voices on one compound, for what the member asked: what the studies show and what the
// community reports, and which leads
// When the member turned the community off for this chat, there's no community side: the studies
// stand alone, and nothing counts as heard from it
export function voiceFor(id: string, ctx: Ctx): Voice | null {
  const it = ctx.byId.get(id);
  if (!it) return null;
  const sh = ctx.sheets.get(id);
  const listening = ctx.on('community');
  const community = listening ? communityOf(ctx.snap.signals[id] as Signal | undefined, ctx.use, ctx.snap.uses) : null;
  if (listening) ctx.heard.set(id, community);
  const blocked = BLOCKED.has(sh?.status_us?.key ?? it.status ?? '') || blockedItem(it, ctx.byId);
  return voiceOf({ id, name: sh?.name ?? it.name }, studiesOf(sh, ctx.goal), community, { blocked, pregnant: ctx.screen.pregnant || ctx.st.pregnant, reaction: ctx.screen.reaction });
}
// A fact sheet as the guide reads it, with the community's numbers and which voice leads (the
// studies alone when the community wasn't asked)
export function sheetText(id: string, ctx: Ctx): string {
  const it = ctx.byId.get(id);
  const sh = ctx.sheets.get(id);
  if (!it) return `No compound with the id "${id}" in the Library.`;
  if (ctx.unread.has(id)) return `### ${it.name} (id ${id})\nIts fact sheet couldn't be loaded just now: don't make specific claims about it, and don't call it checked for pregnancy or interactions.`;
  const voice = !ctx.on('community') ? studiesAlone(voiceFor(id, ctx)!, communityOf(ctx.snap.signals[id] as Signal | undefined, ctx.use, ctx.snap.uses))
    : ctx.snap.ok === false ? COMMUNITY_DOWN : voiceLine(voiceFor(id, ctx)!);
  return strict(`${sh ? condense(sh, it, null, ctx.snap.uses, false) : stub(it, null, ctx.snap.uses, false)}\n${voice}`);
}

export const chip = (id: string, ctx: Ctx) => ({ id, name: ctx.byId.get(id)?.name ?? id });
export const step = (ctx: Ctx, data: Record<string, unknown>) => ctx.emit('step', data);
export const nextId = (ctx: Ctx, p: string) => `${p}${++ctx.stepN}`;
