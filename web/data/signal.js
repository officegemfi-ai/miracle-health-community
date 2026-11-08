// The Community Signal: the board, its versions over time, the latest moves, and the community's
// pulse (the season, the share from members, today's moves).
import { sb } from './client.js';
import { allRows } from './rows.js';

export const board = () => allRows(() => sb.from('signal_board').select('*').order('score', { ascending: false, nullsFirst: false }).order('compound_id'));
// One Signal's latest 60 versions, newest first
export const recentVersions = (cid) => sb.from('signal_history').select('compound_id,version,score').eq('compound_id', cid)
  .order('version', { ascending: false }).limit(60);
// Every Signal's versions, oldest first
export const allVersions = () => allRows(() => sb.from('signal_history').select('compound_id,version,score')
  .order('version', { ascending: true }).order('compound_id'), 4000);
export const moves = (n) => sb.from('signal_moves').select('*').order('computed_at', { ascending: false }).limit(n);
export const pulse = () => sb.from('community_pulse').select('*').limit(1);
