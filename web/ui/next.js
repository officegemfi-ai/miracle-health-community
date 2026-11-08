// Where someone was going when they had to sign in first (a space from the Library, a draft from
// their Miracle Plan): they land there once they're in, not on Home
import { worthReturningTo, validReturn } from '../core/routes.js';
import { saveNext, takeNext as takeSaved } from '../data/storage.js';

export function rememberNext() {
  const want = location.hash;
  if (worthReturningTo(want)) saveNext(want);
}
export const takeNext = () => validReturn(takeSaved());
