// Checks on a report: confirming or fixing Sig's read, check-ins 2, 6 and 12 weeks on, and
// check-in texts.
import { sb } from './client.js';

export const fixRead = (postId, args) => sb.rpc('fix_read', { post_id: postId, ...args });
export const sideEffectNames = () => sb.rpc('side_effect_names');
export const checkIn = (args) => sb.rpc('check_in', args);
// The check-in due now, the oldest report first
export const due = () => sb.from('my_checkins').select('*').order('created_at', { ascending: true }).limit(1);
export const texts = () => sb.rpc('my_checkin_texts');
export const setTexts = (on, tz) => sb.rpc('set_checkin_texts', { turn_on: on, tz });
