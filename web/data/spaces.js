// Spaces (one per compound, blend and stack) and joining them.
import { sb } from './client.js';
import { allRows } from './rows.js';

// Over 300 spaces: two pages, asked for together
export const all = () => allRows(() => sb.from('spaces').select('*').order('name').order('compound_id'), 20000, 2);
export const join = (cid) => sb.from('space_members').insert({ compound_id: cid });
export const leave = (cid) => sb.from('space_members').delete().eq('compound_id', cid);
