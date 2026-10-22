// Moderation: the queue, Signal alerts, beta numbers, the watch list, invites.
import { h, ago, friendly, msgBox, say } from './ui.js';
import { sb, S, track } from './state.js';
import { render, setRail } from './shell.js';
import { REASONS } from './post.js';

const MOD_REASONS = [
  'Rule 1: sourcing or selling', 'Rule 2: dosing instructions', 'Rule 3: dangerous medical claims',
  'Rule 4: harassment', 'Rule 5: private information', 'Rule 6: spam or self-promotion',
  'Rule 7: not about peptides', 'Rule 8: under 18', 'Rule 9: fake account or vote ring', 'Rule 10: self-harm (reached out)',
  'Not a rule break',
];

export async function renderMod(tab = 'queue') {
  const tabs = [['queue', 'Queue'], ['alerts', 'Signal alerts'], ['numbers', 'Beta numbers'], ['terms', 'Watch list'], ['invites', 'Invites']];
  const body = h('div', {}, h('div', { class: 'skel' }));
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, '// Keeping it safe'), h('h1', {}, 'Moderation.'))),
    h('nav', { class: 'tabs', 'aria-label': 'Moderation' }, tabs.map(([k, l]) => h('a', { href: `#/mod/${k}`, 'aria-current': k === tab ? 'page' : null }, l))),
    body);
  setRail([]);
  const views = { queue: modQueue, alerts: modAlerts, numbers: modNumbers, terms: modTerms, invites: modInvites };
  await (views[tab] || modQueue)(body);
}

function modActions(item, done) {
  const msg = msgBox();
  // Start on the rule the reports point to, so the usual case is one click
  const RULE_OF = { sourcing: 0, dosing: 1, medical_misinfo: 2, harassment: 3, personal_info: 4, spam: 5, off_topic: 6, underage: 7, self_harm: 9 };
  const first = (item.reasons || []).map((r) => RULE_OF[r]).find((i) => i !== undefined);
  const reason = h('select', { class: 'input' }, MOD_REASONS.map((r, i) => h('option', { value: r, selected: i === first }, r)));
  const note = h('input', { class: 'input', placeholder: 'Note (a warning sends it to the member)', maxlength: 300 });
  const act = (target_kind, target_id, action, days) => async () => {
    const { error } = await sb.rpc('moderate', { target_kind, target_id, action, reason: reason.value, note: note.value.trim() || null, days: days || null });
    if (error) return say(msg, friendly(error));
    track('moderation', { action });
    done();
  };
  const content = item.target_kind !== 'member';
  return h('div', { class: 'mt12' },
    h('div', { class: 'row nw' }, reason, note),
    h('div', { class: 'row mt8' },
      content && item.status !== 'visible' ? h('button', { class: 'btn sm', type: 'button', onclick: act(item.target_kind, item.target_id, 'restore') }, 'Restore') : null,
      content && item.status !== 'removed' ? h('button', { class: 'btn sm danger', type: 'button', onclick: act(item.target_kind, item.target_id, 'remove') }, 'Remove') : null,
      item.reports > 0 ? h('button', { class: 'btn sm', type: 'button', onclick: act(item.target_kind, item.target_id, 'dismiss') }, 'Dismiss reports') : null,
      h('button', { class: 'btn sm', type: 'button', onclick: act('member', item.author_id, 'warn') }, 'Warn author'),
      h('button', { class: 'btn sm', type: 'button', onclick: act('member', item.author_id, 'suspend', 7) }, 'Suspend 7 days'),
      h('button', { class: 'btn sm danger', type: 'button', onclick: act('member', item.author_id, 'ban') }, 'Ban')),
    msg);
}

async function modQueue(body) {
  const { data, error } = await sb.from('mod_queue').select('*').order('waiting_since', { ascending: true });
  if (error) return body.replaceChildren(h('div', { class: 'msg err' }, friendly(error)));
  if (!data.length) return body.replaceChildren(h('div', { class: 'msg ok' }, 'Nothing waiting. Nice.'));
  body.replaceChildren(...data.map((it) => h('article', { class: 'card mod-card', 'data-queue': it.target_id },
    h('div', { class: 'row' },
      h('span', { class: 'chip ink' }, it.target_kind),
      it.status ? h('span', { class: `chip ${it.status === 'visible' ? '' : it.status}` }, it.status) : null,
      it.reports ? h('span', { class: 'chip' }, `${it.reports} report${it.reports === 1 ? '' : 's'}: ${(it.reasons || []).join(', ')}`) : null,
      h('span', { class: 'kick' }, `waiting ${ago(it.waiting_since)}`)),
    it.status_reason ? h('p', { class: 'small muted' }, it.status_reason) : null,
    it.title ? h('h3', { class: 'mt8' }, it.title) : null,
    it.body ? h('div', { class: 'body mt8' }, it.body) : null,
    h('p', { class: 'small' }, it.target_kind === 'member' ? `u/${it.author_handle}` : `by u/${it.author_handle}`),
    modActions(it, () => modQueue(body)))));
}

async function modAlerts(body) {
  const { data, error } = await sb.from('signal_alerts').select('*').eq('status', 'open').order('created_at', { ascending: false });
  if (error) return body.replaceChildren(h('div', { class: 'msg err' }, friendly(error)));
  if (!data.length) return body.replaceChildren(h('div', { class: 'msg ok' }, 'No open alerts.'));
  const name = (id) => (S.spaces.find((c) => c.compound_id === id) || {}).name || id;
  body.replaceChildren(
    h('p', { class: 'small muted' }, 'Raised when new accounts make up most of one compound’s activity. Look at who they are before the numbers move.'),
    ...data.map((a) => h('div', { class: 'card mod-card' },
      h('h3', {}, name(a.compound_id)),
      h('div', { class: 'small' }, `${a.new_accounts} new accounts, ${a.new_account_events} of ${a.events} actions in ${Math.round((new Date(a.window_end) - new Date(a.window_start)) / 3600000)} h`),
      h('div', { class: 'row mt8' },
        h('a', { class: 'btn sm', href: `#/s/${encodeURIComponent(a.compound_id)}?sort=new` }, 'See the posts'),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { const { error: e } = await sb.rpc('review_alert', { alert_id: a.id }); if (!e) modAlerts(body); } }, 'Mark reviewed')))));
}

async function modNumbers(body) {
  const { data, error } = await sb.rpc('beta_metrics');
  if (error) return body.replaceChildren(h('div', { class: 'msg err' }, friendly(error)));
  body.replaceChildren(h('section', { class: 'card' }, h('table', { class: 'metrics' }, h('tbody', {}, data.map((m) => h('tr', {},
    h('td', {}, h('b', {}, m.metric.replace(/_/g, ' ')), h('div', { class: 'xs muted' }, m.detail)),
    h('td', { class: 'v' }, m.value == null ? '–' : String(m.value))))))));
}

async function modTerms(body) {
  const msg = msgBox();
  const { data, error } = await sb.from('watch_terms').select('*').order('term');
  if (error) return body.replaceChildren(h('div', { class: 'msg err' }, friendly(error)));
  const term = h('input', { class: 'input', placeholder: 'word or phrase', maxlength: 100 });
  const action = h('select', { class: 'input' }, h('option', { value: 'hold' }, 'Hold for review'), h('option', { value: 'block' }, 'Refuse at once'));
  const reason = h('select', { class: 'input' }, REASONS.map(([v, l]) => h('option', { value: v }, l)));
  body.replaceChildren(
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        const { error: e2 } = await sb.from('watch_terms').insert({ term: term.value.trim(), action: action.value, reason: reason.value });
        if (e2) return say(msg, friendly(e2));
        modTerms(body);
      },
    }, h('h3', {}, 'Add a term'), h('div', { class: 'mt8' }, term), h('div', { class: 'row nw mt8' }, action, reason), h('div', { class: 'row end mt8' }, h('button', { class: 'btn ink sm', type: 'submit' }, 'Add')), msg),
    h('section', { class: 'card mt12' }, ...data.map((t) => h('div', { class: 'row nw', style: null },
      h('span', { class: 'grow' }, h('b', {}, t.term), ' ', h('span', { class: 'chip' }, t.action), ' ', h('span', { class: 'xs muted' }, t.reason)),
      h('button', { class: 'lnk', type: 'button', onclick: async () => { await sb.from('watch_terms').delete().eq('id', t.id); modTerms(body); } }, 'Remove')))));
}

async function modInvites(body) {
  const msg = msgBox();
  const { data, error } = await sb.from('invites').select('*').order('created_at', { ascending: false });
  if (error) return body.replaceChildren(h('div', { class: 'msg err' }, friendly(error)));
  const note = h('input', { class: 'input', placeholder: 'Who it’s for (only moderators see this)', maxlength: 200 });
  const uses = h('input', { class: 'input', type: 'number', min: 1, max: 50, value: '1' });
  const trusted = h('input', { type: 'checkbox' });
  const link = (code) => `${location.origin}${location.pathname}#/join/${code}`;
  body.replaceChildren(
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        const { error: e2 } = await sb.from('invites').insert({ note: note.value.trim() || null, max_uses: Number(uses.value) || 1, trusted: trusted.checked });
        if (e2) return say(msg, friendly(e2));
        modInvites(body);
      },
    }, h('h3', {}, 'New invite'), h('div', { class: 'mt8' }, note),
    h('label', { class: 'f' }, h('span', {}, 'How many people can use it'), uses),
    h('label', { class: 'check' }, trusted, h('span', {}, 'Founding member: the Founding badge, and no first-week limits')),
    h('div', { class: 'row end' }, h('button', { class: 'btn ink sm', type: 'submit' }, 'Create')), msg),
    ...data.map((i) => h('div', { class: 'card mt8' },
      h('div', { class: 'row' }, h('b', { class: 'grow mono' }, i.code), i.trusted ? h('span', { class: 'chip lime' }, 'founding') : null, h('span', { class: 'kick' }, `${i.uses} of ${i.max_uses} used`)),
      i.note ? h('div', { class: 'small muted' }, i.note) : null,
      h('div', { class: 'xs mono mt4' }, link(i.code)))));
}
