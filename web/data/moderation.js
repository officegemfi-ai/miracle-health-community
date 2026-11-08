// Moderation: the queue and its actions, Signal alerts, reports held from the Signal, reactions
// that sound serious, beta numbers, the watch list, invites, and what members ask the library for.
import { sb } from './client.js';

export const queue = () => sb.from('mod_queue').select('*').order('waiting_since', { ascending: true });
export const moderate = (args) => sb.rpc('moderate', args);
export const openAlerts = () => sb.from('signal_alerts').select('*').eq('status', 'open').order('created_at', { ascending: false });
export const reviewAlert = (id) => sb.rpc('review_alert', { alert_id: id });
export const holds = () => sb.rpc('signal_holds');
export const seriousReads = () => sb.rpc('serious_reads');
export const clearHold = (postId) => sb.rpc('clear_signal_hold', { post_id: postId });
export const metrics = () => sb.rpc('beta_metrics');
export const watchTerms = () => sb.from('watch_terms').select('*').order('term');
export const addWatchTerm = (row) => sb.from('watch_terms').insert(row);
export const removeWatchTerm = (id) => sb.from('watch_terms').delete().eq('id', id);
export const invites = () => sb.from('invites').select('*').order('created_at', { ascending: false });
export const addInvite = (row) => sb.from('invites').insert(row);
export const libraryRequests = () => sb.from('library_requests').select('*').eq('status', 'open').order('created_at', { ascending: true });
export const addCompound = (args) => sb.rpc('add_compound', args);
export const dismissRequest = (id) => sb.rpc('dismiss_compound_request', { request_id: id });
