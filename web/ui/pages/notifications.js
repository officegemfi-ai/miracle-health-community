// Your notifications, all of them; opening the page marks them read.
import { h } from '../dom.js';
import { sig } from '../art.js';
import * as Notifications from '../../data/notifications.js';
import { S } from '../../app/store.js';
import { render } from '../shell.js';
import { fillRail } from '../rail.js';
import { notifRow, setUnread } from '../components/notifications.js';

export async function renderNotifications() {
  const list = h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Loading…'));
  render(h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, '// Your updates'), h('h1', {}, 'Notifications.'))), list);
  const rail = fillRail('default');
  const { data } = await Notifications.latest(60);
  list.replaceChildren(...((data || []).length ? data.map(notifRow) : [h('div', { class: 'empty' }, sig(72, 'sleepy'), h('p', {}, 'Nothing yet. Share how it went and I’ll tell you when people back you up.'))]));
  if (S.unread) { await Notifications.markAllRead(); setUnread(0); }
  await rail;
}
