// The Community Signal's words and arithmetic: how a report went, why people stopped, what moved a
// number and by how much, and where the public data came from. Pure.

export const OUTCOME = { better: ['Better', 'pos'], same: ['About the same', 'neu'], worse: ['Worse', 'neg'] };

// Why people stopped, from their check-ins
export const STOPPED = {
  done: 'It worked, I’m done', no_effect: 'It didn’t help', side_effects: 'Side effects', cost: 'Cost or hassle', other: 'Something else',
};

// Where anyone in the US can report a serious reaction to the FDA
export const MEDWATCH = 'https://www.fda.gov/safety/medwatch-fda-safety-information-and-adverse-event-reporting-program';

// What moved a number, in the words the moves card and Sig use
export const CAUSE = {
  report: 'a first-hand report', same: 'a “same for me”', removed: 'a post taken down', restored: 'a post restored',
  edit: 'a report edited', deleted: 'a report deleted',
};

// How much a Signal moved at its last version (0 when it hasn't, or has no number yet)
export const delta = (s) => (s && s.prev_score != null && s.score != null ? Math.round((s.score - s.prev_score) * 10) / 10 : 0);

// The forums' word for how often they mention a use
export const FORUM_WORD = { 'Very common': 'very common', Common: 'common', Mixed: 'mixed', Occasional: 'occasional' };

// Where the public data came from, grouped the way the picture shows it
const FAMILY = { Reddit: 'Reddit', YouTube: 'YouTube', 'YouTube index': 'YouTube', 'Podcast / YouTube': 'Podcasts' };
export function sourceFamilies(rows) {
  const count = new Map();
  rows.forEach((x) => {
    const fams = new Set((x.source_families || []).map((f) => FAMILY[f] || 'Forums & reviews'));
    fams.forEach((f) => count.set(f, (count.get(f) || 0) + 1));
  });
  const order = ['Reddit', 'YouTube', 'Podcasts', 'Forums & reviews'];
  return order.map((name) => ({ name, n: count.get(name) || 0 }));
}
