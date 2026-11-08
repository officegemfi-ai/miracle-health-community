// Notifications: what each one says and where it leads, the bell with its count, and the bell's
// pop-up list.
import { h, icon } from '../dom.js';
import { sig, emblem } from '../art.js';
import { fmt1, ago } from '../../core/format.js';
import { OUTCOME } from '../../core/signal.js';
import { MOD_TEXT } from '../../core/notifications.js';
import * as Notifications from '../../data/notifications.js';
import { S, setUnreadCount } from '../../app/store.js';

export function notifParts(n) {
  const d = n.data || {};
  const who = n.actor_handle ? `u/${n.actor_handle}` : 'Someone';
  switch (n.kind) {
    case 'welcome': return [sig(34, 'happy'), 'Welcome to Miracle Health. I’m Sig, the Community Signal in person, and Miracle Health’s AI: I read every report into the Signal. Join a few spaces and share how it went.', null, '#/explore'];
    case 'comment': return [icon('comment', 18), `${who} commented on your post`, n.comment_body || n.post_title, `#/post/${n.post_id}`];
    case 'reply': return [icon('comment', 18), `${who} replied to you`, n.comment_body, `#/post/${n.post_id}`];
    case 'same_for_me': {
      const c = Number(d.count || 1);
      return [sig(34, 'support'), c > 1 ? `${c} people said “same for me” on your report` : 'Someone said “same for me” on your report', n.post_title, `#/post/${n.post_id}`];
    }
    case 'counted': {
      const out = OUTCOME[d.outcome]?.[0] || 'counted';
      const moved = d.from != null && d.to != null && Number(d.from) !== Number(d.to);
      return [sig(34, 'cheer'), moved
        ? `Sig read your report: ${out}. It moved the ${n.compound_name} Signal ${fmt1(d.from)} → ${fmt1(d.to)}.`
        : `Sig read your report: ${out}. It now feeds the ${n.compound_name} Signal.`, n.post_title, `#/post/${n.post_id}`];
    }
    case 'milestone': return [icon('up', 18), `Your post reached ${d.score} helpful votes`, n.post_title, `#/post/${n.post_id}`];
    case 'level_up': return [emblem(d.level, 34), `You reached ${d.name}. Level ${d.level} of 15, ${d.tier} tier.`, null, `#/u/${encodeURIComponent(S.me?.handle || '')}`];
    case 'badge': return [h('span', { class: 'seal' }, icon('check', 18)), `New badge: ${d.name}`, d.description, `#/u/${encodeURIComponent(S.me?.handle || '')}`];
    case 'mod': return [icon('shield', 18), (MOD_TEXT[d.action] || (() => 'A note from the moderators'))(d), n.post_title, n.post_id ? `#/post/${n.post_id}` : '#/rules'];
    case 'library': return [sig(34, 'happy'), `${d.name || n.compound_name} is in the library now, as you suggested. Thanks for building it out.`, null, n.compound_id ? `#/s/${encodeURIComponent(n.compound_id)}` : '#/explore'];
    case 'checkin': return [sig(34, 'curious'), `How is it now? Your ${n.compound_name} report, ${d.week} weeks on. Two taps to update it.`, n.post_title, `#/post/${n.post_id}`];
    case 'safety': return [icon('shield', 18), `Your ${n.comment_id ? 'comment' : 'post'} describes a reaction that sounds serious. If it’s still happening, get medical help (in an emergency, call 911), and you can tell the FDA through MedWatch.`, n.post_title, n.comment_id ? `#/post/${n.post_id}` : `#/post/${n.post_id}`];
    default: return [icon('bell', 18), 'Something new', null, '#/notifications'];
  }
}

export function notifRow(n) {
  const [art, text, quote, href] = notifParts(n);
  return h('a', { class: `notif ${n.read_at ? '' : 'unread'}`, href: href || '#/notifications' },
    h('span', { class: 'ico' }, art), h('span', {}, h('span', { class: 't' }, text), quote ? h('span', { class: 'q' }, quote) : null),
    h('span', { class: 'when' }, ago(n.created_at)));
}

let bellCount = null;
export function setUnread(n) {
  setUnreadCount(n);
  if (bellCount) { bellCount.textContent = n > 9 ? '9+' : String(n); bellCount.classList.toggle('hide', !n); }
}

export function bellButton() {
  bellCount = h('span', { class: `count ${S.unread ? '' : 'hide'}` }, S.unread > 9 ? '9+' : String(S.unread));
  const wrap = h('div', { class: 'row nw', style: null });
  wrap.style.position = 'relative';
  const btn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Notifications', 'aria-haspopup': 'true', id: 'bell' }, icon('bell', 22), bellCount);
  let pop = null;
  const close = () => { pop?.remove(); pop = null; document.removeEventListener('click', outside, true); };
  const outside = (e) => { if (pop && !wrap.contains(e.target)) close(); };
  btn.addEventListener('click', async () => {
    if (pop) return close();
    if (window.innerWidth < 760) { location.hash = '#/notifications'; return; }
    pop = h('div', { class: 'notif-pop', role: 'dialog', 'aria-label': 'Notifications' }, h('p', { class: 'xs muted pad' }, 'Loading…'));
    wrap.append(pop);
    document.addEventListener('click', outside, true);
    const { data } = await Notifications.latest(12);
    if (!pop) return;
    pop.replaceChildren(
      h('div', { class: 'card-h pad', style: null }, h('span', { class: 'kick' }, 'Notifications'), h('a', { href: '#/notifications', onclick: close }, 'See all')),
      ...((data || []).length ? data.map(notifRow) : [h('div', { class: 'empty' }, sig(56, 'sleepy'), h('p', {}, 'Nothing yet.'))]));
    pop.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
    if (S.unread) { await Notifications.markAllRead(); setUnread(0); }
  });
  wrap.append(btn);
  return wrap;
}
