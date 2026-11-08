// Into the community: load who's signed in and what every screen needs (app/session.js), then put
// up the frame around the pages (the top bar with the bell, the ticker, Sig) and start the live
// updates. Nothing happens when they haven't picked a handle yet.
import { S } from '../app/store.js';
import { loadMember, loadHistory, startLive } from '../app/session.js';
import { renderTop, renderNav, mountSig } from './shell.js';
import { renderTicker } from './components/signal.js';
import { setUnread } from './components/notifications.js';
import { refreshQuests } from './components/game.js';
import { current } from './current.js';
import { tipFor } from './tips.js';

export async function enter() {
  if (!(await loadMember())) return;
  document.body.classList.remove('auth');
  renderTop();
  setUnread(S.unread);
  renderTicker();
  mountSig(tipFor);
  startLive();
  refreshQuests().then(() => renderNav(current.name, current.cid));
  loadHistory().then(renderTicker);
}
