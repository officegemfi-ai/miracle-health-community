// Plain checks on what Miracle AI writes, before and alongside the Safety agent's final read:
// amounts with units (a dose by another name), links that aren't ours and sales talk.
// They never decide alone whether a reply is fine; they tell the final check where to look,
// and if that check can't run, they cut the matching words out.

const UNIT = String.raw`(?:mcg|µg|μg|ug|mg|g|grams?|milligrams?|micrograms?|kg|iu|i\.u\.|units?|ml|mL|cc|ccs|drops?|capsules?|caps|tablets?|pills?|scoops?|sprays?|clicks?|pumps?)`;
const NUM = String.raw`\d+(?:[.,]\d+)?(?:\s?(?:-|–|to)\s?\d+(?:[.,]\d+)?)?`;
// "250 mcg", "2.5mg", "1,000 IU", "5-10 g", "0.25 mg/kg"
export const DOSE = new RegExp(String.raw`(?<![\w.])${NUM}\s?${UNIT}(?:\s?\/\s?(?:kg|day|d|week|wk|dose))?(?![\w])`, 'gi');
// "twice a day", "once weekly", "every other day", "5 days on, 2 off"
export const SCHEDULE = new RegExp(String.raw`\b(?:once|twice|three times|\d+\s?x)\s+(?:a|per|each)\s+(?:day|week|night|morning)\b|\bevery\s+(?:other\s+)?(?:day|night|morning|\d+\s+(?:hours|days))\b|\b\d+\s+(?:days?|weeks?)\s+on\b`, 'gi');
// Links to anywhere but our own sites
export const LINK = /\bhttps?:\/\/(?!(?:www\.)?miraclehealth\.us\b|community\.miraclehealth\.us\b)[^\s)\]]+/gi;
export const SALES = /\b(?:discount|coupon|promo|affiliate)\s+codes?\b|\buse\s+code\b|\b(?:buy|order|get)\s+(?:it|them|some)\s+(?:from|at|on)\b|\bresearch[- ]chemical\s+(?:sites?|vendors?|shops?|stores?|suppliers?)\b/gi;

export type Hit = { kind: 'dose' | 'schedule' | 'link' | 'sales'; text: string };

export function scan(text: string): Hit[] {
  const hits: Hit[] = [];
  const add = (kind: Hit['kind'], re: RegExp) => {
    for (const m of String(text ?? '').matchAll(re)) hits.push({ kind, text: m[0] });
  };
  add('dose', DOSE);
  add('schedule', SCHEDULE);
  add('link', LINK);
  add('sales', SALES);
  return hits;
}

// Last resort when the final check can't run: take out what the plain checks found
export function redact(text: string): string {
  return String(text ?? '')
    .replace(DOSE, '[amount removed]')
    .replace(SCHEDULE, '[schedule removed]')
    .replace(LINK, '[link removed]')
    .replace(SALES, '[removed]');
}

// Words for a card field: no amounts, no schedules, no outside links, no markup, kept short
export function cleanField(s: unknown, max: number): string {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/<[^>]*>/g, ' ').replace(/[<>`]/g, '').replace(/\s+/g, ' ').trim();
  const r = redact(t).replace(/\[(?:amount|schedule|link) removed\]|\[removed\]/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  return r.length > max ? r.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : r;
}

// Signs that someone may be in crisis, as a backstop to the Safety agent
export const CRISIS = /\b(?:kill(?:ing)?\s+my\s?self|suicid\w*|end(?:ing)?\s+my\s+(?:own\s+)?life|end(?:ing)?\s+it\s+all|want(?:ing)?\s+to\s+die|don'?t\s+want\s+to\s+(?:live|be\s+alive|wake\s+up)|self[- ]?harm\w*|cut(?:ting)?\s+myself|overdos(?:e|ing)\s+on\s+purpose)\b/i;
export const URGENT = /\b(?:chest pain|can'?t breathe|cannot breathe|trouble breathing|short(?:ness)? of breath|face (?:is )?drooping|slurred speech|passed out|fainted|seizure|anaphyla\w*|throat (?:is )?(?:closing|swelling)|overdos(?:e|ed))\b/i;
