// Quests: the season, your quests, the community's goals, and how points work.
import { h } from '../dom.js';
import * as Members from '../../data/members.js';
import { S } from '../../app/store.js';
import { render, setRail } from '../shell.js';
import { railCards } from '../rail.js';
import { questBox, seasonCard, refreshQuests, goalRow } from '../components/game.js';

export async function renderQuests() {
  const weekly = questBox(99);
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, 'Build the Signal'), h('h1', {}, 'Quests.')),
      h('p', { class: 'cap' }, 'Every report, “same for me” and reply makes the numbers more accurate.')),
    seasonCard(true),
    h('h2', {}, 'Your quests'), h('section', { class: 'card' }, weekly),
    h('h2', {}, 'Community goals'),
    h('p', { class: 'small muted' }, 'Shared goals: unlock a compound’s first Signal, or bring a Signal past half from this community’s own reports.'),
    h('section', { class: 'card', id: 'goals' }, h('p', { class: 'muted' }, 'Loading…')),
    h('h2', {}, 'How points work'),
    h('section', { class: 'card ledger' }, Object.values(S.pointRules).filter((r) => r.points > 0).sort((a, b) => b.points - a.points)
      .map((r) => h('div', {}, h('span', {}, r.label), h('b', {}, `+${r.points}`)))));
  refreshQuests();
  setRail(await railCards('quests'));
  const { data } = await Members.goals(12);
  const goals = document.getElementById('goals');
  if (goals) goals.replaceChildren(...((data || []).length ? data.map(goalRow) : [h('p', { class: 'muted' }, 'Every goal is done. Wow.')]));
}
