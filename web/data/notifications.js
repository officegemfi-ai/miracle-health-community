// Your notifications, and the check-in reminders that leave one when a report is due.
import { sb } from './client.js';

export const latest = (n) => sb.from('my_notifications').select('*').order('created_at', { ascending: false }).limit(n);
export const byId = (id) => sb.from('my_notifications').select('*').eq('id', id).limit(1);
export const unread = () => sb.from('my_notifications').select('id').is('read_at', null).limit(99);
export const markAllRead = () => sb.rpc('mark_notifications_read');
export const checkinReminders = () => sb.rpc('checkin_reminders');
