// Your account: who you are here, signing out, check-in texts, and deleting everything.
import { h, icon, msgBox, say } from '../dom.js';
import { sig, emblem } from '../art.js';
import { fmtN } from '../../core/format.js';
import * as Auth from '../../data/auth.js';
import { C } from '../../data/config.js';
import { track } from '../../data/telemetry.js';
import { S, levelOf } from '../../app/store.js';
import { signOut } from '../../app/session.js';
import { render, setRail } from '../shell.js';
import { textsChoice } from '../components/checks.js';

export function renderAccount() {
  const msg = msgBox();
  const confirmBox = h('input', { class: 'input', id: 'confirm-delete', autocomplete: 'off', placeholder: 'Type DELETE' });
  const del = h('button', { class: 'btn danger', type: 'submit' }, 'Delete my account');
  const lv = levelOf(S.card?.level || 1);
  const texts = textsChoice();
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, 'Settings'), h('h1', {}, 'Account.'))),
    h('section', { class: 'card row nw' },
      emblem(S.card?.level || 1, 56, false, lv.name),
      h('div', { class: 'grow' }, h('b', {}, `u/${S.me.handle}`), S.me.role !== 'member' ? h('span', { class: 'chip ink' }, S.me.role) : null,
        h('div', { class: 'small muted' }, `${lv.name} · ${fmtN(S.card?.points || 0)} Signal points · member since ${new Date(S.me.created_at).toLocaleDateString()}`)),
      h('button', {
        class: 'btn', type: 'button',
        onclick: async () => { await signOut(); location.hash = '#/'; location.reload(); },
      }, icon('logout', 16), 'Sign out')),
    S.me.status === 'suspended' ? h('div', { class: 'msg note' }, `Paused until ${new Date(S.me.suspended_until).toLocaleString()}`) : null,
    texts ? h('h2', {}, 'Check-in texts') : null,
    texts ? h('section', { class: 'card' }, texts) : null,
    h('h2', {}, 'Delete your account'),
    h('section', { class: 'card' },
      h('p', { class: 'small' }, 'This deletes your profile, every post and comment you wrote, your votes, your stickers and your points, right away. Reports you filed stay, without your name. It can’t be undone.'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          if (confirmBox.value.trim() !== 'DELETE') return say(msg, 'Type DELETE to confirm.');
          del.disabled = true;
          const { error } = await Auth.deleteAccount();
          del.disabled = false;
          if (error) return say(msg, 'Something went wrong; nothing was deleted. Try again, or contact the moderators.');
          track('account_deleted');
          await signOut();
          document.body.classList.add('auth');
          render(h('section', { class: 'gate' }, h('div', { class: 'inner' }, sig(96, 'support'), h('h1', {}, 'Your account is deleted'), h('p', { class: 'lede' }, 'Everything you wrote is gone. Thanks for being part of it.'))));
        },
      }, h('label', { class: 'f', for: 'confirm-delete' }, h('span', {}, 'Type DELETE to confirm'), confirmBox), del, msg)),
    C.contactEmail ? h('p', { class: 'small muted mt16' }, 'Questions? ', h('a', { href: `mailto:${C.contactEmail}` }, C.contactEmail)) : null);
  setRail([]);
}
