// What the app knows right now: who's signed in, the spaces, the Signal, the reference lists, the
// quests and the unread count. One object (S): the loaders in app/session.js fill it, the screens
// read it, and the questions below are asked of it everywhere. No page, no network.
import { readyToClaim } from '../core/game.js';

export const S = {
  session: null,
  me: null,          // from me(): id, handle, role, status...
  card: null,        // member_cards row for me: points, level, streak, badges
  spaces: [],        // every compound as a space, with members, joined, score
  signal: [],        // signal_board
  history: new Map(),// compound_id -> [scores by version]
  rules: null,
  uses: null,          // shared/uses.json: what members take things for, and the twelve goals
  baselines: null,     // shared/baselines.json: how many improve on a placebo in trials, by use
  levels: [],
  badges: [],
  pointRules: {},
  pulse: null,
  quests: [],        // my_quests: this week's and the one-off quests, with how far along each is
  unread: 0,
  mine: new Set(),   // posts written in this session, so Sig doesn't announce your own moves twice
};

export const isMod = () => !!S.me && ['moderator', 'admin'].includes(S.me.role);
export const spaceOf = (cid) => S.spaces.find((s) => s.compound_id === cid) || null;
export const signalOf = (cid) => S.signal.find((x) => x.compound_id === cid) || null;
export const nameOf = (cid) => spaceOf(cid)?.name || signalOf(cid)?.compound_name || cid;
export const levelOf = (n) => S.levels.find((l) => l.n === n) || { n, name: 'Spark', tier: 'Signal', min_points: 0 };
// What a use is called
export const useLabel = (id) => S.uses?.uses?.find((u) => u.id === id)?.label || String(id).replace(/_/g, ' ');
// How many people improve on a placebo in trials, for a use (shared/baselines.json, with sources)
export function baselineOf(use) {
  return (S.baselines?.uses || []).find((b) => b.use === use && b.placebo_pct != null) || null;
}
// Quests done and waiting to be claimed
export const claimable = () => readyToClaim(S.quests);

export function setSession(session) { S.session = session; }
export function setUnreadCount(n) { S.unread = n; }
// A post written here, so its own Signal move isn't announced back to its author
export function noteMine(postId) { S.mine.add(postId); }
