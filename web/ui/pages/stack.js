// Find your stack: pick what you take, and see that exact stack's Signal, every stack and blend with
// them in it, how each does on its own, and the posts with all of them.
import { h, icon } from '../dom.js';
import { sig, spaceTile } from '../art.js';
import { fmt1, plural } from '../../core/format.js';
import { familyLabel, findStack, stackName, containing, idsFrom } from '../../core/library.js';
import * as Posts from '../../data/posts.js';
import { track } from '../../data/telemetry.js';
import { S, spaceOf, signalOf } from '../../app/store.js';
import { render, setRail } from '../shell.js';
import { railCards } from '../rail.js';
import { sigNum, movement } from '../components/signal.js';
import { compoundPicker, suggestCompound } from '../components/picker.js';
import { sortbar, fillFeed } from '../components/feed.js';

function entryRow(sp, extra) {
  const x = signalOf(sp.compound_id);
  return h('a', { class: 'card lib-row', href: `#/s/${encodeURIComponent(sp.compound_id)}` },
    spaceTile(sp, 34),
    h('span', { class: 'grow' }, h('b', {}, sp.name),
      h('span', { class: 'xs muted' }, [familyLabel(sp), plural(sp.reports || 0, 'report'), plural(sp.members_count || 0, 'member')].join(' · '))),
    extra || null,
    x && x.score != null ? h('span', { class: 'sc num', 'data-sig-of': sp.compound_id }, fmt1(x.score)) : h('span', { class: 'kick' }, 'No Signal yet'),
    x && x.score != null ? movement(x) : null);
}

export async function renderStack(param = '', sort = 'new') {
  let ids = idsFrom(S.spaces, param);
  const results = h('div', {});
  const list = h('div', {});
  const picker = compoundPicker({
    selected: ids, id: 'stack-search', placeholder: 'Add what you take: BPC-157, Ozempic, creatine…',
    onChange: (next) => {
      ids = next;
      history.replaceState(null, '', ids.length ? `#/stack?c=${ids.map(encodeURIComponent).join(',')}${sort !== 'new' ? `&sort=${sort}` : ''}` : '#/stack');
      draw();
    },
  });
  const draw = async () => {
    if (!ids.length) {
      results.replaceChildren(h('div', { class: 'empty card' }, sig(72, 'curious'),
        h('p', {}, 'Add the compounds you take. You’ll see that exact stack’s Signal, every stack and blend with them in it, and how each one does on its own.')));
      list.replaceChildren();
      return;
    }
    const picked = ids.map(spaceOf).filter(Boolean);
    const exact = ids.length === 1 ? picked[0] : findStack(S.spaces, ids);
    const share = `#/new?c=${ids.map(encodeURIComponent).join(',')}`;
    const xs = exact ? signalOf(exact.compound_id) : null;
    const top = h('section', { class: 'card stack-hit' },
      h('div', { class: 'kick' }, ids.length === 1 ? 'On its own' : 'This exact stack'),
      exact
        ? h('div', { class: 'row nw mt8' }, spaceTile(exact, 44),
          h('div', { class: 'grow' }, h('h2', {}, exact.name), h('div', { class: 'xs muted' }, `${plural(exact.reports || 0, 'first-hand report')} · ${plural(exact.members_count || 0, 'member')}`)),
          xs && xs.score != null ? h('div', { class: 'big-sc' }, sigNum(exact.compound_id), h('span', { class: 'kick' }, 'Signal'))
            : h('div', { class: 'xs muted right' }, `${Math.max(0, 3 - (exact.reports || 0))} more report${3 - (exact.reports || 0) === 1 ? '' : 's'} unlock its Signal`))
        : h('div', { class: 'mt8' }, h('h2', {}, stackName(S.spaces, ids)), h('p', { class: 'muted' }, 'Nobody has posted this exact stack yet. Be the first: your report starts its space and, with two more, its own Signal.')),
      h('div', { class: 'row mt12' },
        exact ? h('a', { class: 'btn sm', href: `#/s/${encodeURIComponent(exact.compound_id)}` }, ids.length === 1 ? 'Open its space' : 'Open the stack') : null,
        h('a', { class: 'btn lime sm', href: share }, icon('plus', 16), ids.length === 1 ? 'Share how it went' : 'Share how this stack went')));
    const others = containing(S.spaces, ids);
    results.replaceChildren(...[top,
      others.length ? h('section', { class: 'mt16' }, h('div', { class: 'kick cat-h' }, `Stacks and blends with ${ids.length === 1 ? 'it' : 'all of them'} in it · ${others.length}`),
        h('div', { class: 'lib-list' }, others.slice(0, 12).map((sp) => entryRow(sp)))) : null,
      ids.length > 1 ? h('section', { class: 'mt16' }, h('div', { class: 'kick cat-h' }, 'Each one on its own'),
        h('div', { class: 'lib-list' }, picked.map((sp) => entryRow(sp)))) : null,
      h('div', { class: 'kick cat-h mt16' }, `Posts with ${ids.length === 1 ? 'it' : 'all of them'}`),
      sortbar(`#/stack?c=${ids.map(encodeURIComponent).join(',')}`, sort)].filter(Boolean));
    await fillFeed(list, Posts.feed(sort, { parts: ids }), h('div', { class: 'empty card' }, sig(72, 'curious'),
      h('p', {}, 'No posts with these yet.'), h('a', { class: 'btn lime sm', href: share }, 'Be the first')));
  };
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, '// Find your stack'), h('h1', {}, 'Search the stack you run.')),
      h('p', { class: 'cap' }, 'Peptides, hormones, supplements and blends: add yours, see what people report.')),
    h('div', { class: 'card' }, h('label', { class: 'f nm', for: 'stack-search' }, h('span', {}, 'What you take'), picker),
      h('p', { class: 'xs muted' }, 'Can’t find something? ', h('button', { class: 'lnk', type: 'button', onclick: () => suggestCompound() }, 'Suggest it for the library'), '.')),
    results, list);
  setRail(await railCards('explore'));
  track('stack_search', { n: ids.length });
  await draw();
}
