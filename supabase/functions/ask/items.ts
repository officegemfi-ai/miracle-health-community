// What a card shows for each compound, from its fact sheet and the community's numbers: the
// findings for the member's goal, its US status as a tag and a caution, and the Miracle Plan's
// pillars.
import { BLOCKED, familyOne, type Item, LEVEL_SHORT, type Sheet, type Signal, type Snapshot, UNAPPROVED } from './library.ts';
import { cleanField, strict } from './guard.ts';
import { blockedItem, type Community, communityOf, type Lead, type Studies, type Use, voiceOf } from './community.ts';
import type { Screen } from './types.ts';

export type StudyFinding = { claim: string; evidence: string; source?: { title: string; year: string; url: string } };
// The Miracle Plan: three pillars at the base, then their peptides and medicines, supplements,
// and wellbeing and community on top
export const PILLARS = ['nutrition', 'sleep', 'exercise'] as const;
// start: their weakest pillar, where they begin (exactly one); next: also needs work
export const PILLAR_STATES = ['start', 'next', 'strong', 'unknown'] as const;
export type PillarState = typeof PILLAR_STATES[number];
// Wellbeing lines that would fit anyone: the card links to the community space itself
export const GENERIC_WELLBEING = /\b(?:share|post)\b[^.]*\b(?:wins?|progress|journey|updates?|story)\b|\bstay\s+(?:positive|motivated|consistent|on track)\b|\bcelebrate\b|\bmiracle\s+health\s+community\b|\b(?:join|find)\s+(?:the\s+)?community\b|\bbe\s+patient\b|\blisten\s+to\s+your\s+body\b/i;
export const PILLAR_NAME: Record<typeof PILLARS[number], string> = { nutrition: 'Nutrition', sleep: 'Sleep', exercise: 'Exercise' };
// A pillar's step when the guide gave none, or the check couldn't let its words through
export const PILLAR_STEP: Record<typeof PILLARS[number], string> = {
  nutrition: 'Protein at every meal, plus plenty of plants and water',
  sleep: 'Aim for 7 or more hours a night',
  exercise: 'Strength train and move most days',
};
// The nutrition step when the guide gave a protein target the check wouldn't pass: the target from
// public guidance, in the words the guide is given (a foundation target, never a dose)
export const PROTEIN_STEP = 'Protein at every meal: about 0.7 to 1 g of protein per pound of lean body mass';
export type PlanItem = {
  id: string; name: string; url: string; family: string; tag: string; tone: 'ok' | 'warn' | 'none';
  grade: string | null; use: { grade: string | null; fits: boolean }; role: string; yours: boolean;
};

export type CardItem = {
  id: string; name: string; family: string; role: string; why: string; url: string;
  status: { key: string; label: string } | null; grade: string | null;
  // The evidence for what the member asked about (from the findings that match their goal):
  // "none" when nothing in the fact sheet studies it
  use: { grade: string | null; fits: boolean };
  signal: { score: number; level: string; reports: number | null; effects: string[] } | null;
  // What the community reports (members' first-hand reports and public forum data), and which of
  // the two voices leads for what they asked
  community: Community | null; lead: Lead; communityNote?: 'pregnancy' | 'reaction' | 'down' | 'off';
  tag: string; tone: 'ok' | 'warn' | 'none'; caution: string;
  benefits: StudyFinding[];
  labs: string[];
};

// What the studies found, from the fact sheet: the two findings with the best evidence in people
// first, so a card shows what something may do, not only what isn't known
const EVIDENCE_RANK: Record<string, number> = { strong: 0, moderate: 1, limited: 2, preclinical: 3, anecdotal: 4 };
// A long finding keeps its first clause, the finding itself; the evidence tag beside it says how
// strong it is
const lead = (claim: string) => {
  const t = String(claim ?? '').trim();
  const i = t.indexOf(';');
  return t.length > 180 && i >= 60 ? t.slice(0, i) : t;
};
// Words that tie a finding to the member's goal, so a card for a tendon shows the joint study,
// not the skin one
const GOAL_WORDS: Record<string, RegExp> = {
  weight: /weight|fat\b|obes|\bbmi\b|waist|appetite|metabolic|insulin|blood sugar|glucose|diabet/i,
  muscle: /muscle|strength|lean mass|power|sprint|weightlift|body composition|sarcopen/i,
  recovery: /tendon|ligament|joint|osteoarth|arthrit|injur|wound|recover|soreness|muscle damage|cartilage|bone|fractur|stiff|knee|shoulder|back pain|musculoskeletal/i,
  energy: /fatigue|energy|tired|vitality|endurance|exhaust/i,
  sleep: /sleep|insomnia|jet lag|circadian/i,
  cognition: /memory|attention|focus|cognit|mood|anxiety|stress|depress|learning|brain|bdnf|mental/i,
  skin: /skin|wrinkle|hair|elastic|hydration|acne|pigment|tan\b/i,
  sexual: /sexual|libido|erectile|desire|arousal|fertility/i,
  longevity: /aging|ageing|lifespan|mortality|longevity|heart|cardio|frailty|cognitive decline/i,
  gut: /\bgut\b|bowel|colitis|crohn|\bibs\b|intestin|stomach|digest|ulcer|liver|inflamm/i,
  immune: /immun|infection|\bcolds?\b|\bflu\b|respiratory/i,
  hormonal: /testosterone|estrogen|hormone|menopaus|thyroid|cortisol|pcos/i,
};
export function benefitsOf(sheet: Sheet | null | undefined, goal?: string, n = 2): CardItem['benefits'] {
  const fits = goal ? GOAL_WORDS[goal] : undefined;
  const ranked = (sheet?.benefits ?? [])
    .map((b, i) => ({ b, i, r: EVIDENCE_RANK[b.evidence] ?? 5, off: fits && !fits.test(b.claim) ? 1 : 0 }))
    .sort((x, y) => x.off - y.off || x.r - y.r || x.i - y.i);
  // Findings about their goal only, when there are any; otherwise what it has been studied for
  const about = ranked.filter((x) => !x.off);
  return (about.length ? about : ranked)
    .slice(0, n)
    .map(({ b }) => {
      const source = sourceOf(sheet, b.sources?.[0]);
      return { claim: cleanField(strict(lead(b.claim)), 220), evidence: String(b.evidence || ''), ...(source ? { source } : {}) };
    })
    .filter((b) => b.claim);
}
function sourceOf(sheet: Sheet | null | undefined, n: number | undefined): StudyFinding['source'] {
  const src = sheet?.sources?.find((x) => x.n === n);
  if (!src || !/^https:\/\/[^\s"'<>]+$/.test(src.url ?? '')) return undefined;
  return { title: cleanField(src.title, 160), year: String(src.year ?? ''), url: src.url };
}
// How strong the evidence is for this member's goal: the best finding that's about it, or
// the sheet's overall grade when the goal is its main use; "none" when nothing studies it
export function useOf(sheet: Sheet | null | undefined, goal?: string): CardItem['use'] {
  if (!sheet) return { grade: null, fits: false };
  const fits = goal ? GOAL_WORDS[goal] : undefined;
  if (!fits) return { grade: sheet.evidence?.grade ?? null, fits: true };
  const ranks = (sheet.benefits ?? []).filter((b) => fits.test(b.claim)).map((b) => EVIDENCE_RANK[b.evidence] ?? 5);
  if (ranks.length) {
    const best = Math.min(...ranks);
    return { grade: Object.keys(EVIDENCE_RANK).find((k) => EVIDENCE_RANK[k] === best) ?? null, fits: true };
  }
  if (Number(sheet.goals?.[goal!] ?? 0) >= 0.75) return { grade: sheet.evidence?.grade ?? null, fits: true };
  return { grade: 'none', fits: false };
}
// The studies' side of a compound, for what the member asked: how strong the evidence is for it,
// the sheet's grade for its main use, and its best finding (null: no fact sheet yet)
export function studiesOf(sheet: Sheet | null | undefined, goal?: string): Studies | null {
  if (!sheet) return null;
  const u = useOf(sheet, goal);
  return { grade: u.grade, forUse: u.fits, main: sheet.evidence?.grade ?? null, finding: benefitsOf(sheet, goal, 1)[0] ?? null };
}
// Labs the fact sheet lists, before and during, to talk through with a clinician
const labsOf = (sheet: Sheet | null | undefined) =>
  [...(sheet?.labs?.before ?? []), ...(sheet?.labs?.during ?? [])].map((l) => cleanField(l, 160)).filter(Boolean).slice(0, 4);

// What every card item shares, whoever laid it out
export function baseItem(it: Item, sh: Sheet | null | undefined, ctx: { snap: Snapshot; use?: Use | null; byId?: Map<string, Item>; screen?: Screen; on?: (agent: string) => boolean }, pregnant: boolean, goal?: string) {
  const sig = ctx.snap.signals[it.id] as Signal | undefined;
  const { tag, tone } = tagFor(it, sh, ctx.byId);
  // In pregnancy what people report is left out; when the numbers couldn't be read, or the member
  // turned the community off for this chat, the card says so
  const reaction = !!ctx.screen?.reaction;
  const communityNote: CardItem['communityNote'] | null = pregnant ? 'pregnancy' : reaction ? 'reaction' : ctx.snap.ok === false ? 'down' : ctx.on && !ctx.on('community') ? 'off' : null;
  const community = communityNote ? null : communityOf(sig, ctx.use ?? null, ctx.snap.uses);
  const blocked = BLOCKED.has(sh?.status_us?.key ?? it.status ?? '') || blockedItem(it, ctx.byId ?? new Map());
  const studies = studiesOf(sh, goal);
  return {
    id: it.id, name: sh?.name ?? it.name, family: familyOne(it.family), url: `/library/${it.id}/`,
    status: sh ? { key: sh.status_us.key, label: sh.status_us.label } : null, grade: sh?.evidence?.grade ?? it.grade ?? null,
    use: useOf(sh, goal),
    signal: sig && typeof sig.score === 'number' && communityNote !== 'off' ? {
      score: Number(sig.score), level: LEVEL_SHORT[sig.certification ?? 'forum'] ?? 'Forum data',
      reports: typeof sig.first_hand === 'number' && sig.first_hand > 0 ? sig.first_hand : null,
      effects: (sig.side_effects ?? []).slice(0, 2).map((e) => cleanField(e.effect, 40)).filter(Boolean),
    } : null,
    community, lead: voiceOf(it, studies, community, { blocked, pregnant, reaction }).lead, ...(communityNote ? { communityNote } : {}),
    tag, tone, caution: cautionFor(it, sh, pregnant), benefits: benefitsOf(sh, goal), labs: labsOf(sh),
  };
}

export function tagFor(item: Item, sheet: Sheet | null | undefined, byId?: Map<string, Item>): { tag: string; tone: CardItem['tone'] } {
  const key = sheet?.status_us?.key ?? item.status;
  if (!BLOCKED.has(key ?? '') && byId && (item.parts ?? []).some((p) => BLOCKED.has(byId.get(p)?.status ?? ''))) return { tag: 'Contains a compound on FDA’s safety-risk list', tone: 'warn' };
  if (!key) return { tag: 'No fact sheet yet', tone: 'none' };
  if (key === 'approved') return { tag: item.family === 'Supplements' ? 'FDA-approved' : 'Prescription medicine', tone: 'ok' };
  if (key === 'otc') return { tag: 'Over the counter', tone: 'ok' };
  if (key === 'supplement') return { tag: 'Supplement', tone: 'ok' };
  if (key === 'compounded') return { tag: 'Compounded only', tone: 'warn' };
  if (key === 'investigational') return { tag: 'Clinical trials only', tone: 'warn' };
  if (key === 'unclear') return { tag: 'Status unclear', tone: 'warn' };
  // A special case (today NAC): the Library's word for it, as on its fact sheet; its label says the rest
  if (key === 'restricted') return { tag: 'Restricted', tone: 'warn' };
  if (BLOCKED.has(key)) return { tag: 'On FDA’s safety-risk list', tone: 'warn' };
  return { tag: 'Not approved', tone: 'warn' };
}

export function cautionFor(item: Item, sheet: Sheet | null | undefined, pregnant: boolean): string {
  const key = sheet?.status_us?.key ?? item.status ?? '';
  const lines: string[] = [];
  if (item.family === 'Hormones' && key === 'supplement') lines.push('A hormone sold as a supplement: worth testing your levels with a clinician first.');
  else if (item.family === 'Hormones') lines.push('A prescription hormone: only after testing, with a clinician monitoring.');
  else if (key === 'approved' && item.family !== 'Supplements') lines.push('A prescription medicine: whether it fits is your clinician’s call.');
  else if (key === 'investigational') lines.push('Not for use outside a clinical trial.');
  else if (key === 'compounded') lines.push('Not an FDA-approved product; only compounded under a prescription.');
  else if (key === 'restricted') lines.push(`Its FDA status is a special case: ${specialCase(item, sheet)}.`);
  else if (UNAPPROVED.has(key)) lines.push('Not approved by FDA; products sold outside approved medicines vary in contents, purity and sterility.');
  else if (!sheet) lines.push('No fact sheet yet: the Library is still researching it.');
  if (pregnant) lines.push('Pregnant, trying or breastfeeding: check with your obstetric clinician first.');
  return lines.join(' ');
}

// Proven first: approved, over the counter or supplements (and NAC's special case, an approved drug
// sold as a supplement), then compounded, then the rest
export const proven = (key: string) => (['approved', 'otc', 'supplement', 'restricted'].includes(key) ? 0 : key === 'compounded' ? 1 : key ? 2 : 3);
// A special case's status in the Library's own words (its fact sheet's label, else the index's),
// to follow a colon: "Approved drug; …" becomes "approved drug; …", while "FDA …" stays as it is
function specialCase(item: Item, sheet: Sheet | null | undefined): string {
  const label = (sheet?.status_us?.label ?? item.status_label ?? '').trim().replace(/[.\s]+$/, '');
  if (!label) return 'see its fact sheet';
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}
