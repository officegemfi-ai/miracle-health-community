// The community's side of every answer. Miracle AI speaks for two sources together: what the
// studies show (the Library's fact sheets) and what the community reports (the Community
// Signal: members' first-hand reports and public forum data). This reads the second, from the
// public snapshot's aggregate numbers (never a post, a handle or a name), and decides, compound
// by compound, which of the two carries the answer: the studies when there are studies in people
// for what was asked, the community's reports when there aren't, and plain words when neither
// has anything yet.
import usesList from '../_shared/uses.json' with { type: 'json' };
import { BLOCKED, type Goal, GOALS, type Item, LEVEL_SHORT, type Pulse, type Signal } from './library.ts';

// What members take things for (shared/uses.json): what the Signal is rated by
export type Use = { id: string; label: string; goal: Goal };
export const USES: Use[] = (usesList.uses as Use[]).filter((u) => (GOALS as readonly string[]).includes(u.goal));
export const USE_IDS = USES.map((u) => u.id);
export const useById = (id: string | undefined | null) => USES.find((u) => u.id === id) ?? null;

// The studies' side, as the caller worked it out from the fact sheet (agents.ts studiesOf)
export type Finding = { claim: string; evidence: string; source?: { title: string; year: string; url: string } };
export type Studies = {
  grade: string | null;    // how strong the evidence is for what was asked; "none" when the sheet has nothing on it
  forUse: boolean;
  main: string | null;     // the fact sheet's grade for its main use
  finding: Finding | null; // its best finding (about what was asked, when there is one)
};
export type Community = {
  score: number; level: string; levelName: string;
  firstHand: number;       // members' own first-hand reports
  memberShare: number;     // how much of the Signal those make up, 0 to 100; public forum data is the rest
  outcomes: { better: number; same: number; worse: number; pct: number; low: number | null; high: number | null } | null;
  // What was asked about: rated by members (once three first-hand reports name it), or how often
  // the public forums mention it
  use: { id: string; label: string; rating: number | null; reports: number; forum: string | null } | null;
  uses: { id: string; label: string; rating: number | null; reports: number; forum: string | null }[];
  sideEffects: { effect: string; n: number }[];
  themes: { theme: string; label: string }[];
};
// Which source carries the answer for this compound and this question
export type Lead = 'studies' | 'community' | 'none';
export type Voice = { id: string; name: string; studies: Studies | null; community: Community | null; lead: Lead };

const n0 = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.round(Number(x)) : 0);
// deno-lint-ignore no-control-regex
const words = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const FORUM_RANK: Record<string, number> = { 'very common': 4, common: 3, mixed: 2, occasional: 1 };
const forumRank = (f: string | null | undefined) => FORUM_RANK[String(f ?? '').toLowerCase()] ?? 0;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
// Words members' reports put into the Signal (its themes and side effects), quoted as data
const said = (s: string) => `"${lower(s).replace(/["\[\]{}]/g, '')}"`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function communityOf(sig: Signal | null | undefined, use: Use | null, labels: Record<string, [string, string]> = {}): Community | null {
  if (!sig || typeof sig.score !== 'number' || !Number.isFinite(sig.score)) return null;
  const o = sig.outcomes;
  const read = o ? n0(o.better) + n0(o.same) + n0(o.worse) : 0;
  const label = (id: string) => words(labels[id]?.[0] ?? useById(id)?.label ?? id.replace(/_/g, ' '), 40);
  const row = (u: NonNullable<Signal['by_use']>[number]) => ({
    id: words(u.use, 30), label: label(u.use),
    rating: typeof u.rating === 'number' && Number.isFinite(u.rating) ? Math.round(u.rating) : null,
    reports: n0(u.reports), forum: u.forum ? words(u.forum, 20) : null,
  });
  const byUse = (Array.isArray(sig.by_use) ? sig.by_use : []).filter((u) => u && typeof u.use === 'string');
  const mine = use ? byUse.find((u) => u.use === use.id) : undefined;
  return {
    score: Math.round(Number(sig.score) * 10) / 10,
    level: LEVEL_SHORT[sig.certification ?? ''] ? sig.certification! : 'forum',
    levelName: LEVEL_SHORT[sig.certification ?? ''] ?? LEVEL_SHORT.forum,
    firstHand: n0(sig.first_hand),
    memberShare: Math.min(100, n0(sig.internal_share)),
    outcomes: read ? {
      better: n0(o!.better), same: n0(o!.same), worse: n0(o!.worse),
      pct: typeof o!.better_pct === 'number' ? Math.round(o!.better_pct) : Math.round((100 * n0(o!.better)) / read),
      low: typeof o!.better_low === 'number' ? Math.round(o!.better_low) : null,
      high: typeof o!.better_high === 'number' ? Math.round(o!.better_high) : null,
    } : null,
    use: use ? (mine ? { ...row(mine), id: use.id, label: use.label } : { id: use.id, label: use.label, rating: null, reports: 0, forum: null }) : null,
    // What it's used for: rated uses first, then what the forums mention most
    uses: [...byUse].sort((a, b) => Number(typeof b.rating === 'number') - Number(typeof a.rating === 'number')
      || Number(b.rating ?? 0) - Number(a.rating ?? 0) || forumRank(b.forum) - forumRank(a.forum)).slice(0, 3).map(row),
    sideEffects: (Array.isArray(sig.side_effects) ? sig.side_effects : []).slice(0, 4).map((e) => ({ effect: words(e?.effect, 40), n: n0(e?.n) })).filter((e) => e.effect),
    themes: (Array.isArray(sig.themes) ? sig.themes : []).slice(0, 3).map((t) => ({ theme: words(t?.theme, 60), label: words(t?.label, 20) })).filter((t) => t.theme),
  };
}

// Studies in people: strong, moderate or limited (small or short human studies)
const HUMAN = new Set(['strong', 'moderate', 'limited']);
export const studiesCover = (s: Studies | null) => !!s && s.forUse && HUMAN.has(s.grade ?? '');
// The community has something to say about what was asked: a rating or forum mentions for that
// use, or (when no particular use was asked about) a Signal at all
export const communityCovers = (c: Community | null) => !!c && (!c.use || c.use.rating != null || !!c.use.forum);
export function leadOf(studies: Studies | null, community: Community | null): Lead {
  if (studiesCover(studies)) return 'studies';
  if (communityCovers(community)) return 'community';
  if (studies?.forUse && studies.grade && studies.grade !== 'none') return 'studies';
  return 'none';
}
export function voiceOf(item: Pick<Item, 'id' | 'name'>, studies: Studies | null, community: Community | null): Voice {
  return { id: item.id, name: item.name, studies, community, lead: leadOf(studies, community) };
}

// What the community rates highest for one use: members' ratings first (a use is rated once
// three first-hand reports name it), then how often the public forums mention it, then the
// overall Signal. Never anything on FDA's safety-risk list or otherwise restricted.
export type TopRow = { id: string; name: string; rating: number | null; reports: number; forum: string | null; score: number; level: string };
export function communityTop(signals: Record<string, Signal>, byId: Map<string, Item>, use: Use, n = 5): TopRow[] {
  const rows: TopRow[] = [];
  for (const [id, sig] of Object.entries(signals ?? {})) {
    const it = byId.get(id);
    if (!it || BLOCKED.has(it.status ?? '') || typeof sig?.score !== 'number') continue;
    const u = (Array.isArray(sig.by_use) ? sig.by_use : []).find((x) => x?.use === use.id);
    const rating = typeof u?.rating === 'number' && Number.isFinite(u.rating) ? Math.round(u.rating) : null;
    if (!u || (rating == null && !u.forum)) continue;
    rows.push({ id, name: it.name, rating, reports: n0(u.reports), forum: u.forum ? words(u.forum, 20) : null, score: Math.round(Number(sig.score) * 10) / 10,
      level: LEVEL_SHORT[sig.certification ?? ''] ? sig.certification! : 'forum' });
  }
  rows.sort((a, b) => Number(b.rating != null) - Number(a.rating != null) || (b.rating ?? 0) - (a.rating ?? 0) || b.reports - a.reports
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
function forumWords(f: string): string {
  return `the public forums mention it ${f.toLowerCase() === 'mixed' ? 'now and then, with mixed reports' : f.toLowerCase()}`;
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
    parts.push(u.rating != null ? `For ${what}, members rate it ${u.rating}/100 from ${plural(u.reports, 'report')}.`
      : u.forum ? `For ${what}, ${forumWords(u.forum)}; too few members' reports to rate it yet.`
      : `Nobody has reported on it for ${what} yet.`);
  }
  const others = c.uses.filter((u) => u.id !== c.use?.id);
  if (others.length) {
    parts.push(`${c.use ? 'Also used for' : 'Mostly used for'}: ${others.map((u) => (u.rating != null ? `${lower(u.label)} (members rate it ${u.rating}, ${plural(u.reports, 'report')})` : `${lower(u.label)} (forums: ${String(u.forum).toLowerCase()})`)).join(', ')}.`);
  }
  if (c.outcomes) {
    const o = c.outcomes;
    parts.push(`Of ${o.better + o.same + o.worse} members' first-hand reports: ${o.better} better, ${o.same} about the same, ${o.worse} worse (${o.pct}% better${o.low != null && o.high != null ? `; with this many reports, likely ${o.low} to ${o.high}%` : ''}).`);
  }
  if (c.themes.length) parts.push(`What people describe most: ${c.themes.map((t) => `${said(t.theme)} (${t.label.toLowerCase()})`).join(', ')}.`);
  if (c.sideEffects.length) parts.push(`Side effects members mention: ${c.sideEffects.map((e) => `${said(e.effect)} (${plural(e.n, 'member')})`).join(', ')}.`);
  return parts.join(' ');
}
export function leadLine(v: Voice): string {
  const s = v.studies;
  if (v.lead === 'studies' && studiesCover(s)) return '→ Studies in people cover this: lead with them, then what the community reports.';
  if (v.lead === 'community') {
    const why = !s ? 'no fact sheet yet' : !s.forUse || s.grade === 'none' ? 'its studies aren\'t about this' : s.grade === 'preclinical' ? 'animal and lab studies only' : 'no studies in people';
    return `→ The studies don't answer this (${why}): lead with what the community reports, with these numbers and where they come from, then the studies in a few words.`;
  }
  if (v.lead === 'studies') return '→ Only animal or lab studies, and no community reports on this yet: say what the studies found, framed as such, and that people haven\'t reported on it here yet.';
  return '→ Neither the studies nor the community have anything on this yet: say so plainly, and that their report would be among the first.';
}
// One compound's two voices, for the guide's notes and the fact sheets it opens
export function voiceLine(v: Voice): string {
  return `${v.name} [${v.id}], the studies and the community. ${studiesLine(v.studies)} ${communityLine(v.community)}\n${leadLine(v)}`;
}
export function pulseLine(p: Pulse | undefined): string {
  const members = n0(p?.members);
  const reports = n0(p?.reports);
  const signals = n0(p?.signals);
  if (!members && !reports && !signals) return '';
  // Before members' reports start, the Signals are what the public forums say
  if (!reports) return `The community so far: ${plural(signals, 'Community Signal')}, all from public forum data; no members' first-hand reports yet (each one counts as it comes in). Say "on the forums" for what they show.`;
  return `The community so far: ${plural(members, 'member')}, ${plural(reports, 'first-hand report')} and ${plural(signals, 'Community Signal')}; on average ${Math.min(100, n0(p?.community_share))}% of a Signal comes from members' reports, the rest from public forum data.`;
}
export function topText(top: TopRow[], use: Use | null): string {
  if (!use) return '';
  if (!top.length) return `Nobody in the community has reported on anything for ${lower(use.label)} yet, and the public forums haven't been read for it.`;
  return [`What the community rates highest for ${lower(use.label)} (what members and the public forums report, not a recommendation; members' ratings first):`,
    ...top.map((r, i) => `${i + 1}. ${r.name} [${r.id}]: ${r.rating != null ? `members rate it ${r.rating}/100 from ${plural(r.reports, 'report')}` : `${forumWords(r.forum ?? 'occasional')}; not rated by members yet`} · Signal ${r.score.toFixed(1)} (${LEVEL_SHORT[r.level] ?? LEVEL_SHORT.forum})`),
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
  if (use) return top.length ? `Found what the community reports most for ${lower(use.label)}` : `No reports yet on ${lower(use.label)}`;
  return 'Listened for what the community reports';
}
