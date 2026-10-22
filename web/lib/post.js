// One post: what Miracle AI read (and the author's check on it), the reply
// thread, reporting and editing.
import { h, icon, fmtN, fmt1, ago, toast, friendly, msgBox, say, modal, confirmBox } from './ui.js';
import { sig, emblem } from './art.js';
import { S, sb, signalOf, loadCard, track } from './state.js';
import { render, setRail, railCards, sigSay } from './shell.js';
import { OUTCOME, outcomeChip, sigNum, refreshSignal } from './signal.js';
import { voteWidget, sameButton, statusChip, spaceLink, authorLink, stickerRow, reactButton, moreButton } from './feed.js';
import { afterEarn } from './game.js';

export const REASONS = [
  ['sourcing', 'Selling or sourcing (rule 1)'],
  ['dosing', 'Telling others what to take (rule 2)'],
  ['medical_misinfo', 'Dangerous medical claims (rule 3)'],
  ['harassment', 'Harassment or hate (rule 4)'],
  ['personal_info', 'Private information (rule 5)'],
  ['spam', 'Spam or self-promotion (rule 6)'],
  ['off_topic', 'Not about peptides (rule 7)'],
  ['underage', 'Someone under 18 (rule 8)'],
  ['self_harm', 'Someone may be at risk (rule 10)'],
  ['other', 'Something else'],
];

export function openReport(kind, id) {
  const msg = msgBox();
  modal((close) => {
    const note = h('textarea', { class: 'input', maxlength: 500, rows: 3, placeholder: 'Optional: what’s wrong?' });
    const radios = REASONS.map(([v, label], i) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'reason', value: v, checked: i === 0 }), h('span', {}, label)));
    const send = h('button', { class: 'btn lime', type: 'submit' }, 'Send report');
    const box = h('form', {
      class: 'pad',
      onsubmit: async (e) => {
        e.preventDefault();
        const reason = box.querySelector('input[name=reason]:checked')?.value || 'other';
        send.disabled = true;
        const { error } = await sb.from('reports').insert({ target_kind: kind, target_id: id, reason, note: note.value.trim() || null });
        send.disabled = false;
        if (error) return say(msg, friendly(error));
        track('report', { kind, reason });
        box.replaceChildren(h('div', { class: 'row nw' }, sig(56, 'support'), h('h2', {}, 'Thanks, a moderator will look')),
          reason === 'self_harm'
            ? h('p', {}, 'If someone is in danger right now, call 911. For a crisis, call or text 988 (US).')
            : h('p', { class: 'muted' }, 'They never see who reported them.'),
          h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Close')));
      },
    }, h('h2', {}, `Report this ${kind === 'member' ? 'member' : kind}`), ...radios,
    h('label', { class: 'f' }, h('span', {}, 'Details'), note),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancel'), send), msg);
    return box;
  }, { label: 'Report' });
}

// ---------------------------------------------------------------------------
// What Miracle AI read, and the author's check
// ---------------------------------------------------------------------------
function readPanel(p, refresh) {
  if (p.kind === 'question') return null;
  const x = signalOf(p.compound_id);
  const confirmRow = (label) => h('div', { class: 'confirm' },
    h('span', { class: 'kick' }, label),
    ...Object.entries(OUTCOME).map(([k, [name]]) => h('button', {
      class: `btn xs ${p.outcome === k ? 'ink' : 'ghost'}`, type: 'button',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        const { error } = await sb.rpc('confirm_read', { post_id: p.id, outcome: k });
        btn.disabled = false;
        if (error) { toast(friendly(error)); return; }
        track('confirm_read', { changed: k !== p.outcome });
        await afterEarn(btn, '· thanks for checking the read');
        await refreshSignal();
        sigSay(['Got it: ', h('b', {}, name), '. Your own word counts more than my read.'], 'happy', 4200);
        refresh();
      },
    }, name)));
  if (p.counts_for_signal && OUTCOME[p.outcome]) {
    const bits = [OUTCOME[p.outcome][0], p.duration, (p.side_effects || []).length ? `side effects: ${p.side_effects.join(', ')}` : null].filter(Boolean).join(' · ');
    return h('section', { class: 'airead', 'aria-label': 'What Miracle AI read' },
      sig(40, p.read_confirmed ? 'happy' : 'watching'),
      h('div', { class: 'grow' },
        h('div', { class: 'kick' }, p.read_confirmed ? (p.read_corrected ? 'Corrected by the author' : 'Confirmed by the author') : 'Miracle AI read'),
        h('p', {}, h('b', {}, `${bits}. `),
          x && x.score != null
            ? ['It feeds the ', h('a', { href: `#/s/${encodeURIComponent(p.compound_id)}` }, `${p.compound_name} Signal`), ', now ', sigNum(p.compound_id), '.']
            : `It counts toward the first ${p.compound_name} Signal.`),
        p.is_mine && !p.read_confirmed && p.status === 'visible' ? confirmRow('Is that right? +10') : null));
  }
  if (p.read_pending) {
    return h('section', { class: 'airead', 'aria-label': 'Miracle AI is reading', 'data-reading': p.id },
      sig(40, 'think'), h('div', {}, h('div', { class: 'kick' }, 'Miracle AI is reading'), h('p', {}, 'It’s reading how it went for the Signal. This takes a moment; the page updates by itself.')));
  }
  if (p.is_mine && p.status === 'visible') {
    return h('section', { class: 'airead' }, sig(40, 'curious'),
      h('div', { class: 'grow' }, h('div', { class: 'kick' }, 'Not in the Signal yet'),
        h('p', {}, 'Miracle AI couldn’t tell how it went. Tell it yourself and your report counts:'),
        confirmRow('How did it go?')));
  }
  return null;
}

// ---------------------------------------------------------------------------
// The thread
// ---------------------------------------------------------------------------
function buildTree(rows, sort) {
  const byId = new Map(rows.map((c) => [c.id, { ...c, kids: [] }]));
  const roots = [];
  byId.forEach((c) => {
    const parent = c.parent_id && byId.get(c.parent_id);
    if (parent) parent.kids.push(c); else roots.push(c);
  });
  const cmp = sort === 'new' ? (a, b) => new Date(b.created_at) - new Date(a.created_at) : (a, b) => (b.score - a.score) || (new Date(a.created_at) - new Date(b.created_at));
  const order = (list) => { list.sort(cmp); list.forEach((c) => order(c.kids)); return list; };
  return order(roots);
}

function replyBox(p, parent, onDone) {
  const ta = h('textarea', { class: 'input', maxlength: 5000, rows: 3, placeholder: parent ? `Reply to u/${parent.author_handle}` : 'Add your experience or a question' });
  if (!parent) ta.id = 'comment';
  const send = h('button', { class: 'btn ink sm', type: 'submit' }, parent ? 'Reply' : 'Comment');
  const msg = msgBox();
  return h('form', {
    class: parent ? 'reply-box composer' : 'card composer',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!ta.value.trim()) return;
      send.disabled = true;
      const row = { post_id: p.id, body: ta.value.trim() };
      if (parent) row.parent_id = parent.id;
      const { data, error } = await sb.from('comments').insert(row).select('id,status,status_reason');
      send.disabled = false;
      if (error) return say(msg, friendly(error));
      track('comment', { reply: !!parent });
      if (data?.[0]?.status === 'held') say(msg, 'Saved, and waiting for a moderator. Only you can see it for now.', 'note');
      ta.value = '';
      afterEarn(send);
      onDone(data?.[0]?.id);
    },
  }, ta, h('div', { class: 'row end mt8' }, parent ? h('button', { class: 'btn ghost sm', type: 'button', onclick: (e) => e.currentTarget.closest('form').remove() }, 'Cancel') : null, send), msg);
}

function commentNode(c, p, reload) {
  const node = h('div', { class: 'cm', 'data-comment': c.id, id: `c-${c.id}` });
  const msg = msgBox();
  const body = h('div', { class: 'cm-body' }, c.body);
  const toggle = h('button', { class: 'cm-toggle', type: 'button', 'aria-expanded': 'true', 'aria-label': 'Collapse thread' }, '–');
  toggle.addEventListener('click', () => {
    const collapsed = node.classList.toggle('collapsed');
    toggle.textContent = collapsed ? `+ ${countAll(c)}` : '–';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });
  const acts = h('div', { class: 'acts' }, voteWidget('comment', c, true));
  if (c.status === 'visible' && p.status === 'visible' && S.me.status !== 'suspended') {
    acts.append(h('button', {
      class: 'act', type: 'button',
      onclick: () => {
        if (node.querySelector(':scope > .reply-box')) return;
        const box = replyBox(p, c, (id) => reload(id));
        acts.after(box); box.querySelector('textarea').focus();
      },
    }, icon('comment', 16), 'Reply'));
  }
  if (!c.is_mine && c.status === 'visible') acts.append(h('button', { class: 'act', type: 'button', onclick: () => openReport('comment', c.id) }, icon('flag', 16), 'Report'));
  if (c.is_mine && c.status !== 'removed') {
    acts.append(
      h('button', {
        class: 'act', type: 'button',
        onclick: () => {
          const t = h('textarea', { class: 'input', maxlength: 5000 }); t.value = c.body;
          const f = h('form', {
            class: 'reply-box',
            onsubmit: async (e) => {
              e.preventDefault();
              const { error } = await sb.from('comments').update({ body: t.value.trim() }).eq('id', c.id);
              if (error) return say(msg, friendly(error));
              c.body = t.value.trim(); body.textContent = c.body; f.replaceWith(body);
            },
          }, t, h('div', { class: 'row end mt8' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => f.replaceWith(body) }, 'Cancel'), h('button', { class: 'btn ink sm', type: 'submit' }, 'Save')));
          body.replaceWith(f);
        },
      }, icon('edit', 16), 'Edit'),
      h('button', {
        class: 'act', type: 'button',
        onclick: async () => {
          if (!(await confirmBox('Delete this comment? Replies to it stay up.'))) return;
          const { error } = await sb.from('comments').delete().eq('id', c.id);
          if (error) return say(msg, friendly(error));
          reload();
        },
      }, icon('trash', 16), 'Delete'));
  }
  node.append(
    h('div', { class: 'cm-head' }, toggle, emblem(c.author_level || 1, 22), h('a', { href: `#/u/${encodeURIComponent(c.author_handle)}` }, `u/${c.author_handle}`),
      c.author_id === p.author_id ? h('span', { class: 'chip ink' }, 'OP') : null, h('span', {}, `· ${ago(c.created_at)}`), c.edited_at ? h('span', {}, '· edited') : null, statusChip(c)),
    body, acts, msg);
  if (c.kids.length) node.append(h('div', { class: 'cm-kids' }, c.kids.map((k) => commentNode(k, p, reload))));
  return node;
}
const countAll = (c) => 1 + c.kids.reduce((n, k) => n + countAll(k), 0);

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
export async function renderPost(id, opts = {}) {
  render(h('div', { class: 'skel' }), h('div', { class: 'skel' }));
  const [{ data: posts, error }] = await Promise.all([sb.from('feed').select('*').eq('id', id).limit(1)]);
  const p = posts && posts[0];
  if (error || !p) {
    render(h('div', { class: 'empty card' }, sig(72, 'concerned'), h('p', {}, 'This post isn’t available. It may have been removed.'), h('a', { class: 'btn sm', href: '#/home' }, 'Back to your feed')));
    return;
  }
  let sort = 'best';
  const msg = msgBox();
  const thread = h('div', { class: 'thread' });
  const heading = h('h2', {});
  const readBox = h('div', {});
  const drawRead = () => readBox.replaceChildren(readPanel(p, async () => {
    const { data } = await sb.from('feed').select('*').eq('id', id).limit(1);
    if (data?.[0]) Object.assign(p, data[0]);
    drawRead();
  }) || '');
  drawRead();

  const loadThread = async (focusId) => {
    const { data } = await sb.from('thread_comments').select('*').eq('post_id', id).order('created_at', { ascending: true });
    const rows = (data || []).filter((c) => c.status === 'visible' || c.is_mine);
    heading.replaceChildren(`Comments `, h('span', { class: 'muted' }, `(${rows.length})`));
    const tree = buildTree(rows, sort);
    thread.replaceChildren(...(tree.length ? tree.map((c) => commentNode(c, p, loadThread)) : [h('p', { class: 'muted small' }, 'No comments yet. Start the conversation.')]));
    if (focusId) {
      const el = document.getElementById(`c-${focusId}`);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); }
    }
  };

  const bodyBox = h('div', { class: 'body' }, p.body);
  const stickers = h('div', {});
  const drawStickers = () => stickers.replaceChildren(stickerRow(p) || '');
  drawStickers();
  const ownerActs = [];
  if (p.is_mine && p.status !== 'removed') {
    ownerActs.push(
      h('button', { class: 'act', type: 'button', onclick: () => editPost(p, bodyBox, msg) }, icon('edit', 16), 'Edit'),
      h('button', {
        class: 'act', type: 'button',
        onclick: async () => {
          if (!(await confirmBox('Delete this post and its comments? This can’t be undone.'))) return;
          const { error: e } = await sb.from('posts').delete().eq('id', p.id);
          if (e) return say(msg, friendly(e));
          await loadCard();
          location.hash = '#/home';
        },
      }, icon('trash', 16), 'Delete'));
  }
  const sortSel = h('div', { class: 'sortbar' }, [['best', 'Best'], ['new', 'New']].map(([k, l]) => h('a', {
    href: '#', 'aria-current': sort === k ? 'page' : null,
    onclick: (e) => { e.preventDefault(); sort = k; sortSel.querySelectorAll('a').forEach((a) => a.setAttribute('aria-current', a.textContent === l ? 'page' : '')); loadThread(); },
  }, l)));

  render(
    h('div', { class: 'post-head mt8' }, h('a', { class: 'lnk', href: `#/s/${encodeURIComponent(p.compound_id)}` }, `← s/${p.compound_name}`)),
    h('article', { class: 'card post mt8', 'data-post': p.id },
      h('div', { class: 'vrail' }, voteWidget('post', p)),
      h('div', { class: 'post-main' },
        h('div', { class: 'post-head' }, spaceLink(p), h('span', { class: 'sep' }, '·'), authorLink(p), h('span', { class: 'sep' }, '·'), h('span', {}, ago(p.created_at)), p.edited_at ? h('span', {}, '· edited') : null),
        h('h1', { class: 'post-title' }, p.title),
        h('div', { class: 'post-chips' }, p.kind === 'question' ? h('span', { class: 'chip' }, 'Question') : h('span', { class: 'chip' }, 'Report'), outcomeChip(p), statusChip(p)),
        bodyBox,
        readBox,
        stickers,
        h('div', { class: 'acts' }, voteWidget('post', p, true), sameButton(p), reactButton(p, drawStickers), moreButton(p), ...ownerActs),
        msg)),
    p.status === 'visible' && S.me.status !== 'suspended' ? replyBox(p, null, (cid) => loadThread(cid)) : h('p', { class: 'small muted' }, p.status === 'visible' ? 'Your account is paused, so you can’t comment right now.' : 'Comments are closed while this post isn’t up.'),
    h('div', { class: 'row between mt16' }, heading, sortSel),
    thread);
  setRail(await railCards('post', { cid: p.compound_id }));
  await loadThread(opts.focus);
  if (opts.edit && p.is_mine) editPost(p, bodyBox, msg);

  // When Miracle AI's read lands, or a moderator acts on this post, the page
  // updates by itself. The listeners go away once the page does.
  const onRead = async (e) => {
    if (!document.body.contains(readBox)) { document.removeEventListener('mh:read', onRead); return; }
    if (e.detail !== p.id) return;
    const { data } = await sb.from('feed').select('*').eq('id', id).limit(1);
    if (data?.[0]) { Object.assign(p, data[0]); drawRead(); }
  };
  document.addEventListener('mh:read', onRead);
  const onChanged = (e) => {
    if (!document.body.contains(readBox)) { document.removeEventListener('mh:post', onChanged); return; }
    if (e.detail !== p.id) return;
    document.removeEventListener('mh:post', onChanged);
    document.removeEventListener('mh:read', onRead);
    renderPost(p.id);
  };
  document.addEventListener('mh:post', onChanged);
  if (p.read_pending) {
    // In case the live feed is slow, check back a few times
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      if (!document.body.contains(readBox) || tries > 20) { clearInterval(timer); return; }
      const { data } = await sb.from('feed').select('*').eq('id', id).limit(1);
      if (data?.[0] && !data[0].read_pending) {
        clearInterval(timer);
        const was = { ...p };
        Object.assign(p, data[0]); drawRead();
        if (p.counts_for_signal && !was.counts_for_signal) await refreshSignal();
      }
    }, 3000);
  }
}

function editPost(p, bodyBox, msg) {
  const title = h('input', { class: 'input', value: p.title, maxlength: 140 });
  const body = h('textarea', { class: 'input', maxlength: 10000 });
  body.value = p.body;
  const save = h('button', { class: 'btn ink sm', type: 'submit' }, 'Save');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); save.disabled = true;
      const { error } = await sb.from('posts').update({ title: title.value.trim(), body: body.value.trim() }).eq('id', p.id);
      save.disabled = false;
      if (error) return say(msg, friendly(error));
      sigSay('Saved. Miracle AI reads it again, so it counts the way you wrote it now.', 'think', 4000);
      renderPost(p.id);
    },
  }, h('label', { class: 'f' }, h('span', {}, 'Title'), title), h('label', { class: 'f' }, h('span', {}, 'Post'), body),
  h('div', { class: 'row end' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => renderPost(p.id) }, 'Cancel'), save));
  bodyBox.replaceWith(form);
}

export { fmtN, fmt1 };
