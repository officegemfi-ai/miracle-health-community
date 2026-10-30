// Plain checks on what Miracle AI writes. The Safety agent reads every part of a reply before
// it's shown (agents.ts, the gate); these run as well, on everything that goes out:
//   - amounts in dosing units are always taken out, whatever the agent said, since Miracle
//     Health gives no doses (body-weight changes like "lost 8.4 kg" and lab units like
//     mg/dL stay);
//   - supplement-extract brand names, outside links and sales talk are taken out.
// They also give the Safety agent hints, and catch signs of crisis or of a minor in the
// member's words in case the Safety agent's first read can't run.

// Dosing units, grams aside (grams are also how food protein is counted, so they're matched
// on their own below)
const OTHER_UNIT = String.raw`(?:mcg|µg|μg|ug|mg|milligrams?|micrograms?|microgramos?|miligramos?|iu|ui|i\.u\.|units?|unidades|ml|mL|cc|ccs|milliliters?|millilitres?|drops?|capsules?|caps|tablets?|pills?|scoops?|sprays?|clicks?|ticks?|pumps?|vials?)`;
const NUM = String.raw`\d+(?:[.,]\d+)*(?:\s?(?:-|–|to|a)\s?\d+(?:[.,]\d+)*)?`;
// Food protein is a foundation target, not a dose: "about 1 g of protein per pound of lean body
// mass", "80 to 120 grams of protein a day", "1.2 g/kg of protein"
// ("g per pound of lean body mass" is only ever a protein target)
const PROTEIN = String.raw`(?:(?:\s?(?:\/|per)\s?(?:kg|lb|pound|day|d))?\s*(?:of\s+)?(?:[a-z-]+\s+){0,2}protein\b(?!\s*(?:fragments?|kinases?|chains?|sequences?|peptides?|analogs?))`
  + String.raw`|\s*(?:\/|per|a|an)\s*(?:pound|lb|kg|kilogram)s?\s+(?:of\s+)?(?:your\s+)?(?:lean|goal|ideal|target)\b)`;
// "250 mcg", "2.5mg", "1,000 IU", "5-10 g", "0.25 mg/kg", "1.6 g per kg"; not "160 mg/dL" or
// "30 g of protein"
export const DOSE = new RegExp(String.raw`(?<![\w.])${NUM}\s?(?:(?:grams?|gramos?|g)(?![a-z])(?!${PROTEIN})|${OTHER_UNIT})(?:\s?(?:\/|per)\s?(?:kg|lb|pound|day|d|week|wk|dose|injection))?(?!\s*\/\s*d?l\b)(?![\w])`, 'gi');
// The amount in a food-protein target, which DOSE leaves alone: "0.7 to 1 g" of protein per pound
// of lean body mass, "80 to 120 g" of protein a day
export const FOOD_PROTEIN = new RegExp(String.raw`(?<![\w.])${NUM}\s?(?:grams?|gramos?|g)(?![a-z])(?=${PROTEIN})`, 'gi');
// The Safety agent's check sees those amounts as markers (⟨protein target A⟩), so it can't take a
// foundation target for a dose and judges the rest of the part as usual; they go back after
export function maskTargets(text: string): { text: string; targets: string[] } {
  const targets: string[] = [];
  const out = String(text ?? '').replace(FOOD_PROTEIN, (m) => {
    if (targets.length >= 26) return m;
    targets.push(m);
    return `⟨protein target ${String.fromCharCode(64 + targets.length)}⟩`;
  });
  return { text: out, targets };
}
export function unmaskTargets(text: string, targets: string[]): string {
  return String(text ?? '').replace(/⟨protein target ([A-Z])⟩/g, (_, k: string) => targets[k.charCodeAt(0) - 65] ?? '');
}
// "two hundred fifty micrograms", "half a milligram"
export const DOSE_WORDS = /\b(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|thousand|half|quarter|couple of|few)[\s-]+)+(?:an?\s+|of\s+an?\s+)?(?:micrograms?|milligrams?|mcg|mg|units?|milliliters?|ml|cc|iu|capsules?|tablets?|drops?|scoops?|clicks?|ticks?)\b/gi;
// "twice a day", "once weekly", "2x/day", "every other day", "5 days on, 2 off"
export const SCHEDULE = new RegExp(String.raw`\b(?:once|twice|three times|\d+\s?x)\s+(?:a|per|each)\s+(?:day|week|night|morning)\b|\b\d+\s?x\s?\/\s?(?:day|d|week|wk)\b|\bevery\s+(?:other\s+)?(?:day|night|morning|\d+\s+(?:hours|days))\b|\b\d+\s+(?:days?|weeks?)\s+on\b`, 'gi');
// Links to anywhere but our own sites
export const LINK = /\bhttps?:\/\/(?!(?:www\.)?miraclehealth\.us\b|community\.miraclehealth\.us\b)[^\s)\]]+/gi;
export const SALES = /\b(?:discount|coupon|promo|affiliate)\s+codes?\b|\buse\s+code\b|\b(?:buy|order|get)\s+(?:it|them|some)\s+(?:from|at|on)\b|\bresearch[- ]chemical\s+(?:sites?|vendors?|shops?|stores?|suppliers?)\b/gi;
// Supplement-extract brands the Library never prints (the same list as the site's library build)
export const BRANDS = /\b(?:KSM-?66|Sensoril|Bacognize|Synapsa|GlucoVantage|CarnoSyn|5-?Loxin|Rejuvant|Cognizin|Meriva|Longvida|BCM-?95|LMNT|Liquid\s?I\.?V\.?|Testofen|PharmaGABA|Iodoral|Suntheanine|Magtein|Relora|Ovasitol|Tru\s?Niagen|Niagen|Levagen|Kyolic|Florastor|Affron|PrimaVie|SpermidineLIFE|Avmacol|TeaCrine|LJ100|Mitopure|Pepzingi)\b/gi;

export type Hit = { kind: 'dose' | 'schedule' | 'link' | 'sales' | 'brand'; text: string };

export function scan(text: string): Hit[] {
  const hits: Hit[] = [];
  const add = (kind: Hit['kind'], re: RegExp) => {
    for (const m of String(text ?? '').matchAll(re)) hits.push({ kind, text: m[0] });
  };
  add('dose', DOSE);
  add('dose', DOSE_WORDS);
  add('schedule', SCHEDULE);
  add('link', LINK);
  add('sales', SALES);
  add('brand', BRANDS);
  return hits;
}

// Always, on everything that goes out: amounts, brands, outside links and sales talk go
export function strict(text: string): string {
  return String(text ?? '')
    .replace(DOSE, '[amount removed]')
    .replace(DOSE_WORDS, '[amount removed]')
    .replace(LINK, '[link removed]')
    .replace(SALES, '[removed]')
    .replace(BRANDS, 'a branded extract');
}
// And schedules too, where there is no Safety agent to judge them
export function redact(text: string): string {
  return strict(text).replace(SCHEDULE, '[schedule removed]');
}

// Words for a card field: no amounts, no schedules, no outside links, no markup, kept short.
// A foundation step ("strength train 3 times a week") keeps its schedule.
export function cleanField(s: unknown, max: number, foundation = false): string {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/<[^>]*>/g, ' ').replace(/[<>`]/g, '').replace(/\s+/g, ' ').trim();
  const r = (foundation ? strict(t) : redact(t)).replace(/\[(?:amount|schedule|link) removed\]|\[removed\]/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  return r.length > max ? r.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : r;
}

// Signs that someone may be in crisis, as a backstop to the Safety agent (which reads slang,
// indirect wording and other languages too)
export const CRISIS = /\b(?:kill(?:ing)?\s+my\s?self|kms|suicid\w*|end(?:ing)?\s+my\s+(?:own\s+)?life|end(?:ing)?\s+it\s+all|want(?:ing)?\s+to\s+die|wish\s+i\s+(?:was|were)\s+dead|better\s+off\s+dead|no\s+reason\s+to\s+live|don'?t\s+want\s+to\s+(?:live|be\s+alive|wake\s+up|be\s+here)|(?:never|not)\s+wake\s+up|self[- ]?harm\w*|cut(?:ting)?\s+myself|overdos(?:e|ing)\s+on\s+purpose|(?:me\s+)?quiero\s+morir|suicidarme|matarme)\b/i;
// Someone who injects something themselves ("I inject BPC", "pinning TB-500", "sub-q"), as a
// backstop when the Safety agent can't read the message
export const INJECTS = /\b(?:inject(?:s|ed|ing|ion|ions|able|ables)?|pinning|sub-?q|subcutaneous(?:ly)?|intramuscular(?:ly)?|syringes?|insulin\s+needles?)\b/i;
export const URGENT = /\b(?:chest pain|can'?t breathe|cannot breathe|trouble breathing|short(?:ness)? of breath|face (?:is )?drooping|slurred speech|passed out|fainted|seizure|anaphyla\w*|throat (?:is )?(?:closing|swelling)|overdos(?:e|ed)|took (?:way )?too much|can'?t stop (?:vomiting|throwing up))\b/i;
// "I'm 16", "I'm 15 years old", "I'm in high school" (not "I'm 15 years into lifting", "I'm 15
// minutes from the gym" or "my son is in high school"). Used only when the Safety agent can't read
// the message; otherwise whether someone is under 18 is its call.
export const MINOR = /\b(?:i'?m|i\s+am|im)\s+(?:only\s+|just\s+)?(?:1[0-7])\b(?!\s*(?:%|percent|kg|kilos?|lbs?|pounds?|weeks?|days?|months?|years?(?!\s*old)|hours?|minutes?|mins?|seconds?|miles?|km|kilometers?|sessions?|cm|inches|in\b|ft|feet|mg|mcg|g\b|stone|reps?|sets?|laps?|runs?|times?|percent|out\b|into\b|away\b|from\b|weeks?|wks?))|\b(?:i'?m|i\s+am|im)\s+(?:1[0-7])\s*(?:yo|y\/o|years?\s*old|yrs?\s*old)\b|\b(?:i'?m|i\s+am|im)\s+(?:in|at)\s+(?:middle|high)\s+school\b|\b(?:i'?m|i\s+am|im)\s+in\s+(?:9th|10th|11th|12th)\s+grade\b|\bmy\s+(?:mom|dad|parents?)\s+(?:won'?t|don'?t|wont|dont)\s+let\s+me\b|\?\s*under\s+18\b/i;
// "I'm pregnant", "I'm 12 weeks pregnant", "trying to conceive", "I'm breastfeeding"
export const PREGNANT = /\b(?:i'?m|i\s+am|im)\s+(?:\d+\s+(?:weeks?|months?)\s+)?pregnant\b|\b(?:we'?re|i'?m|i\s+am|we\s+are)\s+trying\s+to\s+(?:conceive|get\s+pregnant)\b|\b(?:i'?m|i\s+am|im)\s+(?:currently\s+)?(?:breast-?feeding|nursing)\b|\bwe'?re\s+(?:pregnant|expecting)\b/i;
