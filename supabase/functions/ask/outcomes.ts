// Two of Sig's agents, both plain code (fast, and the same answer every time):
//   the Planner turns what the member wants into what studies measure ("fat loss" is body fat,
//   with the body weight and lean mass that studies of it measure too), from their own words or,
//   when they name nothing measurable, from the goal the Safety agent read;
//   the Evidence librarian then reads each fact sheet opened this turn for findings on exactly
//   those, strongest first, each with who was studied, and says plainly when a sheet has none,
//   so Sig goes down the evidence ladder instead of saying there's no evidence.
import { cleanField, strict } from './guard.ts';
import { GOAL_LABEL, type Goal, type Sheet } from './library.ts';

// What a member asks for (asked), how a finding about it reads (found), and what studies of it
// measure too (with)
export type Outcome = { id: string; label: string; asked: RegExp; found: RegExp; with?: string[] };
export const OUTCOMES: Outcome[] = [
  { id: 'belly_fat', label: 'belly fat', with: ['body_fat'],
    asked: /\b(?:belly|visceral|abdominal|stomach|tummy|gut)\s+fat\b|\bwaist(?:line)?\b|\blove\s+handles\b/i,
    found: /\bvisceral\b|\b(?:belly|abdominal|trunk)\s+fat\b|\bwaist\b/i },
  { id: 'body_fat', label: 'body fat', with: ['body_weight', 'lean_mass'],
    asked: /\bfat\b|\bcutting\b|\b(?:a|my|on\s+a)\s+cut\b|\bshred|\blean(?:er)?\s+out\b|\bbody\s+composition\b|\blipoly/i,
    found: /\bbody\s+fat\b|\bfat\s+(?:mass|loss)\b|\b(?:less|lower|lost|losing|reduced|cut)\s+(?:\w+\s+){0,3}?fat\b|\b(?:liver|trunk)\s+fat\b|\bvisceral\b|\bwaist\b|\badipos|\blipoly/i },
  { id: 'body_weight', label: 'body weight', with: ['body_fat'],
    asked: /\bweight\b(?!\s+(?:training|lifting|room|bench|vest|class))|\bpounds\b|\bobes|\boverweight\b|\bbmi\b/i,
    found: /\bbody[- ]weight\b|\bweight\s+(?:loss|reduction|regain)\b|\b(?:lost|lose|losing|lower)\s+(?:\w+\s+){0,3}?weight\b|\bbmi\b/i },
  { id: 'appetite', label: 'appetite',
    asked: /\bappetite\b|\bcravings?\b|\bhunger\b|\bfood\s+noise\b|\bovereat/i, found: /\bappetite\b|\bcravings?\b|\bhunger\b|\bfood\s+intake\b|\bcalorie\s+intake\b/i },
  { id: 'blood_sugar', label: 'blood sugar',
    asked: /\bblood\s+sugar\b|\bglucose\b|\binsulin\b|\bdiabet|\bhba1c\b|\bmetabolic\b/i, found: /\bblood\s+sugar\b|\bglucose\b|\binsulin\b|\bhba1c\b|\bglycemic\b/i },
  { id: 'lean_mass', label: 'lean mass', with: ['strength'],
    asked: /\bmuscles?\b(?!\s+(?:pain|soreness|sore|cramps?|damage|tears?|strains?|injur\w*|spasms?|aches?))|\blean\s+mass\b|\bbulk(?:ing)?\b|\bgain\s+(?:mass|size)\b|\bbody\s+composition\b|\bsarcopen/i,
    found: /\blean\s+(?:body\s+)?(?:mass|tissue)\b|\bmuscle\s+(?:mass|size|growth|protein\s+synthesis)\b|\bfat-free\s+mass\b|\bsarcopen/i },
  { id: 'strength', label: 'strength', with: ['lean_mass'],
    asked: /\bstrength\b|\bstronger\b|\bpower(?:ful)?\b|\b1rm\b|\b(?<!sexual\s)performance\b/i, found: /\bstrength\b|\bstronger\b|\bpower\b|\b1rm\b|\b(?<!sexual\s)performance\b/i },
  { id: 'tendon', label: 'tendon and ligament healing',
    asked: /\btendon|\bligament|\btendin/i, found: /\btendon|\bligament|\btendin/i },
  { id: 'joints', label: 'joint pain and function', with: ['tendon'],
    asked: /\bjoints?\b|\bknees?\b|\bshoulders?\b|\belbows?\b|\bhips?\b|\barthrit|\bcartilage\b|\bback\s+pain\b/i,
    found: /\bjoints?\b|\b(?:knee|hip|shoulder|elbow|back)\s+(?:pain|function|stiffness|symptoms?)\b|\barthrit|\bcartilage\b|\bosteoarth/i },
  { id: 'healing', label: 'wound and tissue healing', with: ['tendon'],
    asked: /\bwounds?\b|\bheal(?:ing)?\b|\binjur(?:y|ies|ed)\b|\brecover(?:y|ing)?\s+from\b/i, found: /\bwounds?\b|\bheal(?:ing|ed|s)?\b|\binjur(?:y|ies|ed)\b/i },
  { id: 'sleep', label: 'sleep', asked: /\bsleep|\binsomnia\b/i, found: /\bsleep|\binsomnia\b/i },
  { id: 'cognition', label: 'memory and focus',
    asked: /\bmemory\b|\bfocus\b|\bcognit|\bbrain\s+fog\b|\battention\b|\bconcentrat/i, found: /\bmemory\b|\battention\b|\bcognit|\bexecutive\s+function\b|\bconcentrat/i },
  { id: 'mood', label: 'mood and anxiety', asked: /\bmood\b|\banxi|\bdepress|\bstress\b/i, found: /\bmood\b|\banxi|\bdepress|\bstress\b/i },
  { id: 'energy', label: 'energy and fatigue',
    asked: /\benergy\b|\bfatigue\b|\btired|\bstamina\b|\bendurance\b|\bexhaust/i, found: /\benergy\b|\bfatigue\b|\bendurance\b|\bvitality\b|\bexhaust/i },
  { id: 'testosterone', label: 'testosterone', asked: /\btestosterone\b|\blow\s+t\b|\btrt\b|\bhypogonad/i, found: /\btestosterone\b|\bhypogonad/i },
  { id: 'fertility', label: 'fertility', asked: /\bfertil|\bsperm\b|\bconceiv/i, found: /\bfertil|\bsperm\b|\bconcept/i },
  { id: 'libido', label: 'libido and sexual function',
    asked: /\blibido\b|\bsex\s+drive\b|\berectile\b|\bsexual\b/i, found: /\blibido\b|\bsexual\b|\berectile\b|\barousal\b|\bdesire\b/i },
  { id: 'skin', label: 'skin', asked: /\bskin\b|\bwrinkles?\b|\bcollagen\b|\bacne\b/i, found: /\bskin\b|\bwrinkle|\belasticity\b|\bacne\b/i },
  { id: 'hair', label: 'hair', asked: /\bhair\b|\bbald|\balopecia\b/i, found: /\bhair\b|\balopecia\b/i },
  { id: 'gut', label: 'gut symptoms',
    asked: /\bgut\b(?!\s+fat)|\bbloat|\bibs\b|\bcolitis\b|\bcrohn|\bdigest|\bstomach\b(?!\s+fat)|\bbowel\b/i,
    found: /\bgut\b|\bbowel\b|\bcolitis\b|\bcrohn|\bibs\b|\bulcers?\b|\bdigest|\bintestin/i },
  { id: 'heart', label: 'heart health',
    asked: /\bheart\b|\bcardio|\bblood\s+pressure\b|\bcholesterol\b|\blipids?\b/i, found: /\bheart\b|\bcardio|\bblood\s+pressure\b|\bcholesterol\b|\btriglycerides?\b|\bstrokes?\b/i },
  { id: 'immune', label: 'infections and immunity', asked: /\bimmun|\binfections?\b|\bcolds?\b|\bflu\b/i, found: /\bimmun|\binfections?\b|\bcolds?\b|\bflu\b|\brespiratory\b/i },
  { id: 'aging', label: 'healthy aging',
    asked: /\baging\b|\bageing\b|\blongevity\b|\blifespan\b|\banti-?aging\b|\blive\s+longer\b/i, found: /\baging\b|\bageing\b|\blifespan\b|\bmortality\b|\bdeaths?\b|\bfrailty\b/i },
];
// When their words name nothing measurable, their goal stands for these
const BY_GOAL: Partial<Record<Goal, string[]>> = {
  weight: ['body_fat', 'body_weight'], muscle: ['lean_mass', 'strength'], recovery: ['tendon', 'joints', 'healing'],
  energy: ['energy'], sleep: ['sleep'], cognition: ['cognition', 'mood'], skin: ['skin', 'hair'], sexual: ['libido'],
  longevity: ['aging', 'heart'], gut: ['gut'], immune: ['immune'], hormonal: ['testosterone'],
};
const byId = new Map(OUTCOMES.map((o) => [o.id, o]));

export type Planned = Outcome & { related?: boolean };
export type Plan = { outcomes: Planned[]; from: 'words' | 'goal' | null; goal?: Goal };
export const NO_PLAN: Plan = { outcomes: [], from: null };

// The Planner: what they asked about, from their latest message that names something measurable
// (the last three), then what studies of it measure too; their goal when none does. At most four.
export function planOutcomes(texts: string[], goals: Goal[]): Plan {
  for (const t of texts.slice(0, 3)) {
    const asked = OUTCOMES.filter((o) => o.asked.test(t));
    if (!asked.length) continue;
    const seen = new Set(asked.map((o) => o.id));
    const related = asked.flatMap((o) => o.with ?? []).filter((id) => !seen.has(id) && seen.add(id)).map((id) => ({ ...byId.get(id)!, related: true }));
    return { outcomes: [...asked, ...related].slice(0, 4), from: 'words' };
  }
  const ids = goals[0] ? BY_GOAL[goals[0]] ?? [] : [];
  return ids.length ? { outcomes: ids.map((id) => byId.get(id)!).slice(0, 4), from: 'goal', goal: goals[0] } : NO_PLAN;
}

// A finding's effect, without who was studied: "lowered triglycerides in adults with excess belly
// fat" isn't a finding about belly fat
const WHO = /[,;]?\s(?:in|among)\s+(?:about\s+|roughly\s+|nearly\s+|over\s+|more\s+than\s+|up\s+to\s+)?(?:[\d,]+\s+)?(?:(?:healthy|aged|old|older|younger|young|obese|overweight|postmenopausal|premenopausal|elderly|middle-aged|trained|untrained|resistance-trained|active|sedentary|hospitalized|critically\s+ill)\s+)*(?:adults?|people|persons|men|women|children|kids|teens|adolescents|boys|girls|infants|patients|participants|volunteers|athletes|subjects|individuals|mice|rats|rodents|animals|dogs|pigs|primates|monkeys|cells|smokers|users|lifters|runners|cyclists|veterans|randomi[sz]ed|(?:a\s+)?(?:small\s+|large\s+)?(?:trials?|stud(?:y|ies)|meta-analys[ie]s|reviews?))\b/i;
export function effectOf(claim: string): string {
  const m = WHO.exec(claim);
  return m && m.index >= 12 ? claim.slice(0, m.index) : claim;
}

export type Found = { outcome: string; claim: string; evidence: string };
export type Evidence = { id: string; name: string; sheet: 'ok' | 'none' | 'unread'; found: Found[] };
const RANK: Record<string, number> = { strong: 0, moderate: 1, limited: 2, preclinical: 3, anecdotal: 4 };
// How strong, in the words the site uses
const GRADE: Record<string, string> = { strong: 'strong evidence', moderate: 'moderate evidence', limited: 'small human studies', preclinical: 'animal or lab studies', anecdotal: 'user reports' };

// The Evidence librarian: one fact sheet's findings on what they asked about, strongest first.
// A finding goes under what it's mainly about: the first of what they asked that it names, or
// else the first of what studies of it measure too ("kept sperm counts up at the same testosterone
// levels" is about fertility)
function aboutOf(effect: string, outcomes: Planned[]): Planned | undefined {
  for (const group of [outcomes.filter((o) => !o.related), outcomes.filter((o) => o.related)]) {
    const hits = group.map((o) => ({ o, at: effect.search(o.found) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at);
    if (hits.length) return hits[0].o;
  }
}
export function evidenceFor(id: string, name: string, sheet: Sheet | null | undefined, outcomes: Planned[], unread = false): Evidence {
  const found: (Found & { r: number; i: number })[] = [];
  (sheet?.benefits ?? []).forEach((b, i) => {
    const o = aboutOf(effectOf(String(b.claim ?? '')), outcomes);
    const claim = cleanField(strict(String(b.claim ?? '')), 300);
    if (o && claim) found.push({ outcome: o.label, claim, evidence: String(b.evidence || ''), r: RANK[b.evidence] ?? 5, i });
  });
  found.sort((a, b) => a.r - b.r || a.i - b.i);
  return { id, name, sheet: sheet ? 'ok' : unread ? 'unread' : 'none', found: found.slice(0, 3).map(({ outcome, claim, evidence }) => ({ outcome, claim, evidence })) };
}

const listOf = (xs: string[], and = 'and') => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`);
const labels = (plan: Plan, which?: 'asked' | 'related') => plan.outcomes.filter((o) => !which || (which === 'related') === !!o.related).map((o) => o.label);

export const plannerTitle = (plan: Plan) => `Looking for evidence on ${listOf(labels(plan))}`;
export function evidenceTitle(ev: Evidence[]): string {
  const n = ev.reduce((t, e) => t + e.found.length, 0);
  const read = ev.filter((e) => e.sheet === 'ok').length;
  if (!read) return ev.length === 1 ? 'No fact sheet to search yet' : 'No fact sheets to search yet';
  const k = ev.filter((e) => e.found.length).length;
  if (!n) return read === 1 ? 'Its fact sheet has no finding on these' : `None of the ${read} fact sheets has a finding on these`;
  return `Found ${n} finding${n === 1 ? '' : 's'} in ${read === 1 ? 'its fact sheet' : `${k} of ${read} fact sheets`}`;
}

// The Planner's read, for Sig's notes
export function plannerNote(plan: Plan): string {
  if (!plan.outcomes.length) return '';
  const asked = labels(plan, 'asked');
  const related = labels(plan, 'related');
  return plan.from === 'goal'
    ? `Planner: they named nothing measurable, so for ${GOAL_LABEL[plan.goal!]} the evidence looked for is on ${listOf(asked)}.`
    : `Planner: they asked about ${listOf(asked)}${related.length ? `; studies of ${asked.length === 1 ? 'it' : 'these'} also measure ${listOf(related)}` : ''}.`;
}
// What each sheet shows on exactly that, and plainly where a sheet shows nothing, with the next
// rung to go to
export function evidenceNote(ev: Evidence[], plan: Plan): string {
  const what = listOf(labels(plan), 'or');
  const main = labels(plan, 'asked')[0] ?? what;
  const lines = ev.map((e) => {
    if (e.sheet === 'unread') return `- ${e.name}: its fact sheet couldn't be loaded just now, so make no claims about its findings.`;
    if (e.sheet === 'none') return `- ${e.name}: no fact sheet yet, so nothing from the studies on ${what}; what people report leads for it, said as such.`;
    if (!e.found.length) return `- ${e.name}: its fact sheet has no finding on ${what}. Say that in a few words, then go down the ladder for it: what it was studied for and how that could bear on ${main} (expected from how it works, not tested), then what people report.`;
    return `- ${e.name}: ${e.found.map((f) => `[${f.outcome}, ${GRADE[f.evidence] ?? 'not graded'}] ${f.claim}`).join(' | ')}`;
  });
  const balance = ev.some((e) => e.found.length) ? '\nThe risks, US status and legal limits of the same compounds, from their fact sheets, get as much room as these findings.' : '';
  return `Evidence librarian, the findings on exactly that in the fact sheets, strongest first (give each one with who was studied, which it says: a finding in people with a condition, or in animals, isn't proof for them):\n${lines.join('\n')}${balance}`;
}
// For the final check (rule 9): the findings, one line each
export const evidenceLines = (ev: Evidence[]) => ev.flatMap((e) => e.found.map((f) => `${e.name}: ${f.claim} (evidence: ${f.evidence || 'not graded'})`));
