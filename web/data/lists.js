// The three lists shipped with the app and read before anything else: the community rules, what
// members take things for (and the twelve goals), and how many improve on a placebo in trials.
// Each is null when it can't be read.
export function loadLists() {
  return Promise.all([
    fetch('rules.json').then((r) => r.json()).catch(() => null),
    fetch('uses.json').then((r) => r.json()).catch(() => null),
    fetch('baselines.json').then((r) => r.json()).catch(() => null),
  ]);
}
