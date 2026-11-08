// How a space's compounds work in the body: the kit's body map, loaded from the Library. A
// compound's space shows its own lines; a stack's or a blend's lines its parts up side by side,
// with where they meet marked. While it loads it says so; if it can't, it offers to try again;
// and when none of them is drawn yet, the card leaves the page.
import { h } from '../dom.js';
import { mountBodyMap } from '../../kit/bodymap.js';
import { libraryLink } from '../../kit/kit.js';
import * as Library from '../../data/library.js';
import { spaceOf } from '../../app/store.js';

export function bodyCard(sp, { single = true } = {}) {
  const ids = single ? [sp.compound_id] : (sp.part_ids || []).slice(0, 6);
  if (!ids.length) return null;
  const names = Object.fromEntries(ids.map((id) => [id, spaceOf(id)?.name || id]));
  const box = h('div', {});
  const card = h('section', { class: 'card body-card mt12', 'aria-labelledby': 'body-card-h' },
    h('h2', { class: 'kick', id: 'body-card-h' }, ids.length > 1 ? 'How they work in the body' : 'How it works in the body'),
    box);
  mountBodyMap(box, {
    ids, names, load: Library.body, id: 'body-map',
    sourceHref: (id, n) => `${libraryLink(id)}#src-${n}`,
    note: 'From the Library’s fact sheets, each line with its source. Education, not medical advice.',
    // Nothing drawn for any of them: no card
    onState: (state) => { if (state === 'ready' && !box.querySelector('.mh-bm-ln')) card.remove(); },
  });
  return card;
}
