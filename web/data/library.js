// The Library at miraclehealth.us: each compound's evidence grade, its index, and asking for
// something it's missing.
import { sb } from './client.js';
import { SITE } from '../kit/kit.js';
import { bodyLoader } from '../kit/bodymap.js';

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

// How each compound works in the body, from its fact sheet (the kit's body map): the map's index
// once, then each compound's own lines once, all from the Library
const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${url}`))));
export const body = bodyLoader(getJson, `${SITE}/library/data/body`);

export const request = (name, note) => sb.from('compound_requests').insert({ name, note });
