// The library's rules: its families and categories, finding an entry from what someone types (by
// name, brand name or nickname), and stacks (several compounds taken together) and blends. Pure:
// each function is given the list of spaces it works on.

export const FAMILIES = ['Peptides', 'Hormones', 'Supplements', 'Medications', 'Blends', 'Stacks'];

export const CATEGORIES = [
  'Metabolic & weight', 'Growth-hormone axis', 'Healing & recovery', 'Gut & digestion', 'Immune & inflammation',
  'Cognition & focus', 'Mood & stress', 'Sleep', 'Sexual health', 'Skin & hair', 'Longevity', 'Hormone balance',
  'Muscle & performance', 'Heart & circulation', 'Energy & mitochondria', 'Vitamins & minerals', 'Liver & detox', 'Joints & bones',
];
export const MAX_PICKS = 8;

const find = (spaces, cid) => spaces.find((s) => s.compound_id === cid) || null;

const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const squash = (s) => fold(s).replace(/[^a-z0-9]/g, '');
const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

// How well one entry matches what was typed: the name beats an alias, a whole
// match beats a start, a start beats a word inside, and that beats anything else.
function matchOf(sp, q) {
  const qs = squash(q);
  if (!qs) return null;
  let best = null;
  const tryText = (text, isName) => {
    const t = squash(text);
    if (!t) return;
    let s = 0;
    if (t === qs) s = 100;
    else if (t.startsWith(qs)) s = 80;
    else if (words(text).some((w) => w.startsWith(qs))) s = 60;
    else if (qs.length >= 3 && t.includes(qs)) s = 40;
    if (!s) return;
    if (!isName) s -= 8;
    if (!best || s > best.score) best = { score: s, via: isName ? null : text };
  };
  tryText(sp.name, true);
  (sp.aliases || []).forEach((a) => tryText(a, false));
  if (!best && qs.length >= 3 && squash(sp.category).includes(qs)) best = { score: 10, via: null };
  return best;
}

const activity = (sp) => (Number(sp.reports) || 0) * 3 + (Number(sp.members_count) || 0) + (Number(sp.posts_week) || 0);

// Entries matching q, best first. kinds: which of compound, blend, stack to include.
export function searchLibrary(spaces, q, { kinds = ['compound', 'blend'], limit = 12, family = '' } = {}) {
  const out = [];
  for (const sp of spaces) {
    if (!kinds.includes(sp.kind || 'compound')) continue;
    if (family && sp.family !== family) continue;
    const m = matchOf(sp, q);
    if (m) out.push({ sp, ...m });
  }
  out.sort((a, b) => (b.score - a.score) || (activity(b.sp) - activity(a.sp)) || a.sp.name.localeCompare(b.sp.name));
  return limit ? out.slice(0, limit) : out;
}

export function popularEntries(spaces, n = 8) {
  return spaces.filter((s) => s.kind !== 'stack')
    .sort((a, b) => (activity(b) - activity(a)) || ((b.score ?? -1) - (a.score ?? -1)) || a.name.localeCompare(b.name))
    .slice(0, n);
}

export const isStack = (sp) => sp?.kind === 'stack';
export const familyLabel = (sp) => (sp?.kind === 'stack' ? 'Stack' : sp?.kind === 'blend' ? 'Blend' : (sp?.family || '').replace(/s$/, ''));
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// The name the database gives a stack: its compounds' names, A to Z, joined with " + "
export function stackName(spaces, ids) {
  return ids.map((id) => find(spaces, id)?.name || id).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join(' + ');
}

export function findStack(spaces, ids) {
  const want = [...new Set(ids)];
  return spaces.find((s) => isStack(s) && sameSet(s.part_ids || [], want)) || null;
}

// What's in an entry, with any blend inside a stack opened up
export function allParts(spaces, sp) {
  const out = new Set();
  (sp?.part_ids || []).forEach((id) => {
    out.add(id);
    (find(spaces, id)?.part_ids || []).forEach((x) => out.add(x));
  });
  return out;
}

// Blends and stacks that contain every one of ids (not counting the exact stack)
export function containing(spaces, ids) {
  return spaces.filter((s) => (s.kind === 'blend' || isStack(s)) && !ids.includes(s.compound_id))
    .filter((s) => { const parts = allParts(spaces, s); return ids.every((i) => parts.has(i)); })
    .filter((s) => !(isStack(s) && sameSet(s.part_ids || [], ids)))
    .sort((a, b) => (activity(b) - activity(a)) || ((b.score ?? -1) - (a.score ?? -1)));
}

// Which compounds a link like #/new?c=... or #/stack?c=... means
export function idsFrom(spaces, param) {
  const ids = String(param || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (ids.length === 1 && isStack(find(spaces, ids[0]))) return [...(find(spaces, ids[0]).part_ids || [])];
  return [...new Set(ids)].filter((id) => find(spaces, id) && !isStack(find(spaces, id))).slice(0, MAX_PICKS);
}
