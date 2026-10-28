// Rules, how it works, and your account.
import { h, icon, friendly, msgBox, say, fmtN } from './ui.js';
import { sig, emblem } from './art.js';
import { S, C, sb, levelOf, track, stopLive } from './state.js';
import { render, setRail, railCards } from './shell.js';
import { LEVELS } from './signalviz.js';
import { seal } from './signal.js';

export function renderRules(standalone = false) {
  const R = S.rules;
  if (!R) { render(h('p', { class: 'pad' }, 'The rules couldn’t load. Refresh to try again.')); return; }
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, `// Version ${R.version}`), h('h1', {}, 'Community rules.'))),
    h('section', { class: 'card' },
      h('p', {}, R.intro),
      ...R.rules.map((r) => h('div', { class: 'rule' },
        h('b', {}, `${r.n}. ${r.title}`), h('div', {}, r.text),
        (r.ok || r.not_ok) ? h('div', { class: 'ex' },
          r.ok ? h('span', {}, `Fine: “${r.ok}”`) : null,
          r.not_ok ? h('span', {}, `Not fine: “${r.not_ok}”`) : null) : null)),
      h('h2', {}, 'What happens when a rule is broken'),
      h('ul', {}, R.enforcement.map((t) => h('li', {}, t)))),
    standalone ? h('p', { class: 'pad' }, h('a', { class: 'btn', href: '#/' }, '← Back')) : null);
  if (!standalone) railCards('default').then(setRail);
}

export async function renderHow() {
  const lv = S.levels;
  render(
    h('section', { class: 'hero' },
      h('div', { class: 'kick' }, '// How it works'),
      h('h1', {}, 'Built by the people who take it.'),
      h('p', { class: 'lede' }, 'Members share what happened when they took something: what for, how long, and whether things were better, the same or worse than before. Miracle AI reads each report into the Community Signal, one number per compound. The more people share, the more accurate it gets.')),
    h('h2', {}, 'The Community Signal'),
    h('section', { class: 'card' },
      h('p', {}, 'Each compound gets a number from 0 to 100:'),
      h('div', { class: 'ledger' },
        h('div', {}, h('span', {}, 'Reported efficacy: how often people report things got better'), h('b', {}, '65%')),
        h('div', {}, h('span', {}, 'Consistency: how much the reports agree'), h('b', {}, '15%')),
        h('div', {}, h('span', {}, 'Diversity: how many independent voices there are'), h('b', {}, '10%')),
        h('div', {}, h('span', {}, 'Confidence: how much there is to go on'), h('b', {}, '10%'))),
      h('p', { class: 'small muted mt12' }, 'It starts from what people say on public forums, and moves toward this community’s own first-hand reports as they add up. New accounts count half, so a wave of fresh accounts can’t push a number around. Every change is kept as a new version, and the math runs in the database, never in this page.')),
    h('h2', {}, 'Certification'),
    h('section', { class: 'card' },
      h('p', {}, `Public forums count as ${S.pulse?.external_weight ?? 50} reports for each compound. As members’ first-hand reports add up, each Signal earns a level:`),
      h('div', { class: 'ledger levels' }, LEVELS.map((l) => h('div', {}, h('span', { class: 'row nw' }, seal(l.key, 26, true), h('span', {}, h('strong', {}, l.name), ` · ${l.rule}`))))),
      h('p', { class: 'small muted mt12' }, 'Each space also shows how first-hand reports split (better, about the same or worse), with a 95% interval for “better” so you can see how sure that share is, and the side effects members mention.')),
    h('h2', {}, 'Miracle AI’s read'),
    h('section', { class: 'card row nw' }, sig(64, 'watching'),
      h('p', {}, 'When you post an experience, Miracle AI reads it: is it first-hand, did it go better, the same or worse, for how long, any side effects. That read feeds the Signal. You can confirm or correct it on your post, and your word wins.')),
    h('h2', {}, 'Signal points and emblems'),
    h('section', { class: 'card' },
      h('p', {}, 'Points go to taking part, never to results. A report that says it didn’t work earns exactly what one that says it did earns, so nobody has a reason to tilt the numbers.'),
      h('div', { class: 'ledger' }, Object.values(S.pointRules).filter((r) => r.points > 0).sort((a, b) => b.points - a.points)
        .map((r) => h('div', {}, h('span', {}, r.label), h('b', {}, `+${r.points}`)))),
      h('div', { class: 'row mt16' }, lv.map((l) => h('span', { title: `${l.name} · ${fmtN(l.min_points)} points` }, emblem(l.n, 36, false, l.name)))),
      h('p', { class: 'xs muted mt8' }, `Fifteen emblems in three tiers, from ${lv[0]?.name || 'Spark'} at 0 to ${lv[lv.length - 1]?.name || 'Organism'} at ${fmtN(lv[lv.length - 1]?.min_points || 7300)} points.`)),
    h('h2', {}, 'What stays private'),
    h('section', { class: 'card' },
      h('p', {}, 'Your phone number is never shown. Nobody sees who voted, who said “same for me”, who sent a sticker, who joined which space, or who reported whom. Your handle, your posts, your emblem and your badges are what others see.')));
  railCards('default').then(setRail);
}

export function renderAccount() {
  const msg = msgBox();
  const confirmBox = h('input', { class: 'input', id: 'confirm-delete', autocomplete: 'off', placeholder: 'Type DELETE' });
  const del = h('button', { class: 'btn danger', type: 'submit' }, 'Delete my account');
  const lv = levelOf(S.card?.level || 1);
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, '// Settings'), h('h1', {}, 'Account.'))),
    h('section', { class: 'card row nw' },
      emblem(S.card?.level || 1, 56, false, lv.name),
      h('div', { class: 'grow' }, h('b', {}, `u/${S.me.handle}`), S.me.role !== 'member' ? h('span', { class: 'chip ink' }, S.me.role) : null,
        h('div', { class: 'small muted' }, `${lv.name} · ${fmtN(S.card?.points || 0)} Signal points · member since ${new Date(S.me.created_at).toLocaleDateString()}`)),
      h('button', {
        class: 'btn', type: 'button',
        onclick: async () => { stopLive(); await sb.auth.signOut(); S.session = null; S.me = null; location.hash = '#/'; location.reload(); },
      }, icon('logout', 16), 'Sign out')),
    S.me.status === 'suspended' ? h('div', { class: 'msg note' }, `Paused until ${new Date(S.me.suspended_until).toLocaleString()}`) : null,
    h('h2', {}, 'Delete your account'),
    h('section', { class: 'card' },
      h('p', { class: 'small' }, 'This deletes your profile, every post and comment you wrote, your votes, your stickers and your points, right away. Reports you filed stay, without your name. It can’t be undone.'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          if (confirmBox.value.trim() !== 'DELETE') return say(msg, 'Type DELETE to confirm.');
          del.disabled = true;
          const { error } = await sb.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
          del.disabled = false;
          if (error) return say(msg, 'Something went wrong; nothing was deleted. Try again, or contact the moderators.');
          track('account_deleted');
          stopLive();
          await sb.auth.signOut(); S.session = null; S.me = null;
          document.body.classList.add('auth');
          render(h('section', { class: 'gate' }, h('div', { class: 'inner' }, sig(96, 'support'), h('h1', {}, 'Your account is deleted'), h('p', { class: 'lede' }, 'Everything you wrote is gone. Thanks for being part of it.'))));
        },
      }, h('label', { class: 'f', for: 'confirm-delete' }, h('span', {}, 'Type DELETE to confirm'), confirmBox), del, msg)),
    C.contactEmail ? h('p', { class: 'small muted mt16' }, 'Questions? ', h('a', { href: `mailto:${C.contactEmail}` }, C.contactEmail)) : null);
  setRail([]);
}
