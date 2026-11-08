// Posts and their threads: the reasons a member can report something for, a title from a report's
// first sentence, the comment tree, and the spaces a post shows up in. Pure.

export const REASONS = [
  ['sourcing', 'Selling or sourcing (rule 1)'],
  ['dosing', 'Telling others what to take (rule 2)'],
  ['medical_misinfo', 'Dangerous medical claims (rule 3)'],
  ['harassment', 'Harassment or hate (rule 4)'],
  ['personal_info', 'Private information (rule 5)'],
  ['spam', 'Spam or self-promotion (rule 6)'],
  ['off_topic', 'Off topic: not in the library (rule 7)'],
  ['underage', 'Someone under 18 (rule 8)'],
  ['self_harm', 'Someone may be at risk (rule 10)'],
  ['other', 'Something else'],
];

// A title from the report's first sentence, when none was given (a title is 5 to 140 characters,
// so a very short first sentence gives way to a plain one)
export function titleFrom(text, kind = 'experience') {
  const first = String(text).trim().split(/(?<=[.!?])\s+|\n+/)[0] || '';
  const t = first.length > 120 ? `${first.slice(0, 117).replace(/\s+\S*$/, '')}…` : first;
  return t.length >= 5 ? t : kind === 'question' ? 'A question' : 'How it went';
}

// Comments as a tree, each level sorted: best (score, then oldest) or newest first
export function buildTree(rows, sort) {
  const byId = new Map(rows.map((c) => [c.id, { ...c, kids: [] }]));
  const roots = [];
  byId.forEach((c) => {
    const parent = c.parent_id && byId.get(c.parent_id);
    if (parent) parent.kids.push(c); else roots.push(c);
  });
  const cmp = sort === 'new' ? (a, b) => new Date(b.created_at) - new Date(a.created_at) : (a, b) => (b.score - a.score) || (new Date(a.created_at) - new Date(b.created_at));
  const order = (list) => { list.sort(cmp); list.forEach((c) => order(c.kids)); return list; };
  return order(roots);
}

// A comment and every reply under it
export const countAll = (c) => 1 + c.kids.reduce((n, k) => n + countAll(k), 0);

// The spaces a post shows up in: each part of a stack or blend, or its own
export const partsOf = (row) => (row.part_ids?.length ? row.part_ids : [row.compound_id]);
