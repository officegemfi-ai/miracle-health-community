// The agents that read before the guide writes, in the order a turn runs them: the Safety agent's
// first read (which also sets up the turn), the Planner, the Recommender's lookup, the Evidence
// librarian, the Relatives, Mechanism, Combination and Markers agents, the community and the
// Synergy auditor. Each returns what it found, as notes for the guide.
import { type Axis, GOAL_LABEL, type Item, mentioned, optionLine, rank, resolve, type Snapshot, tidyBlends } from './library.ts';
import { COMMUNITY_DOWN, comboLine, communityTitle, communityTop, pulseLine, stackSignal, type TopRow, topText, type Use, useById, type Voice } from './community.ts';
import { evidenceNote, NO_PLAN, planOutcomes, plannerNote, plannerTitle } from './outcomes.ts';
import { pairingNote, pairings, pairingTitle, type Related } from './relatives.ts';
import { mechanismFor, mechanismNote, mechanismTitle } from './mechanism.ts';
import { type Body, markersNote, markersTitle, readMarkers } from './markers.ts';
import type { Audit, ChatMessage, Emit, Screen, TurnDeps } from './types.ts';
import { screenMessage, screenTitle, type Standing, standing } from './screen.ts';
import { auditSet, auditText, auditTitle } from './audit.ts';
import { Gate } from './gate.ts';
import { benefitsOf } from './items.ts';
import { chip, type Ctx, openSheets, sheetText, voiceFor } from './context.ts';
import { evidenceStep, type Ladder, relativesStep } from './evidence.ts';

// One turn's inputs, what the Safety agent's first read decided, and its working state
export type Turn = {
  messages: ChatMessage[]; deps: TurnDeps; emit: Emit; last: string; st: Standing;
  screen: Screen; items: Item[]; snap: Snapshot; axes: Axis[]; body: Body | null;
  minor: boolean; held: boolean; pregnant: boolean; gate: Gate; use: Use | null; ctx: Ctx;
};

// 1. The Safety agent reads the message while the Library loads; the turn is set up from what it read
export async function begin(messages: ChatMessage[], deps: TurnDeps, emit: Emit): Promise<Turn> {
  const last = messages[messages.length - 1].content;
  const st = standing(messages);

  emit('step', { id: 'safety', agent: 'safety', status: 'run', title: 'Screening your message' });
  const [screen, items, snap, axes, body] = await Promise.all([
    screenMessage(messages, deps),
    deps.library.items().catch(() => [] as Item[]),
    deps.library.snapshot().catch(() => ({ signals: {}, uses: {}, ok: false }) as Snapshot),
    deps.library.axes().catch(() => [] as Axis[]),
    deps.library.body().catch(() => null as Body | null),
  ]);
  const minor = screen.red_flag === 'minor' || st.minor;
  const held = screen.red_flag === 'self_harm' || screen.red_flag === 'emergency' || minor;
  const gate = new Gate(emit, deps, screen, { ...st, minor }, last);
  // The number check knows what the member and Sig have said in this chat; the notes, fact
  // sheets and tool results are added as they come
  for (const m of messages) gate.sources(m.content);
  // What they want it for, as the community rates it: the use that belongs to the goal they want
  // help with (both voices answer the same question); its goal stands in when they named none
  const use = held ? null : screen.goals.length
    ? screen.uses.map(useById).find((u) => u?.goal === screen.goals[0]) ?? null
    : useById(screen.uses[0]);
  if (use && !screen.goals.length) screen.goals = [use.goal];
  const ctx: Ctx = {
    items, byId: new Map(items.map((it) => [it.id, it])), snap, screen, st: { ...st, minor }, ownMeds: new Set(resolve(items, screen.medications)),
    sheets: new Map(), emit, deps, gate, shortlistsOn: !held && !st.crisis && screen.ok,
    opened: new Set(), stepN: 0, memo: [], shortlists: 0, stacks: 0, questions: 0, uses: {}, plans: 0, mine: new Set(), audited: new Set(),
    injectShown: !!st.injectShown,
    signs: new Set(),
    goal: screen.goals[0], use, heard: new Map(), unread: new Set(), plan: NO_PLAN,
  };
  emit('step', { id: 'safety', agent: 'safety', status: 'done', title: screenTitle(screen, ctx.st), flag: minor && screen.red_flag === 'none' ? 'minor' : screen.red_flag });
  // Help comes first, and it's ours, not a model's
  if (screen.red_flag === 'self_harm') emit('card', { type: 'crisis' });
  if (screen.red_flag === 'emergency') emit('card', { type: 'urgent' });
  return { messages, deps, emit, last, st, screen, items, snap, axes, body, minor, held, pregnant: screen.pregnant || st.pregnant, gate, use, ctx };
}

// 2. What the studies say about what they named and what they want: the Planner, the
// Recommender's lookup, the Evidence librarian, the Relatives and Mechanism agents, and the
// Library's options for their goal
export type Studied = { named: string[]; recNote: string; evNote: string; sheetsForTurn: string[]; ladder: Ladder | null };
export async function studies(turn: Turn): Promise<Studied> {
  const { messages, emit, last, screen, items, snap, axes, held, gate, ctx } = turn;
  // 2. The Planner: what they want, in what studies measure, from their own words (their latest
  // message that names something) or else their goal
  if (!held && items.length) {
    ctx.plan = planOutcomes(messages.filter((m) => m.role === 'user').map((m) => m.content).reverse(), screen.goals);
    if (ctx.plan.outcomes.length) emit('step', { id: 'plan', agent: 'planner', status: 'done', title: plannerTitle(ctx.plan) });
  }
  let evNote = plannerNote(ctx.plan);
  let ladder: Ladder | null = null;

  // 2a. The Recommender's lookup: the compounds the member named, and options for their goal; then
  // the Evidence librarian reads their sheets for what the Planner read
  let recNote = 'nothing specific named yet.';
  const sheetsForTurn: string[] = [];
  const named = !held && items.length ? tidyBlends(items, [...new Set([...resolve(items, screen.compounds), ...mentioned(items, last)])], last).slice(0, 6) : [];
  // What's theirs: anything they've named in this chat (their plan shows only their own peptides)
  named.forEach((id) => ctx.mine.add(id));
  if (!held) for (const m of messages) if (m.role === 'user') tidyBlends(items, mentioned(items, m.content), m.content).forEach((id) => ctx.mine.add(id));
  if (!held && items.length) {
    const goal = screen.goals[0];
    if (named.length) {
      emit('step', { id: 'lookup', agent: 'recommender', status: 'run', title: 'Opening the fact sheets', chips: named.map((id) => chip(id, ctx)) });
      await openSheets(named.slice(0, 4), ctx);
      named.slice(0, 4).forEach((id) => { ctx.opened.add(id); sheetsForTurn.push(sheetText(id, ctx)); });
      const ready = named.slice(0, 4).filter((id) => ctx.sheets.get(id)).length;
      emit('step', { id: 'lookup', agent: 'recommender', status: 'done', title: ready ? `Opened ${ready} fact sheet${ready === 1 ? '' : 's'}` : 'No fact sheet yet for these', chips: named.map((id) => chip(id, ctx)) });
      recNote = `the member named ${named.map((id) => `${ctx.byId.get(id)!.name} [${id}]`).join(', ')}; their fact sheets (or a note that there isn't one yet) are below.`;
      // What each sheet shows on what they asked about (or, when the Planner had nothing to go on,
      // for their goal): a reply that says nothing is known gets it put back
      if (ctx.plan.outcomes.length) {
        const own = evidenceStep(named.slice(0, 4), ctx);
        evNote += `\n${evidenceNote(own, ctx.plan)}`;
        // 2b. The Relatives agent: what works through the same hormone or receptor, a rung below
        // (a turn never fails on it: without it, the ladder goes on from how each one works)
        const { note: relNote, rel } = await relativesStep(named.slice(0, 4), own, axes, ctx).catch((e) => {
          console.error('relatives', e);
          emit('step', { id: 'relatives', agent: 'relatives', status: 'done', title: 'Couldn’t look at relatives just now' });
          return { note: '', rel: [] as Related[] };
        });
        if (relNote) evNote += `\n${relNote}`;
        // 2c. The Mechanism agent: how each could bear on it, from its own sheet or pathway
        const mech = named.slice(0, 4).filter((id) => ctx.byId.has(id)).map((id) => mechanismFor(id, ctx.byId.get(id)!.name, ctx.sheets.get(id), ctx.plan, axes));
        if (mech.some((m) => m.how)) {
          emit('step', { id: 'mechanism', agent: 'mechanism', status: 'done', title: mechanismTitle(ctx.plan), chips: mech.filter((m) => m.how).map((m) => chip(m.id, ctx)) });
          evNote += `\n${mechanismNote(mech, ctx.plan)}`;
        }
        ladder = { own, rel, mech, pairs: [] };
      } else {
        gate.findings(named.slice(0, 4).flatMap((id) => (benefitsOf(ctx.sheets.get(id), goal, 2) ?? [])
          .map((b) => `${ctx.byId.get(id)?.name ?? id}: ${b.claim} (evidence: ${b.evidence || 'not graded'})`)));
      }
    } else if (ctx.plan.outcomes.length) {
      evNote += ' When you open fact sheets, the Evidence librarian marks their findings on exactly that.';
    }
    if (goal) {
      const opts = rank(items, snap.signals, goal, { limit: 8 });
      if (opts.length) {
        emit('step', { id: 'rank', agent: 'recommender', status: 'done', title: `Looked up options for ${GOAL_LABEL[goal]} in the Library` });
        recNote += ` Options for ${GOAL_LABEL[goal]} (best first):\n${opts.map(optionLine).join('\n')}`;
      }
    }
  } else if (!items.length) {
    recNote = 'the Library could not be reached just now; say so if it matters and stay general.';
  }
  return { named, recNote, evNote, sheetsForTurn, ladder };
}

export function combinationStage(turn: Turn, named: string[], comparing: boolean, ladder: Ladder | null): string {
  const { emit, axes, ctx } = turn;
  // 2d. The Combination agent: how what they named together relates, by the Library's pathways
  let comboNote = '';
  if (!comparing && named.length >= 2 && axes.length) {
    const p = pairings(named.slice(0, 4), axes);
    const name = (id: string) => ctx.byId.get(id)?.name ?? id;
    if (p.length) {
      emit('step', { id: 'combination', agent: 'combination', status: 'done', title: pairingTitle(p, name), chips: [...new Set(p.flatMap((x) => [x.a, x.b]))].map((id) => chip(id, ctx)) });
      comboNote = pairingNote(p, name);
      if (ladder) ladder.pairs = p;
    }
  }
  return comboNote;
}

export function markerStage(turn: Turn, named: string[]): string {
  const { emit, held, body, ctx } = turn;
  // 2e. The Markers agent: the blood markers what they named may move, and any pushed both ways
  let markNote = '';
  if (!held && named.length && body) {
    const r = readMarkers(named.slice(0, 4), body);
    if (r.drawn.length) {
      emit('step', { id: 'markers', agent: 'markers', status: 'done', title: markersTitle(r), chips: r.drawn.map((id) => chip(id, ctx)) });
      markNote = markersNote(r, (id) => ctx.byId.get(id)?.name ?? id);
    }
  }
  return markNote;
}

export type Heard = { communityNote: string; top: TopRow[]; voices: Voice[]; listUse: Use | null };
export function communityStage(turn: Turn, named: string[], comparing: boolean): Heard {
  const { emit, screen, items, snap, held, pregnant, use, ctx } = turn;
  // 2f. The community: what members and the public forums report on what they named and on what
  // they want it for, and which of the two voices leads, compound by compound
  let communityNote = '';
  let top: TopRow[] = [];
  const voices: Voice[] = [];
  // The community's list answers what they asked about, even when it's not the goal the studies
  // answer for (no studies voice is involved in it)
  const listUse = use ?? (screen.asks_community && !held ? useById(screen.uses[0]) : null);
  if (!held && items.length && (named.length || listUse)) {
    voices.push(...named.slice(0, 4).map((id) => voiceFor(id, ctx)).filter((v): v is Voice => !!v));
    // What the community reports most for a use: only when they ask, never in pregnancy or when
    // shortlists are off for this turn
    if (listUse && screen.asks_community && ctx.shortlistsOn && !pregnant && !screen.reaction && snap.ok !== false) top = communityTop(snap.signals, ctx.byId, listUse, 5);
    if (top.length < 2) top = [];   // a list of one isn't what the community reports most
    const asksInPregnancy = pregnant && screen.asks_community;
    emit('step', { id: 'community', agent: 'community', status: 'done', chips: voices.map((v) => chip(v.id, ctx)).slice(0, 6),
      title: snap.ok === false ? 'Couldn’t read the community’s numbers just now' : asksInPregnancy ? 'Left out what others use: pregnancy comes first' : communityTitle(voices, listUse, top) });
    const showVoices = voices.length > 0 && ctx.shortlistsOn && snap.ok !== false && !screen.reaction && !(named.length >= 2 || (named.length >= 1 && (screen.medications.length || screen.conditions.length || pregnant)));
    const showCrowd = top.filter((r) => ctx.byId.has(r.id)).length >= 2 && !!listUse && screen.asks_community && ctx.shortlistsOn && !pregnant;
    communityNote = snap.ok === false ? COMMUNITY_DOWN : [
      pulseLine(snap.community),
      top.length ? topText(top, listUse, (id) => ctx.byId.get(id)?.status_label ?? '') : '',
      asksInPregnancy ? 'They asked what others use, and they\'re pregnant, trying to conceive or breastfeeding: don\'t list what others use or report; say in a few words that it\'s left out because most of these haven\'t been studied in pregnancy, and that their obstetric clinician is the one to ask.' : '',
      // Two or more taken together: what the community has on that exact combination, first
      !comparing && voices.length >= 2 && !asksInPregnancy ? comboLine(voices.map((v) => v.name), stackSignal(voices.map((v) => v.name), snap.signals), listUse, snap.uses) : '',
      voices.length ? 'What the studies show and what the community reports on each compound they named, and which leads for this question, come with its fact sheet below.' : '',
      showVoices ? `After your opening words the member sees a card with the studies and the community side by side on ${voices.map((v) => v.name).join(', ')}. Don't read its numbers out one by one: say what they mean for their question, starting with the voice your notes say leads.` : '',
      showCrowd ? `After your opening words the member sees a card of what the community reports most for ${listUse!.label.toLowerCase()}, each with its US status. Say what stands out and how the studies compare; don't list it again.` : '',
      comparing && ctx.shortlistsOn ? `They're comparing ${named.map((id) => ctx.byId.get(id)!.name).join(', ')}. After your opening words they see a card with them side by side${use ? ` for ${use.label.toLowerCase()}` : ''}: what the studies show, what the community reports, US status and the one caution for each. Don't pick a winner, and never rank them by what people report: say how they differ for their goal (evidence in people, what people report, status, risks), proven options first, and what to ask a clinician. Don't read the card's numbers out.` : '',
    ].filter(Boolean).join('\n');
  }
  return { communityNote, top, voices, listUse };
}

export type Checked = { synNote: string; upfront: Audit | null };
export async function synergyStage(turn: Turn, named: string[], comparing: boolean): Promise<Checked> {
  const { emit, screen, deps, pregnant, ctx } = turn;
  // 3. The Synergy auditor, when the member's own compounds and medicines meet
  let synNote = '';
  let upfront: Audit | null = null;
  // Their medicines, conditions or pregnancy matter for what they compare too: each compound is
  // checked against them (findings about taking the compared ones together are left out)
  const memberRisk = !!(screen.medications.length || screen.conditions.length || pregnant);
  if ((!comparing || memberRisk) && (named.length >= 2 || (named.length >= 1 && memberRisk))) {
    emit('step', { id: 'synergy', agent: 'synergy', status: 'run', title: comparing ? `Checking each${screen.medications.length ? ' with your medicines' : ' for you'}` : `Checking ${named.length > 1 ? `${named.length} together` : ctx.byId.get(named[0])?.name ?? 'it'}${screen.medications.length ? ' with your medicines' : ''}` });
    await openSheets(named, ctx);
    const all = await auditSet(named, screen.medications, screen.conditions, pregnant, ctx, deps);
    const a = comparing ? { ...all, findings: all.findings.filter((f) => f.ids.filter((i) => named.includes(i)).length <= 1) } : all;
    emit('step', { id: 'synergy', agent: 'synergy', status: 'done', title: auditTitle(a, comparing ? 1 : named.length) });
    upfront = a;
    named.forEach((id) => ctx.audited.add(id));
    synNote = auditText(a, ctx.byId);
    if (comparing) {
      synNote += '\nThey\'re comparing these, not taking them together: what the auditor found about their own medicines, conditions or pregnancy goes in your safety line, naming the compound it applies to.';
    } else if (ctx.shortlistsOn) {
      synNote += `\nStack builder: after your opening words the member sees a "Your stack" card with ${named.map((id) => ctx.byId.get(id)!.name).join(', ')}, each with what the studies show (evidence, US status, safety notes) beside what the community reports, and the auditor's findings beneath. Give your read of their stack in words, benefits first: what each is there for, how it works toward their goal, what the community reports, how they fit together. Don't repeat the card's status and safety notes, and don't present these same compounds again with present_shortlist. Their plan (present_plan) puts them in its peptides and medicines layer (supplements in its supplements layer).${!screen.medications.length && !screen.conditions.length ? ' They haven\'t mentioned medicines or conditions: say in a few words that the check covers the compounds together, not medicines they haven\'t named.' : ''}`;
    }
  }
  return { synNote, upfront };
}
