// The community's side of every answer. Sig speaks for two sources together: what the
// studies show (the Library's fact sheets) and what the community reports (the Community
// Signal: members' first-hand reports and public forum data). This reads the second, from the
// public snapshot's aggregate numbers (never a post, a handle or a name), and decides, compound
// by compound, which of the two the answer starts with: the studies when there are studies in
// people for what was asked; what people report when there aren't, always said to be reports,
// not evidence; plain words when neither has anything yet. Safety comes before either: for
// anything on FDA's safety-risk list, or in pregnancy, the studies and the status lead.
import usesList from '../_shared/uses.json' with { type: 'json' };
import baselinesFile from '../_shared/baselines.json' with { type: 'json' };
import { cleanField } from './guard.ts';
import { BLOCKED, type Goal, GOALS, type Item, LEVEL_SHORT, type Pulse, type Signal } from './library.ts';

// What members take things for (shared/uses.json): what the Signal is rated by
export type Use = { id: string; label: string; goal: Goal };
export const USES: Use[] = (usesList.uses as Use[]).filter((u) => (GOALS as readonly string[]).includes(u.goal));
export const USE_IDS = USES.map((u) => u.id);
export const useById = (id: string | undefined | null) => USES.find((u) => u.id === id) ?? null;

// A rating for a use counts in the community's list only with this many reports, from this many
// different people (members who reported, or who tapped "same for me"): a handful of accounts
// can't put something at the top
export const RANK_MIN = { reports: 10, voices: 5 };

// How many people improve anyway, on a placebo or with time alone, for some uses
// (shared/baselines.json, from meta-analyses and large trials): context for what members report,
// never a direct comparison
export type Baseline = { use: string; placebo_pct: number; low: number; high: number; short: string; says: string; confidence: string };
const BASELINES: Baseline[] = ((baselinesFile as { uses?: Baseline[] }).uses ?? [])
  .filter((b) => b && typeof b.use === 'string' && Number.isFinite(b.placebo_pct) && typeof b.says === 'string');
export const baselineFor = (id: string | null | undefined) => BASELINES.find((b) => b.use === id) ?? null;
const STOP_WORDS: Record<string, string> = { done: 'it worked and they were done', no_effect: 'it didn\'t help', side_effects: 'side effects', cost: 'cost or hassle', other: 'something else' };

// The studies' side, as the caller worked it out from the fact sheet (agents.ts studiesOf)
export type Finding = { claim: string; evidence: string; source?: { title: string; year: string; url: string } };
export type Studies = {
  grade: string | null;    // how strong the evidence is for what was asked; "none" when the sheet has nothing on it
  forUse: boolean;
  main: string | null;     // the fact sheet's grade for its main use
  finding: Finding | null; // its best finding (about what was asked, when there is one)
};
// rating: pooled (what members report for that use everywhere, moving toward this compound's own
// reports); low, high: its likely range; betterPct: the share of its reports that said better
type UseRow = { id: string; label: string; rating: number | null; low: number | null; high: number | null; betterPct: number | null; reports: number; forum: string | null };
export type Community = {
  score: number; level: string; levelName: string;
  firstHand: number;       // members' own first-hand reports
  memberShare: number;     // how much of the Signal those make up, 0 to 100; public forum data is the rest
  // How members' first-hand reports went, across all uses (shown once three are read)
  outcomes: { better: number; same: number; worse: number; pct: number } | null;
  // What was asked about: rated by members (once three first-hand reports name it), or how often
  // the public forums mention it
  use: UseRow | null;
  // Nothing on that use yet: the closest use reported, for the same goal ("injury healing" for
  // "tendons & ligaments"), said as such
  near: UseRow | null;
  uses: UseRow[];
  sideEffects: { effect: string; n: number }[];   // n: how many reports mention it
  themes: { theme: string; label: string }[];     // what people describe most (Miracle Health's forum research)
  // How many improve anyway for what was asked (or its closest use), from trials: context only
  baseline: { use: string; pct: number; says: string } | null;
  // Side effects reported unusually often for it, compared with every other compound
  watch: { effect: string; n: number; of: number; pct: number; othersPct: number }[];
  serious: number;   // members' reports describing a reaction that sounded serious (3 or more)
  // What members' check-ins 2 to 12 weeks on say
  checkins: { reports: number; still: number; stopped: number; reasons: { reason: string; n: number }[]; at12: number; still12: number } | null;
  // Counted forum data from sources whose terms allow it
  forumCounts: { source: string; posts: number; positive: number | null; mixed: number | null; negative: number | null }[];
};
// Which source the answer starts with, for this compound and this question; why: when safety
// decides it rather than the evidence
export type Lead = 'studies' | 'community' | 'none';
export type Voice = { id: string; name: string; studies: Studies | null; community: Community | null; lead: Lead; why?: 'blocked' | 'pregnant' | 'reaction' };
export type Safety = { blocked?: boolean; pregnant?: boolean; reaction?: boolean };

const n0 = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.round(Number(x)) : 0);
// deno-lint-ignore no-control-regex
const words = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const FORUM_RANK: Record<string, number> = { 'very common': 4, common: 3, mixed: 2, occasional: 1 };
const forumRank = (f: string | null | undefined) => FORUM_RANK[String(f ?? '').toLowerCase()] ?? 0;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
// Labels in the Signal (what people describe, side effects mentioned), quoted as data
const said = (s: string) => `"${lower(s).replace(/["\[\]{}]/g, '')}"`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// On FDA's safety-risk list, or a blend with such a part (communityTop also keeps
// off anything whose US status the Library hasn't worked out, or calls unclear)
export function blockedItem(it: Item | undefined, byId: Map<string, Item>): boolean {
  if (!it) return true;
  if (BLOCKED.has(it.status ?? '')) return true;
  return (it.parts ?? []).some((p) => BLOCKED.has(byId.get(p)?.status ?? ''));
}

export function communityOf(sig: Signal | null | undefined, use: Use | null, labels: Record<string, [string, string]> = {}): Community | null {
  if (!sig || typeof sig.score !== 'number' || !Number.isFinite(sig.score)) return null;
  const o = sig.outcomes;
  const read = o ? n0(o.better) + n0(o.same) + n0(o.worse) : 0;
  const label = (id: string) => words(labels[id]?.[0] ?? useById(id)?.label ?? id.replace(/_/g, ' '), 40);
  type Raw = NonNullable<Signal['by_use']>[number];
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null);
  const row = (u: Raw): UseRow => {
    const rating = num(u.rating);
    const low = rating != null ? num(u.low) : null;
    const high = rating != null ? num(u.high) : null;
    return {
      id: words(u.use, 30), label: label(u.use), rating,
      ...(low != null && high != null && low <= rating! && high >= rating! ? { low, high } : { low: null, high: null }),
      betterPct: rating != null ? num(u.better_pct) : null,
      reports: n0(u.reports), forum: u.forum ? words(u.forum, 20) : null,
    };
  };
  const heard = (u: Raw) => typeof u.rating === 'number' || !!u.forum;
  const best = (a: Raw, b: Raw) => Number(typeof b.rating === 'number') - Number(typeof a.rating === 'number')
    || Number(b.rating ?? 0) - Number(a.rating ?? 0) || forumRank(b.forum) - forumRank(a.forum);
  const byUse = (Array.isArray(sig.by_use) ? sig.by_use : []).filter((u) => u && typeof u.use === 'string');
  const mine = use ? byUse.find((u) => u.use === use.id) : undefined;
  const near = use && !(mine && heard(mine))
    ? byUse.filter((u) => u.use !== use.id && heard(u) && useById(u.use)?.goal === use.goal).sort(best)[0] : undefined;
  return {
    score: Math.round(Number(sig.score) * 10) / 10,
    level: LEVEL_SHORT[sig.certification ?? ''] ? sig.certification! : 'forum',
    levelName: LEVEL_SHORT[sig.certification ?? ''] ?? LEVEL_SHORT.forum,
    firstHand: n0(sig.first_hand),
    memberShare: Math.min(100, n0(sig.internal_share)),
    outcomes: read ? {
      better: n0(o!.better), same: n0(o!.same), worse: n0(o!.worse),
      pct: typeof o!.better_pct === 'number' ? Math.round(o!.better_pct) : Math.round((100 * n0(o!.better)) / read),
    } : null,
    use: use ? (mine ? { ...row(mine), id: use.id, label: use.label } : { id: use.id, label: use.label, rating: null, low: null, high: null, betterPct: null, reports: 0, forum: null }) : null,
    near: near ? row(near) : null,
    // What it's used for: rated uses first, then what the forums mention most
    uses: [...byUse].filter(heard).sort(best).slice(0, 3).map(row),
    sideEffects: (Array.isArray(sig.side_effects) ? sig.side_effects : []).slice(0, 4).map((e) => ({ effect: cleanField(e?.effect, 40), n: n0(e?.n) })).filter((e) => e.effect),
    themes: (Array.isArray(sig.themes) ? sig.themes : []).slice(0, 3).map((t) => ({ theme: cleanField(t?.theme, 60), label: words(t?.label, 20) })).filter((t) => t.theme),
    baseline: (() => {
      const b = baselineFor(use?.id) ?? (near ? baselineFor(near.use) : null);
      return b ? { use: b.use, pct: Math.round(b.placebo_pct), says: words(b.says, 240) } : null;
    })(),
    watch: (Array.isArray(sig.watch) ? sig.watch : []).slice(0, 3)
      .map((w) => ({ effect: cleanField(w?.effect, 40), n: n0(w?.n), of: n0(w?.of), pct: n0(w?.pct), othersPct: Math.max(0, Math.round(Number(w?.others_pct) * 10) / 10 || 0) }))
      .filter((w) => w.effect && w.n && w.of),
    serious: n0(sig.serious),
    checkins: sig.checkins && n0(sig.checkins.reports) ? {
      reports: n0(sig.checkins.reports), still: n0(sig.checkins.still), stopped: n0(sig.checkins.stopped),
      reasons: Object.entries(sig.checkins.reasons ?? {}).filter(([k]) => STOP_WORDS[k]).map(([reason, n]) => ({ reason, n: n0(n) })).filter((r) => r.n).sort((a, b) => b.n - a.n),
      at12: n0(sig.checkins.at12), still12: n0(sig.checkins.still12),
    } : null,
    forumCounts: (Array.isArray(sig.forum_counts) ? sig.forum_counts : []).slice(0, 2)
      .map((f) => ({ source: words(f?.source, 60), posts: n0(f?.posts), positive: typeof f?.positive_pct === 'number' ? Math.round(f.positive_pct) : null,
        mixed: typeof f?.mixed_pct === 'number' ? Math.round(f.mixed_pct) : null, negative: typeof f?.negative_pct === 'number' ? Math.round(f.negative_pct) : null }))
      .filter((f) => f.source && f.posts),
  };
}

// Studies in people: strong, moderate or limited (small or short human studies)
const HUMAN = new Set(['strong', 'moderate', 'limited']);
export const studiesCover = (s: Studies | null) => !!s && s.forUse && HUMAN.has(s.grade ?? '');
// The community has something on what was asked: a rating or forum mentions for that use (or the
// closest use for the same goal), or, when no particular use was asked about, a Signal at all
export const communityCovers = (c: Community | null) => !!c && (!c.use || c.use.rating != null || !!c.use.forum || !!c.near);
export function leadOf(studies: Studies | null, community: Community | null, safety: Safety = {}): Lead {
  // Safety first: on FDA's safety-risk list, in pregnancy, or with a possible reaction happening
  // now, the status and the studies lead
  if (safety.blocked || safety.pregnant || safety.reaction) return 'studies';
  if (studiesCover(studies)) return 'studies';
  if (communityCovers(community)) return 'community';
  if (studies?.forUse && studies.grade && studies.grade !== 'none') return 'studies';
  return 'none';
}
export function voiceOf(item: Pick<Item, 'id' | 'name'>, studies: Studies | null, community: Community | null, safety: Safety = {}): Voice {
  const why = safety.reaction ? 'reaction' as const : safety.blocked ? 'blocked' as const : safety.pregnant ? 'pregnant' as const : undefined;
  return { id: item.id, name: item.name, studies, community, lead: leadOf(studies, community, safety), ...(why ? { why } : {}) };
}

// What the community reports most for one use: members' ratings first (only those with enough
// reports from enough members), then how often the public forums mention it, then the overall
// Signal. What people report, never a recommendation, and never anything blockedItem() keeps off.
export type TopRow = { id: string; name: string; status: string; rating: number | null; low: number | null; high: number | null; reports: number; forum: string | null; score: number; level: string };
export function communityTop(signals: Record<string, Signal>, byId: Map<string, Item>, use: Use, n = 5): TopRow[] {
  const rows: TopRow[] = [];
  for (const [id, sig] of Object.entries(signals ?? {})) {
    const it = byId.get(id);
    if (!it || !it.status || it.status === 'unclear' || blockedItem(it, byId) || typeof sig?.score !== 'number') continue;
    const u = (Array.isArray(sig.by_use) ? sig.by_use : []).find((x) => x?.use === use.id);
    if (!u) continue;
    const rated = typeof u.rating === 'number' && Number.isFinite(u.rating) && n0(u.reports) >= RANK_MIN.reports && n0(u.voices) >= RANK_MIN.voices;
    if (!rated && !u.forum) continue;
    const rating = rated ? Math.round(u.rating!) : null;
    const ranged = rated && typeof u.low === 'number' && typeof u.high === 'number' && u.low <= rating! && u.high >= rating!;
    rows.push({ id, name: it.name, status: it.status, rating, low: ranged ? Math.round(u.low!) : null, high: ranged ? Math.round(u.high!) : null,
      reports: rated ? n0(u.reports) : 0, forum: u.forum ? words(u.forum, 20) : null,
      score: Math.round(Number(sig.score) * 10) / 10, level: LEVEL_SHORT[sig.certification ?? ''] ? sig.certification! : 'forum' });
  }
  // Members' ratings by the low end of their likely range (how sure the community can be), then the
  // rating, then how many reported; the forums after
  const floor = (r: TopRow) => r.low ?? r.rating ?? 0;
  rows.sort((a, b) => Number(b.rating != null) - Number(a.rating != null) || floor(b) - floor(a) || (b.rating ?? 0) - (a.rating ?? 0) || b.reports - a.reports
    || forumRank(b.forum) - forumRank(a.forum) || b.score - a.score || a.name.localeCompare(b.name));
  return rows.slice(0, n);
}

// ---------------------------------------------------------------------------
// For the guide: what the community reports, with the numbers it may use (and no others)
// ---------------------------------------------------------------------------
const GRADE_WORDS: Record<string, string> = {
  strong: 'strong evidence in people', moderate: 'moderate evidence in people', limited: 'limited evidence (small or short studies in people)',
  preclinical: 'animal and lab studies only', anecdotal: 'user reports only, no studies',
};
function studiesLine(s: Studies | null): string {
  if (!s) return 'Studies: no fact sheet yet.';
  if (!s.forUse || s.grade === 'none') return `Studies: nothing on this in its fact sheet${s.main ? ` (${GRADE_WORDS[s.main] ?? s.main} for its main use)` : ''}.`;
  return `Studies: ${GRADE_WORDS[s.grade ?? ''] ?? 'graded'} for this.`;
}
const FORUM_WORDS: Record<string, string> = { 'very common': 'very often', common: 'often', mixed: 'now and then, with mixed reports', occasional: 'now and then' };
const forumWords = (f: string) => `the public forums mention it ${FORUM_WORDS[f.toLowerCase()] ?? 'now and then'}`;
const range = (r: { low: number | null; high: number | null }) => (r.low != null && r.high != null ? ` (likely ${r.low} to ${r.high})` : '');
const useWords = (u: UseRow) => (u.rating != null
  ? `members rate it ${u.rating}/100${range(u)} from ${plural(u.reports, 'report')}${u.betterPct != null ? `, ${u.betterPct}% of which said better` : ''}`
  : forumWords(u.forum ?? 'occasional'));
// What the community knows about safety: the side-effect watch and serious reactions
function safetyLines(c: Community): string[] {
  const out: string[] = [];
  if (c.watch.length) out.push(`Side-effect watch: members report ${c.watch.map((w) => `${said(w.effect)} unusually often with it (${w.n} of ${w.of} reports, ${w.pct}%, against ${w.othersPct}% for other compounds)`).join('; ')}. Say so in plain words with the caution line.`);
  if (c.serious) out.push(`${plural(c.serious, 'member report')} describe a reaction that sounded serious. A serious reaction needs medical help, and anyone can report one to the FDA through MedWatch.`);
  return out;
}
export function communityLine(c: Community | null): string {
  if (!c) return 'Community: no Signal yet (no member reports, and the public forums haven\'t been read for it).';
  const parts: string[] = [];
  const who = c.firstHand
    ? `${plural(c.firstHand, 'first-hand report')} from members, ${c.memberShare}% of the Signal; public forum data is the rest`
    : 'all from public forum data so far: no members\' first-hand reports yet';
  parts.push(`Community: Signal ${c.score.toFixed(1)}/100 (${c.levelName}; ${who}).`);
  if (c.use) {
    const u = c.use;
    const what = lower(u.label);
    const n = c.near;
    parts.push(u.rating != null || u.forum ? `For ${what}, ${useWords(u)}${u.rating == null ? '; too few members\' reports to rate it yet' : ''}.`
      : n ? `Nothing reported on it for ${what} specifically yet; for ${lower(n.label)}, the closest use reported, ${useWords(n)}.`
      : `Nobody has reported on it for ${what} yet.`);
  }
  const others = c.uses.filter((u) => u.id !== c.use?.id && u.id !== c.near?.id);
  if (others.length) parts.push(`${c.use ? 'Also reported for' : 'Mostly reported for'}: ${others.map((u) => `${lower(u.label)} (${useWords(u)})`).join(', ')}.`);
  if (c.outcomes) {
    const o = c.outcomes;
    parts.push(`Across all uses, ${o.better + o.same + o.worse} members' first-hand reports so far: ${o.better} better, ${o.same} about the same, ${o.worse} worse.`);
  }
  if (c.checkins) {
    const k = c.checkins;
    parts.push(`Check-ins 2 to 12 weeks after a report: ${plural(k.reports, 'report')} followed up; ${k.still} still taking it, ${k.stopped} stopped${k.reasons.length ? ` (${k.reasons.map((r) => `${STOP_WORDS[r.reason]}: ${r.n}`).join(', ')})` : ''}${k.at12 ? `; at 12 weeks, ${k.still12} of ${k.at12} were still taking it` : ''}.`);
  }
  if (c.themes.length) parts.push(`What people on the forums describe most: ${c.themes.map((t) => `${said(t.theme)} (${t.label.toLowerCase()})`).join(', ')}.`);
  if (c.forumCounts.length) parts.push(`Counted forum data: ${c.forumCounts.map((f) => `${f.source}, ${plural(f.posts, 'post')} read${f.positive != null ? `: ${f.positive}% positive, ${f.mixed ?? 0}% mixed, ${f.negative ?? 0}% negative` : ''}`).join('; ')}.`);
  if (c.sideEffects.length) parts.push(`Side effects mentioned in members' reports: ${c.sideEffects.map((e) => `${said(e.effect)} (${plural(e.n, 'report')})`).join(', ')}.`);
  parts.push(...safetyLines(c));
  // How many improve anyway: said once, as context for what people report, never as a comparison
  if (c.baseline && c.use) parts.push(`For context, how many improve anyway: ${c.baseline.says} A member's "better" is self-reported, so this is context, not a comparison; say it in a few words when you give what people report on this.`);
  return parts.join(' ');
}
export function leadLine(v: Voice): string {
  const s = v.studies;
  if (v.why === 'reaction') return '→ They describe something happening now that could be a reaction: what to do about it comes first. Leave out ratings and how reports went; side effects mentioned in members\' reports may be given, framed as what people report.';
  if (v.why === 'blocked') return '→ It\'s on FDA\'s list of substances with significant safety risks (or contains one): lead with that and with what the studies show. What people report comes last, in a few words, and never as a reason to take it.';
  if (v.why === 'pregnant') return '→ They\'re pregnant, trying to conceive or breastfeeding: lead with what\'s known about it then and with checking with their obstetric clinician first. What people report is left out.';
  if (v.lead === 'studies' && studiesCover(s)) return '→ Studies in people cover this: lead with them, then what the community reports.';
  if (v.lead === 'community') {
    const why = !s ? 'no fact sheet yet' : !s.forUse || s.grade === 'none' ? 'its studies aren\'t about this' : s.grade === 'preclinical' ? 'animal and lab studies only' : s.grade === 'anecdotal' ? 'user reports only' : 'no studies in people';
    return `→ No studies in people answer this (${why}): start with what people report, with these numbers and where they come from, and say in the same sentence that there are no studies in people for it. What people report isn't evidence. Then the studies in a few words.`;
  }
  if (v.lead === 'studies') {
    return s?.grade === 'anecdotal'
      ? '→ Its fact sheet has only user reports, no studies, and nothing is reported here on this yet: say so plainly.'
      : '→ Only animal or lab studies, and nothing reported here on this yet: say what the studies found, framed as such.';
  }
  return '→ Neither the studies nor the community have anything on this yet: say so plainly.';
}
// One compound's two voices, for the guide's notes and the fact sheets it opens
export function voiceLine(v: Voice): string {
  const fx = v.community?.sideEffects ?? [];
  // In pregnancy what people report is left out, but not what's known about its safety
  const community = v.why === 'pregnant' ? ['Community: what people report is left out in pregnancy.', ...(v.community ? safetyLines(v.community) : [])].join(' ')
    : v.why === 'reaction' ? [fx.length ? `Community: only the side effects mentioned in members' reports: ${fx.map((e) => `${said(e.effect)} (${plural(e.n, 'report')})`).join(', ')}.` : 'Community: left out while they describe a possible reaction.',
      ...(v.community ? safetyLines(v.community) : [])].join(' ')
    : communityLine(v.community);
  return `${v.name} [${v.id}], the studies and the community. ${studiesLine(v.studies)} ${community}\n${leadLine(v)}`;
}
export function pulseLine(p: Pulse | undefined): string {
  const members = n0(p?.members);
  const reports = n0(p?.reports);
  const signals = n0(p?.signals);
  if (!members && !reports && !signals) return '';
  // Before members' reports start, the Signals are what the public forums say
  if (!reports) return 'The community so far: no members\' first-hand reports yet, so every Community Signal is public forum data (each member\'s report counts as it comes in). Say "on the forums" for what they show.';
  return `The community so far: ${plural(members, 'member')}, ${plural(reports, 'first-hand report')} and ${plural(signals, 'Community Signal')}; on average ${Math.min(100, n0(p?.community_share))}% of a Signal comes from members' reports, the rest from public forum data.`;
}
// ---------------------------------------------------------------------------
// The exact combination: its own Signal, from members' first-hand reports of that stack. The
// community names a stack after its parts, joined with " + " in alphabetical order; every order
// is tried, so nothing depends on how a database sorts names.
// ---------------------------------------------------------------------------
export function stackSignal(names: string[], signals: Record<string, Signal> | undefined | null): Signal | null {
  if (!signals || names.length < 2 || names.length > 5) return null;
  const want = new Set<string>();
  const perm = (xs: string[], pre: string[] = []): void => {
    if (!xs.length) { want.add(pre.join(' + ').toLowerCase()); return; }
    xs.forEach((x, i) => perm([...xs.slice(0, i), ...xs.slice(i + 1)], [...pre, x]));
  };
  perm(names);
  return Object.values(signals).find((s) => !!s && s.kind === 'stack' && want.has(String(s.name ?? '').toLowerCase())) ?? null;
}
export function comboLine(names: string[], sig: Signal | null, use: Use | null, labels: Record<string, [string, string]> = {}): string {
  const what = names.join(' + ');
  if (!sig) {
    return `This exact combination (${what}): nobody has reported taking them together yet, as members or counted from the forums. Say so plainly in one sentence near the top, in an ask-first reply too ("Nobody here has reported taking them together yet"), then what people report on each one alone. Never describe what the combination does as something people reported.`;
  }
  const c = communityOf(sig, use, labels);
  return `This exact combination (${what}), from reports of taking them together: ${communityLine(c).replace(/^Community: /, '')} Say what people report about taking them together first, with these numbers, before each one alone.`;
}

// When the community's numbers couldn't be read: nothing is said about what people report
export const COMMUNITY_DOWN = 'Community: its numbers couldn\'t be loaded just now. Don\'t describe what people report, and don\'t say nobody has reported.';
export function topText(top: TopRow[], use: Use | null, status: (id: string) => string = () => ''): string {
  if (!use) return '';
  if (!top.length) return `Nothing on the community's list for ${lower(use.label)} yet.`;
  return [`What the community reports most for ${lower(use.label)} (members' ratings first, counted only with ${RANK_MIN.reports} or more reports from ${RANK_MIN.voices} or more people, in order of how sure the community can be: the low end of each likely range; then how often the public forums mention it). What people report, not a recommendation and never a reason to choose one; give each one's US status with it:`,
    ...top.map((r, i) => `${i + 1}. ${r.name} [${r.id}] (${status(r.id) || r.status}): ${r.rating != null ? `members rate it ${r.rating}/100${range(r)} from ${plural(r.reports, 'report')}` : `${forumWords(r.forum ?? 'occasional')}; not rated by members`} · overall Signal ${r.score.toFixed(1)} (${LEVEL_SHORT[r.level] ?? LEVEL_SHORT.forum})`),
  ].join('\n');
}

// The community's step in the agents' trace
export function communityTitle(voices: Voice[], use: Use | null, top: TopRow[]): string {
  const heard = voices.filter((v) => v.community);
  if (voices.length) {
    if (!heard.length) return voices.length === 1 ? `No reports on ${voices[0].name} yet, from members or the forums` : 'No reports on these yet, from members or the forums';
    const reports = heard.reduce((t, v) => t + (v.community?.firstHand ?? 0), 0);
    const names = heard.slice(0, 2).map((v) => v.name).join(' and ') + (heard.length > 2 ? ` and ${heard.length - 2} more` : '');
    return reports ? `Read ${plural(reports, 'member report')} and the forum data on ${names}` : `Read the forum data on ${names}: no member reports yet`;
  }
  if (use && top.length) return `Found what the community reports most for ${lower(use.label)}`;
  return 'Listened for what the community reports';
}
