// Home (the spaces you follow, or everything until you join some) and Popular (every space).
import { h } from '../dom.js';
import { partsOf } from '../../core/posts.js';
import * as Posts from '../../data/posts.js';
import { S } from '../../app/store.js';
import { render } from '../shell.js';
import { fillRail } from '../rail.js';
import { sortbar, fillFeed, composerBar, newPostsPill, emptyHome } from '../components/feed.js';
import { dueCheckin } from '../components/checks.js';

export async function renderHome(sort = 'hot') {
  const joined = S.spaces.filter((s) => s.joined);
  const list = h('div', {});
  const reload = () => fillFeed(list, Posts.feed(sort, { mySpaces: joined.length > 0 }), emptyHome());
  // A check-in that's due (2, 6 or 12 weeks after one of your reports) comes first
  const due = h('div', { class: 'due' });
  const drawDue = () => { if (S.me.status !== 'suspended') dueCheckin(() => setTimeout(drawDue, 3500)).then((box) => due.replaceChildren(box || '')); };
  drawDue();
  render(
    S.me.status === 'suspended' ? h('div', { class: 'msg note' }, `Your account is paused until ${new Date(S.me.suspended_until).toLocaleString()}. You can read, but not post or comment.`) : null,
    // The feed opens the way miraclehealth.us does: words on a plate, no photograph
    h('section', { class: 'feed-hero' },
      h('div', {},
        h('div', { class: 'kick' }, joined.length ? `${joined.length} space${joined.length === 1 ? '' : 's'} you follow` : 'Everything, until you join spaces'),
        h('h1', {}, 'Your feed.'),
        h('p', { class: 'feed-hero-cap' }, 'What members took and how it went. Sig reads each report into the Community Signal.'),
        h('p', { class: 'log-cap', 'aria-hidden': 'true' }, `log ${joined.length ? '--my-spaces' : '--all-spaces'} · each report is a commit; Sig’s read is its check`))),
    due, composerBar(), sortbar('#/home', sort),
    newPostsPill(list, (row) => !joined.length || partsOf(row).some((id) => joined.some((s) => s.compound_id === id)), reload),
    list);
  await Promise.all([fillRail('home'), reload()]);
}

export async function renderPopular(sort = 'hot') {
  const list = h('div', {});
  const reload = () => fillFeed(list, Posts.feed(sort), emptyHome());
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, 'Every space'), h('h1', {}, 'Popular.')),
      h('p', { class: 'cap' }, 'What the whole community is reading and backing up right now.')),
    sortbar('#/popular', sort), newPostsPill(list, () => true, reload), list);
  await Promise.all([fillRail('popular'), reload()]);
}
