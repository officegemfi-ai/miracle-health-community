// Feeds and posts: Reddit's patterns (spaces, votes, sorting, threads) with the
// Signal built in. Members' text always goes in as text.
import { h, icon, fmtN, fmt1, ago, toast, friendly, msgBox, say, copy, bar, plural } from './ui.js';
import { sig, sticker, STICKERS, emblem, spaceTile } from './art.js';
import { S, sb, on, spaceOf, signalOf, nameOf, loadSpaces, track } from './state.js';
import { render, setRail, railCards, renderNav, sigSay } from './shell.js';
import { signalCard, sigNum, outcomeChip, readMini, refreshSignal, movement } from './signal.js';
import { afterEarn } from './game.js';
import { openReport } from './post.js';

// ---------------------------------------------------------------------------
// Votes, "same for me", stickers
// ---------------------------------------------------------------------------
export function voteWidget(kind, item, horizontal = false) {
  const table = kind === 'post' ? 'post_votes' : 'comment_votes';
  const key = kind === 'post' ? 'post_id' : 'comment_id';
  const count = h('b', { class: 'num' }, String(item.score));
  const up = h('button', { type: 'button', class: 'up', 'aria-label': 'Helpful', 'aria-pressed': String(item.my_vote === 1) }, icon('up', 18));
  const down = h('button', { type: 'button', class: 'dn', 'aria-label': 'Not helpful', 'aria-pressed': String(item.my_vote === -1) }, icon('dn', 18));
  const box = h('span', { class: `vote ${horizontal ? 'h' : ''}` }, up, count, down);
  if (item.is_mine || item.status !== 'visible') {
    up.disabled = true; down.disabled = true;
    up.title = item.is_mine ? 'You can’t vote on your own' : '';
    return box;
  }
  const cast = async (value, btn) => {
    const prev = item.my_vote ?? null;
    let res;
    if (prev === value) res = await sb.from(table).delete().eq(key, item.id);
    else if (prev === null) res = await sb.from(table).insert({ [key]: item.id, value });
    else res = await sb.from(table).update({ value }).eq(key, item.id);
    if (res.error) { toast(friendly(res.error)); return; }
    const next = prev === value ? null : value;
    item.score += (next ?? 0) - (prev ?? 0);
    item.my_vote = next;
    document.querySelectorAll(`[data-vote-of="${item.id}"]`).forEach((v) => v.replaceWith(voteWidget(kind, item, v.classList.contains('h'))));
    track('vote', { kind });
    if (next === 1) btn.animate?.([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260 });
  };
  up.addEventListener('click', () => cast(1, up));
  down.addEventListener('click', () => cast(-1, down));
  box.dataset.voteOf = item.id;
  return box;
}

export function sameButton(p) {
  if (!p.counts_for_signal || p.status !== 'visible') return null;
  const b = h('button', {
    class: 'act same', type: 'button', 'aria-pressed': String(!!p.i_same),
    title: p.is_mine ? 'Others tap this when their experience matched yours' : 'Had the same experience? It adds your voice to the Signal.',
  }, icon('same', 18), `Same for me · ${fmtN(p.same_count)}`);
  if (p.is_mine) { b.disabled = true; return b; }
  b.addEventListener('click', async () => {
    b.disabled = true;
    const res = p.i_same
      ? await sb.from('same_for_me').delete().eq('post_id', p.id)
      : await sb.from('same_for_me').insert({ post_id: p.id });
    b.disabled = false;
    if (res.error) { toast(friendly(res.error)); return; }
    p.i_same = !p.i_same;
    p.same_count += p.i_same ? 1 : -1;
    b.replaceChildren(icon('same', 18), `Same for me · ${fmtN(p.same_count)}`);
    b.setAttribute('aria-pressed', String(p.i_same));
    track('same_for_me', { on: p.i_same });
    if (p.i_same) {
      await afterEarn(b);
      sigSay(['Your voice is in the ', h('b', {}, `${p.compound_name} Signal`), ' now. Every match makes it more accurate.'], 'support', 4200);
    } else afterEarn(null);
    refreshSignal();
  });
  return b;
}

export function stickerRow(p) {
  const counts = p.reactions || {};
  const mine = new Set(p.my_reactions || []);
  const items = STICKERS.filter(([k]) => Number(counts[k]) > 0)
    .map(([k, label]) => h('span', { class: `stk-count ${mine.has(k) ? 'mine' : ''}`, title: label }, sticker(k, 22), fmtN(counts[k])));
  return items.length ? h('div', { class: 'stk-row' }, items) : null;
}

let openPop = null;
function closePop() { openPop?.remove(); openPop = null; document.removeEventListener('click', outsidePop, true); }
function outsidePop(e) { if (openPop && !openPop.contains(e.target)) closePop(); }
function popAt(anchor, node) {
  closePop();
  const r = anchor.getBoundingClientRect();
  node.style.left = `${Math.max(8, Math.min(window.innerWidth - 300, r.left + window.scrollX))}px`;
  node.style.top = `${r.bottom + window.scrollY + 6}px`;
  document.body.append(node);
  openPop = node;
  setTimeout(() => document.addEventListener('click', outsidePop, true), 0);
}

export function reactButton(p, onChange) {
  if (p.status !== 'visible') return null;
  const b = h('button', { class: 'act', type: 'button', 'aria-haspopup': 'true', title: p.is_mine ? 'Stickers are for other people’s posts' : 'Send a Sig sticker' }, sticker('cheer', 20), 'React');
  if (p.is_mine) { b.disabled = true; return b; }
  b.addEventListener('click', () => {
    const mine = new Set(p.my_reactions || []);
    const pop = h('div', { class: 'pop', role: 'menu', 'aria-label': 'Sig stickers' }, STICKERS.map(([k, label, hint]) => {
      const s = h('button', { type: 'button', role: 'menuitemcheckbox', 'aria-pressed': String(mine.has(k)), title: hint }, sticker(k, 40), label);
      s.addEventListener('click', async () => {
        const on = mine.has(k);
        const res = on ? await sb.from('post_reactions').delete().eq('post_id', p.id).eq('sticker', k)
          : await sb.from('post_reactions').insert({ post_id: p.id, sticker: k });
        if (res.error) { toast(friendly(res.error)); return; }
        p.reactions = { ...(p.reactions || {}), [k]: Math.max(0, Number(p.reactions?.[k] || 0) + (on ? -1 : 1)) };
        p.my_reactions = on ? (p.my_reactions || []).filter((x) => x !== k) : [...(p.my_reactions || []), k];
        closePop();
        onChange();
        if (!on) sigSay([`${label} sent. `, h('b', {}, `u/${p.author_handle}`), ' will see it on their post.'], k, 3000);
        track('sticker', { sticker: k });
      });
      return s;
    }));
    popAt(b, pop);
  });
  return b;
}

export function moreButton(p) {
  const b = h('button', { class: 'act', type: 'button', 'aria-label': 'More', 'aria-haspopup': 'true' }, icon('more', 18));
  b.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}#/post/${p.id}`;
    const items = [
      h('button', { type: 'button', onclick: async () => { closePop(); toast((await copy(url)) ? 'Link copied. Only members can open it.' : url); } }, icon('link', 18), 'Copy link'),
      !p.is_mine && p.status === 'visible' ? h('button', { type: 'button', onclick: () => { closePop(); openReport('post', p.id); } }, icon('flag', 18), 'Report post') : null,
      !p.is_mine ? h('button', { type: 'button', onclick: () => { closePop(); openReport('member', p.author_id); } }, icon('user', 18), `Report u/${p.author_handle}`) : null,
      p.is_mine && p.status !== 'removed' ? h('a', { href: `#/post/${p.id}?edit=1`, onclick: closePop }, icon('edit', 18), 'Edit') : null,
    ];
    popAt(b, h('div', { class: 'pop menu', role: 'menu' }, items));
  });
  return b;
}

function statusChip(item) {
  if (item.status === 'held') return h('span', { class: 'chip held', title: item.status_reason || '' }, 'Waiting for a moderator · only you can see it');
  if (item.status === 'removed') return h('span', { class: 'chip removed' }, `Removed${item.status_reason ? `: ${item.status_reason}` : ''}`);
  return null;
}
export { statusChip };

export function spaceLink(p) {
  const sp = spaceOf(p.compound_id) || { name: p.compound_name, category: p.compound_category };
  return h('a', { class: 'space', href: `#/s/${encodeURIComponent(p.compound_id)}` }, spaceTile(sp, 22), `s/${p.compound_name}`);
}
export function authorLink(p, cls = 'who') {
  return h('a', { class: cls, href: `#/u/${encodeURIComponent(p.author_handle)}` }, emblem(p.author_level || 1, 18), `u/${p.author_handle}`);
}

// ---------------------------------------------------------------------------
// A post in a feed
// ---------------------------------------------------------------------------
export function postCard(p) {
  const href = `#/post/${encodeURIComponent(p.id)}`;
  const card = h('article', { class: 'card post', 'data-post': p.id });
  const draw = () => {
    const x = signalOf(p.compound_id);
    card.replaceChildren(
      h('div', { class: 'vrail' }, voteWidget('post', p)),
      h('div', { class: 'post-main' },
        h('div', { class: 'post-head' }, spaceLink(p), h('span', { class: 'sep' }, '·'), authorLink(p), h('span', { class: 'sep' }, '·'), h('span', {}, ago(p.created_at)),
          x && x.score != null ? h('span', { class: 'grow' }) : null,
          x && x.score != null ? h('a', { class: 'chip', href: `#/s/${encodeURIComponent(p.compound_id)}`, title: `${p.compound_name} Community Signal` }, 'Signal ', sigNum(p.compound_id)) : null),
        h('a', { class: 'post-title', href }, p.title),
        h('div', { class: 'post-chips' }, p.kind === 'question' ? h('span', { class: 'chip' }, 'Question') : h('span', { class: 'chip' }, 'Report'), outcomeChip(p), statusChip(p), readMini(p),
          p.duration && p.counts_for_signal ? h('span', { class: 'chip' }, p.duration) : null),
        h('div', { class: 'excerpt' }, p.body),
        stickerRow(p),
        h('div', { class: 'acts' },
          voteWidget('post', p, true),
          h('a', { class: 'act', href }, icon('comment', 18), `${fmtN(p.comment_count)} comment${p.comment_count === 1 ? '' : 's'}`),
          sameButton(p),
          reactButton(p, draw),
          moreButton(p))));
  };
  draw();
  return card;
}

// ---------------------------------------------------------------------------
// Spaces: join and leave
// ---------------------------------------------------------------------------
export function joinButton(sp, cls = '') {
  const b = h('button', { class: `btn ${sp.joined ? 'ghost' : 'lime'} sm join ${cls}`, type: 'button', 'aria-pressed': String(!!sp.joined) }, sp.joined ? 'Joined' : 'Join');
  b.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    b.disabled = true;
    const res = sp.joined
      ? await sb.from('space_members').delete().eq('compound_id', sp.compound_id)
      : await sb.from('space_members').insert({ compound_id: sp.compound_id });
    b.disabled = false;
    if (res.error) { toast(friendly(res.error)); return; }
    sp.joined = !sp.joined;
    sp.members_count += sp.joined ? 1 : -1;
    b.textContent = sp.joined ? 'Joined' : 'Join';
    b.className = `btn ${sp.joined ? 'ghost' : 'lime'} sm join ${cls}`;
    b.setAttribute('aria-pressed', String(sp.joined));
    await loadSpaces();
    renderNav(document.querySelector('.nav-i[aria-current=page]')?.dataset.nav || '', sp.compound_id);
    if (sp.joined) {
      sigSay(['You joined ', h('b', {}, `s/${sp.name}`), '. Its posts show up on your Home feed now.'], 'happy', 3600);
      afterEarn(b);
    }
    track('space', { joined: sp.joined });
  });
  return b;
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------
const SORTS = [['hot', 'Hot', 'flame'], ['new', 'New', 'clock'], ['top', 'Top', 'up'], ['reports', 'Reports', 'pulse']];
function sortbar(base, sort) {
  return h('div', { class: 'sortbar', role: 'tablist', 'aria-label': 'Sort' },
    SORTS.map(([k, l, ic]) => h('a', { href: `${base}${base.includes('?') ? '&' : '?'}sort=${k}`, 'aria-current': sort === k ? 'page' : null, role: 'tab' }, icon(ic, 15), l)));
}
function query(sort) {
  let q = sb.from('feed').select('*');
  if (sort === 'new') q = q.order('created_at', { ascending: false });
  else if (sort === 'top') q = q.gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).order('score', { ascending: false }).order('created_at', { ascending: false });
  else if (sort === 'reports') q = q.eq('counts_for_signal', true).order('created_at', { ascending: false });
  else q = q.order('hot', { ascending: false });
  return q.limit(40);
}
function composerBar(cid = '') {
  const sp = cid ? spaceOf(cid) : null;
  return h('div', { class: 'card composer-bar' },
    emblem(S.card?.level || 1, 36),
    h('a', { class: 'fake', href: `#/new${cid ? `?c=${encodeURIComponent(cid)}` : ''}`, role: 'button' }, sp ? `Share how ${sp.name} went for you…` : 'Share how it went for you…'),
    h('a', { class: 'btn ink sm', href: `#/new${cid ? `?c=${encodeURIComponent(cid)}` : ''}` }, icon('plus', 16), 'Post'));
}

let stopNewPosts = null;
function newPostsPill(list, matcher, reload) {
  stopNewPosts?.();
  const box = h('div', { class: 'newposts hide' });
  let n = 0;
  stopNewPosts = on('post', (row) => {
    if (!row || row.author_id === S.me?.id || row.status !== 'visible' || !matcher(row)) return;
    n += 1;
    box.replaceChildren(h('button', { class: 'btn lime sm', type: 'button', onclick: () => { n = 0; box.classList.add('hide'); reload(); } }, icon('up', 16), `${n} new post${n === 1 ? '' : 's'}`));
    box.classList.remove('hide');
  });
  return box;
}

async function fillFeed(list, q, empty) {
  list.replaceChildren(h('div', { class: 'skel' }), h('div', { class: 'skel' }), h('div', { class: 'skel' }));
  const { data, error } = await q;
  if (error) { list.replaceChildren(h('div', { class: 'msg err' }, friendly(error))); return []; }
  const rows = (data || []).filter((p) => p.status === 'visible' || p.is_mine);
  list.replaceChildren(...(rows.length ? rows.map(postCard) : [empty]));
  return rows;
}

export async function renderHome(sort = 'hot') {
  const joined = S.spaces.filter((s) => s.joined);
  const list = h('div', {});
  const reload = () => fillFeed(list, joined.length ? query(sort).eq('in_my_spaces', true) : query(sort), emptyHome());
  render(
    S.me.status === 'suspended' ? h('div', { class: 'msg note' }, `Your account is paused until ${new Date(S.me.suspended_until).toLocaleString()}. You can read, but not post or comment.`) : null,
    h('div', { class: 'page-h' },
      h('div', {}, h('div', { class: 'kick' }, joined.length ? `// ${joined.length} space${joined.length === 1 ? '' : 's'} you follow` : '// Everything, until you join spaces'), h('h1', {}, 'Your feed.')),
      h('p', { class: 'cap' }, 'First-hand reports, read by Miracle AI into the Community Signal.')),
    composerBar(), sortbar('#/home', sort),
    newPostsPill(list, (row) => !joined.length || joined.some((s) => s.compound_id === row.compound_id), reload),
    list);
  setRail(await railCards('home'));
  await reload();
}
function emptyHome() {
  return h('div', { class: 'empty card' }, sig(72, 'curious'), h('p', {}, 'Nothing here yet. Join a few spaces, or be the first to share how it went.'),
    h('div', { class: 'row' }, h('a', { class: 'btn lime sm', href: '#/explore' }, 'Explore spaces'), h('a', { class: 'btn sm', href: '#/new' }, 'Share yours')));
}

export async function renderPopular(sort = 'hot') {
  const list = h('div', {});
  const reload = () => fillFeed(list, query(sort), emptyHome());
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, '// Every space'), h('h1', {}, 'Popular.')),
      h('p', { class: 'cap' }, 'What the whole community is reading and backing up right now.')),
    sortbar('#/popular', sort), newPostsPill(list, () => true, reload), list);
  setRail(await railCards('popular'));
  await reload();
}

export async function renderSpace(cid, sort = 'hot') {
  const sp = spaceOf(cid);
  if (!sp) { render(h('div', { class: 'empty card' }, sig(72, 'curious'), h('p', {}, 'That space doesn’t exist.'), h('a', { class: 'btn sm', href: '#/explore' }, 'Explore spaces'))); return; }
  const list = h('div', {});
  const base = `#/s/${encodeURIComponent(cid)}`;
  const reload = () => fillFeed(list, query(sort).eq('compound_id', cid), h('div', { class: 'empty card' }, sig(72, 'curious'),
    h('p', {}, `No posts in s/${sp.name} yet. The first first-hand report here earns the Pioneer badge.`), h('a', { class: 'btn lime sm', href: `#/new?c=${encodeURIComponent(cid)}` }, 'Share how it went')));
  const x = signalOf(cid);
  render(
    h('section', { class: 'hero' },
      h('div', { class: 'space-hero' },
        spaceTile(sp, 72),
        h('div', {}, h('div', { class: 'kick' }, `s/${sp.compound_id} · ${sp.category}`), h('h1', {}, `${sp.name}.`),
          h('p', { class: 'lede' }, `${fmtN(sp.members_count)} member${sp.members_count === 1 ? '' : 's'} · ${fmtN(sp.posts_week)} post${sp.posts_week === 1 ? '' : 's'} this week · ${fmtN(sp.reports)} first-hand report${sp.reports === 1 ? '' : 's'}`)),
        h('div', { class: 'join' }, joinButton(sp)))),
    signalCard(cid),
    x && x.themes && x.themes.length ? h('div', { class: 'post-chips mt12' }, h('span', { class: 'kick' }, 'What people mention'), x.themes.map((t) => h('span', { class: 'chip' }, `${t.theme} · ${t.label}`))) : null,
    h('div', { class: 'mt16' }, composerBar(cid)),
    sortbar(base, sort),
    newPostsPill(list, (row) => row.compound_id === cid, reload),
    list);
  setRail(await railCards('space', { cid }));
  await reload();
}

export async function renderExplore() {
  const filter = h('input', { class: 'input', type: 'search', placeholder: 'Find a space', 'aria-label': 'Find a space' });
  const box = h('div', {});
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, `// ${S.spaces.length} spaces`), h('h1', {}, 'Explore spaces.')),
      h('p', { class: 'cap' }, 'One space per compound. Join the ones you care about.')),
    filter, box);
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const groups = {};
    S.spaces.filter((s) => !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q))
      .forEach((s) => { (groups[s.category] ||= []).push(s); });
    box.replaceChildren(...Object.keys(groups).sort().map((cat) => [
      h('div', { class: 'kick cat-h' }, cat),
      h('div', { class: 'space-grid' }, groups[cat].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map((s) => h('a', { class: 'card space-card', href: `#/s/${encodeURIComponent(s.compound_id)}` },
        h('div', { class: 'top' }, spaceTile(s, 36), h('b', { class: 'grow' }, s.name)),
        h('div', { class: 'row between' }, s.score != null ? h('span', { class: 'sc num', 'data-sig-of': s.compound_id }, fmt1(s.score)) : h('span', { class: 'kick' }, 'No Signal yet'), s.score != null ? movement(signalOf(s.compound_id)) : null),
        h('div', { class: 'meta' }, h('span', {}, `${plural(s.members_count, 'member')} · ${plural(s.reports, 'report')}`), joinButton(s)))))]).flat());
  };
  filter.addEventListener('input', draw);
  draw();
  setRail(await railCards('explore'));
}

// ---------------------------------------------------------------------------
// New post
// ---------------------------------------------------------------------------
export function compoundSelect(selected, id = 'compound') {
  const groups = {};
  S.spaces.forEach((c) => { (groups[c.category] ||= []).push(c); });
  return h('select', { class: 'input', id, required: true },
    h('option', { value: '', disabled: true, selected: !selected }, 'Choose a space'),
    Object.keys(groups).sort().map((g) => h('optgroup', { label: g },
      groups[g].map((c) => h('option', { value: c.compound_id, selected: c.compound_id === selected }, `s/${c.name}`)))));
}

export function renderNew(cid = '') {
  if (S.me.status === 'suspended') { render(h('div', { class: 'msg note' }, 'Your account is paused, so you can’t post right now.')); return; }
  const msg = msgBox();
  const pick = compoundSelect(cid);
  const kindExp = h('input', { type: 'radio', name: 'kind', value: 'experience', checked: true });
  const kindQ = h('input', { type: 'radio', name: 'kind', value: 'question' });
  const title = h('input', { class: 'input', id: 'title', maxlength: 140, required: true, placeholder: 'e.g. Week 6 on BPC-157 for a knee injury' });
  const body = h('textarea', { class: 'input', id: 'body', maxlength: 10000, required: true, placeholder: 'What you took it for, how long, and how it compares to before you started: better, about the same, or worse. Side effects too.' });
  const go = h('button', { class: 'btn lime', type: 'submit' }, 'Post');
  const hint = h('div', { class: 'rules-note' }, sig(40, 'think'), h('div', {},
    h('b', {}, 'Miracle AI reads every report into the Signal. '),
    'Say how it compares to before you started, and for how long. A report that says it didn’t work counts just as much (and earns the same 40 points). No sourcing or sellers (rule 1), and don’t tell others what to take (rule 2).'));
  const updateHint = () => { hint.classList.toggle('hide', kindQ.checked); };
  kindExp.addEventListener('change', updateHint); kindQ.addEventListener('change', updateHint);
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, '// New post'), h('h1', {}, 'Share how it went.'))),
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        if (!pick.value) return say(msg, 'Choose a space.');
        go.disabled = true; say(msg, '');
        const kind = kindQ.checked ? 'question' : 'experience';
        const { data, error } = await sb.from('posts')
          .insert({ compound_id: pick.value, kind, title: title.value.trim(), body: body.value.trim() })
          .select('id,status');
        go.disabled = false;
        if (error) return say(msg, friendly(error));
        track('post', { kind });
        S.mine.add(data[0].id);
        afterEarn(go);
        location.hash = `#/post/${encodeURIComponent(data[0].id)}`;
      },
    },
    h('label', { class: 'f', for: 'compound' }, h('span', {}, 'Space'), pick),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Kind of post' },
      h('label', {}, kindExp, 'My experience'), h('label', {}, kindQ, 'A question')),
    h('label', { class: 'f', for: 'title' }, h('span', {}, 'Title'), title),
    h('label', { class: 'f', for: 'body' }, h('span', {}, 'Post'), body),
    hint,
    h('div', { class: 'row end mt16' }, h('a', { class: 'btn ghost', href: '#/home' }, 'Cancel'), go), msg));
  setRail([]);
  railCards('quests').then(setRail);
}

export { bar, nameOf };
