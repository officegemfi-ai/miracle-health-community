// The rules of the game as the app shows them (the points and emblems themselves come from the
// database): progress toward the next emblem, quests ready to claim, the season. Pure.

// The emblem after level n, if there is one
export const nextLevel = (levels, n) => levels.find((l) => l.n === n + 1);
// How far from this emblem to the next, 0 to 100 (100 at the last one)
export const progressPct = (lv, next, points) => (next ? (100 * (points - lv.min_points)) / (next.min_points - lv.min_points) : 100);

// Quests that are done and not yet claimed
export const readyToClaim = (quests) => quests.filter((q) => q.have >= q.need && !q.claimed).length;
// Quests in the order a list shows them: unclaimed first, then the ones done, then their own order
export const questOrder = (quests) => [...quests].sort((a, b) => (a.claimed - b.claimed) || ((b.have >= b.need) - (a.have >= a.need)) || a.sort - b.sort);

// How far along the season is, 0 to 100
export const seasonPct = (p) => Math.min(100, (100 * p.season_reports) / (p.season_goal || 1));
// Days left in a season that ends on a date (yyyy-mm-dd), its last day included
export const daysLeft = (ends, now = Date.now()) => Math.max(0, Math.ceil((new Date(`${ends}T23:59:59Z`) - now) / 86400000));
// This month's name, as the Signal Builders board is titled
export const monthName = (d = new Date()) => d.toLocaleDateString('en-US', { month: 'long' });
