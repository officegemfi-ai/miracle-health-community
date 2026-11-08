// What the screen does when the database announces a change (app/events.js): a Signal moved, so
// the numbers tick, the moves card gets it, Sig mentions it now and then (yours and your spaces'
// first, not every one) and the season's count follows; or a notification came in, so a toast,
// and for the big ones a celebration. app.js wires these once at start.
import { h, toast } from './dom.js';
import { CAUSE, delta } from '../core/signal.js';
import * as Notifications from '../data/notifications.js';
import { on } from '../app/events.js';
import { S, signalOf, spaceOf } from '../app/store.js';
import { loadCard, loadUnread } from '../app/session.js';
import { renderTop, sigSay } from './shell.js';
import { refreshSignal } from './components/signal.js';
import { addMove } from './components/moves.js';
import { afterEarn, refreshMeCards, refreshSeason, levelUp } from './components/game.js';
import { notifParts, setUnread } from './components/notifications.js';

let lastSaid = 0;

export function wireLive() {
  on('signal', async (row) => {
    const moved = await refreshSignal();
    if (!row || row.version <= 1) return;
    const x = signalOf(row.compound_id);
    const was = moved?.find((m) => m.compound_id === row.compound_id);
    if (x) addMove({ compound_id: x.compound_id, compound_name: x.compound_name, delta: delta(x), score: x.score, cause: row.cause, computed_at: new Date().toISOString() });
    const mine = spaceOf(row.compound_id)?.joined;
    if (row.cause_post && S.mine.has(row.cause_post)) return;   // the author hears about it from the read itself
    if (was && !document.hidden && (mine ? Date.now() - lastSaid > 45000 : Date.now() - lastSaid > 120000)) {
      lastSaid = Date.now();
      sigSay([h('b', {}, x.compound_name), ` just moved ${delta(x) > 0 ? '▲' : '▼'} ${Math.abs(delta(x)).toFixed(1)} after ${CAUSE[row.cause] || 'new reports'}.`], 'watching', 3800);
    }
  });

  // The season's count follows every report the moment it counts, on every screen
  on('signal', () => refreshSeason());

  on('notification', async (n) => {
    if (!n || n.read_at) return;
    const { data } = await Notifications.byId(n.id);
    const row = data && data[0];
    if (!row) return;
    loadUnread().then((c) => setUnread(c));
    if (row.kind === 'level_up') { await loadCard(); renderTop(); refreshMeCards(); levelUp(row.data); return; }
    if (row.kind === 'counted') {
      const diff = await afterEarn(null);
      const [, text] = notifParts(row);
      sigSay([text, diff > 0 ? [' ', h('b', {}, `+${diff} points.`)] : ''], 'cheer', 7000, true);
      document.dispatchEvent(new CustomEvent('mh:read', { detail: row.post_id }));
      return;
    }
    const [art, text] = notifParts(row);
    toast(text, { art, onclick: () => { location.hash = notifParts(row)[3]; } });
    if (row.kind === 'badge' || row.kind === 'same_for_me' || row.kind === 'milestone') afterEarn(null);
    // A moderator acted on one of your posts: an open page of it redraws, and points may have moved
    if (row.kind === 'mod' && row.post_id) {
      document.dispatchEvent(new CustomEvent('mh:post', { detail: row.post_id }));
      afterEarn(null);
    }
  });
}
