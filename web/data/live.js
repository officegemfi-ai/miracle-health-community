// Live updates from the database: one channel for the whole app. Each change it hears is handed to
// emit(topic, row): a new Signal version, one of your notifications, a new post.
import { sb } from './client.js';

let channel = null;
export function openLive(userId, emit) {
  if (channel || !sb?.channel) return;
  channel = sb.channel('community-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signal_snapshots' }, (p) => emit('signal', p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'signal_snapshots' }, (p) => emit('signal', p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) => emit('notification', p.new))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (p) => emit('post', p.new))
    .subscribe();
}
export function closeLive() {
  if (channel && sb?.removeChannel) sb.removeChannel(channel);
  channel = null;
}
