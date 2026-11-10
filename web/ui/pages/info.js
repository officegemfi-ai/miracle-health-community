// The community rules, and how it works.
import { h } from '../dom.js';
import { sig, emblem } from '../art.js';
import { fmtN } from '../../core/format.js';
import { S } from '../../app/store.js';
import { render, setRail } from '../shell.js';
import { railCards } from '../rail.js';
import { seal } from '../components/signal.js';
import { LEVELS } from '../../kit/signalviz.js';

export function renderRules(standalone = false) {
  const R = S.rules;
  if (!R) { render(h('p', { class: 'pad' }, 'The rules couldn’t load. Refresh to try again.')); return; }
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, `Version ${R.version}`), h('h1', {}, 'Community rules.'))),
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
      h('div', { class: 'kick' }, 'How it works'),
      h('h1', {}, 'Built by the people who take it.'),
      h('p', { class: 'lede' }, 'Members share what happened when they took something: what for, how long, and whether things were better, the same or worse than before. Sig reads each report into the Community Signal, one number per compound. The more people share, the more accurate it gets.')),
    h('h2', {}, 'The Community Signal'),
    h('section', { class: 'card' },
      h('p', {}, 'Each compound gets a number from 0 to 100:'),
      h('div', { class: 'ledger' },
        h('div', {}, h('span', {}, 'What happened: how often people report things got better'), h('b', {}, '65%')),
        h('div', {}, h('span', {}, 'Agreement: how much the reports agree'), h('b', {}, '15%')),
        h('div', {}, h('span', {}, 'Voices: how many independent voices there are'), h('b', {}, '10%')),
        h('div', {}, h('span', {}, 'Volume: how much there is to go on'), h('b', {}, '10%'))),
      h('p', { class: 'small muted mt12' }, 'It starts from what people say on public forums, and moves toward this community’s own first-hand reports as they add up. New accounts count half, so a wave of fresh accounts can’t push a number around. Every change is kept as a new version, and the math runs in the database, never in this page.')),
    h('h2', {}, 'Rated by use'),
    h('section', { class: 'card' },
      h('p', {}, 'People take the same thing for different reasons, and it can work for one and not another. So each compound also gets a rating per use: joint pain, injury healing, sleep, fat loss and so on. Sig reads what each report says it was for, up to three uses, and how each went.'),
      h('p', { class: 'small muted mt12' }, 'A use gets its own 0 to 100 rating once three first-hand reports name it, and it comes from members alone: the public forums don’t rate uses, so next to each one you see only how often the forums mention it. If you correct how your report went, each use follows your answer.')),
    h('h2', {}, 'Certification'),
    h('section', { class: 'card' },
      h('p', {}, `Public forums count as ${S.pulse?.external_weight ?? 50} reports for each compound. As members’ first-hand reports add up, each Signal earns a level:`),
      h('div', { class: 'ledger levels' }, LEVELS.map((l) => h('div', {}, h('span', { class: 'row nw' }, seal(l.key, 26, true), h('span', {}, h('strong', {}, l.name), ` · ${l.rule}`))))),
      h('p', { class: 'small muted mt12' }, 'Each space also shows how first-hand reports split (better, about the same or worse), with a 95% interval for “better” so you can see how sure that share is, and the side effects members mention.')),
    h('h2', {}, 'Sig’s read'),
    h('section', { class: 'card row nw' }, sig(64, 'watching'),
      h('p', {}, 'When you post an experience, Sig reads it: is it first-hand, did it go better, the same or worse, for how long, any side effects. That read feeds the Signal. You can confirm or correct it on your post, and your word wins.')),
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
