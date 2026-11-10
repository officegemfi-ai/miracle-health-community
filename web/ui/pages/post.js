// One post: what Sig read (and the author's check on it, components/checks.js), how it is now,
// the reply thread, reporting and editing.
import { h, icon, toast, msgBox, say, confirmBox } from '../dom.js';
import { sig, emblem } from '../art.js';
import { ago } from '../../core/format.js';
import { friendly } from '../../core/errors.js';
import { buildTree, countAll } from '../../core/posts.js';
import * as Posts from '../../data/posts.js';
import * as Comments from '../../data/comments.js';
import { track } from '../../data/telemetry.js';
import { S, spaceOf } from '../../app/store.js';
import { loadCard } from '../../app/session.js';
import { render, setRail, sigSay } from '../shell.js';
import { railCards } from '../rail.js';
import { outcomeChip, refreshSignal } from '../components/signal.js';
import { voteWidget, sameButton, statusChip, spaceLink, authorLink, stickerRow, reactButton, moreButton } from '../components/post.js';
import { openReport } from '../components/report.js';
import { afterEarn } from '../components/game.js';
import { readCheck, safetyNote, checkinLine, checkinBox } from '../components/checks.js';
import { partChips } from '../components/spaces.js';

// The thread
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
      const { data, error } = await Comments.add(row);
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
              const { error } = await Comments.update(c.id, t.value.trim());
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
          const { error } = await Comments.remove(c.id);
          if (error) return say(msg, friendly(error));
          reload();
        },
      }, icon('trash', 16), 'Delete'));
  }
  node.append(
    h('div', { class: 'cm-head' }, toggle, emblem(c.author_level || 1, 22), h('a', { href: `#/u/${encodeURIComponent(c.author_handle)}` }, `u/${c.author_handle}`),
      c.author_id === p.author_id ? h('span', { class: 'chip ink' }, 'OP') : null, h('span', {}, `· ${ago(c.created_at)}`), c.edited_at ? h('span', {}, '· edited') : null, statusChip(c)),
    body, ...(c.serious && c.status === 'visible' ? [safetyNote({ read_serious: true, is_mine: c.is_mine })] : []), acts, msg);
  if (c.kids.length) node.append(h('div', { class: 'cm-kids' }, c.kids.map((k) => commentNode(k, p, reload))));
  return node;
}

// The page
export async function renderPost(id, opts = {}) {
  render(h('div', { class: 'skel' }), h('div', { class: 'skel' }));
  const [{ data: posts, error }] = await Promise.all([Posts.byId(id)]);
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
  const reread = async () => {
    const { data } = await Posts.byId(id);
    if (data?.[0]) Object.assign(p, data[0]);
    drawRead();
  };
  // The read and the author's check on it, a serious reaction, the latest check-in, and (for the
  // author) the check-in due now
  const drawRead = () => readBox.replaceChildren(...[readCheck(p, reread), safetyNote(p), checkinLine(p),
    p.is_mine && p.checkin_due ? checkinBox({ post_id: p.id, week: p.checkin_due, compound_name: p.compound_name }, () => setTimeout(reread, 2500)) : null]
    .filter(Boolean));
  drawRead();

  const loadThread = async (focusId) => {
    const { data } = await Comments.thread(id);
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
          const { error: e } = await Posts.remove(p.id);
          if (e) return say(msg, friendly(e));
          await loadCard();
          location.hash = '#/home';
        },
      }, icon('trash', 16), 'Delete'));
  }
  const pubLine = p.is_mine && p.kind === 'experience' && p.status === 'visible' ? publicLine(p) : null;
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
        partChips(spaceOf(p.compound_id), p.compound_kind === 'stack' ? 'Stack' : p.compound_kind === 'blend' ? 'Blend of' : ''),
        h('div', { class: 'post-chips' }, p.kind === 'question' ? h('span', { class: 'chip' }, 'Question') : h('span', { class: 'chip' }, 'Report'), outcomeChip(p), statusChip(p)),
        bodyBox,
        readBox,
        stickers,
        h('div', { class: 'acts' }, voteWidget('post', p, true), sameButton(p), reactButton(p, drawStickers), moreButton(p), ...ownerActs),
        pubLine,
        msg)),
    p.status === 'visible' && S.me.status !== 'suspended' ? replyBox(p, null, (cid) => loadThread(cid)) : h('p', { class: 'small muted' }, p.status === 'visible' ? 'Your account is paused, so you can’t comment right now.' : 'Comments are closed while this post isn’t up.'),
    h('div', { class: 'row between mt16' }, heading, sortSel),
    thread);
  setRail(await railCards('post', { cid: p.compound_id }));
  await loadThread(opts.focus);
  if (opts.edit && p.is_mine) editPost(p, bodyBox, msg);

  // When Sig's read lands, or a moderator acts on this post, the page
  // updates by itself. The listeners go away once the page does.
  const onRead = async (e) => {
    if (!document.body.contains(readBox)) { document.removeEventListener('mh:read', onRead); return; }
    if (e.detail !== p.id) return;
    const { data } = await Posts.byId(id);
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
      const { data } = await Posts.byId(id);
      if (data?.[0] && !data[0].read_pending) {
        clearInterval(timer);
        const was = { ...p };
        Object.assign(p, data[0]); drawRead();
        if (p.counts_for_signal && !was.counts_for_signal) await refreshSignal();
      }
    }, 3000);
  }
}

// For the author of a report: who can read it. Members only, or anyone, on a public page that
// the community's site build makes every hour (community.miraclehealth.us/r/<id>/).
function publicLine(p) {
  const box = h('div', { class: 'pub-line', 'aria-live': 'polite' });
  const url = `${location.origin}/r/${encodeURIComponent(p.id)}/`;
  const draw = (at) => {
    const btn = h('button', {
      class: 'btn ghost sm', type: 'button',
      onclick: async () => {
        btn.disabled = true;
        const { data, error } = await Posts.setPublic(p.id, !at);
        btn.disabled = false;
        if (error) { toast(friendly(error)); return; }
        track('post_public', { on: !at });
        draw(data || null);
      },
    }, at ? 'Make it members-only' : 'Let anyone read it');
    box.replaceChildren(icon(at ? 'globe' : 'lock', 16),
      at ? h('span', { class: 'small' }, 'Anyone can read this report, without its comments, at ', h('a', { href: url, rel: 'noopener' }, url.replace(/^https?:\/\//, '')), ' (it goes up, or comes down, within the hour).')
        : h('span', { class: 'small muted' }, 'Only members can read this report.'),
      btn);
  };
  Posts.publicSince(p.id).then(({ data }) => draw(data?.[0]?.public_at || null));
  return box;
}

function editPost(p, bodyBox, msg) {
  const title = h('input', { class: 'input', value: p.title, maxlength: 140 });
  const body = h('textarea', { class: 'input', maxlength: 10000 });
  body.value = p.body;
  const save = h('button', { class: 'btn ink sm', type: 'submit' }, 'Save');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); save.disabled = true;
      const { error } = await Posts.update(p.id, { title: title.value.trim(), body: body.value.trim() });
      save.disabled = false;
      if (error) return say(msg, friendly(error));
      sigSay('Saved. I’ll read it again, so it counts the way you wrote it now.', 'think', 4000);
      renderPost(p.id);
    },
  }, h('label', { class: 'f' }, h('span', {}, 'Title'), title), h('label', { class: 'f' }, h('span', {}, 'Post'), body),
  h('div', { class: 'row end' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => renderPost(p.id) }, 'Cancel'), save));
  bodyBox.replaceWith(form);
}
