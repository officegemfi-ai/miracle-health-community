// The Library at miraclehealth.us: each compound's evidence grade, its index, and asking for
// something it's missing.
import { sb } from './client.js';
import { SITE } from '../kit/kit.js';

// The Library's index: every compound and blend, with its name and grade; null when it can't be read
export const index = () => fetch(`${SITE}/library/data/index.json`).then((r) => (r.ok ? r.json() : null));

// How strong the evidence is for a compound, from the Library's grades (one file for every
// compound, fetched once; nothing says which space you're on)
let gradesP = null;
export function gradeOf(cid) {
  gradesP ||= fetch(`${SITE}/library/data/index.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((x) => new Map((x?.items || []).filter((it) => it.grade).map((it) => [it.id, it.grade])))
    .catch(() => new Map());
  return gradesP.then((m) => m.get(cid) || '');
}

export const request = (name, note) => sb.from('compound_requests').insert({ name, note });
