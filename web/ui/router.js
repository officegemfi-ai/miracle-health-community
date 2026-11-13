// Routing: each #/link to its page, with the frame (menu, tabs) marking where you are. Signed out,
// a link waits (ui/next.js) while you sign in; an invite link keeps its invite.
import { h } from './dom.js';
import { sig } from './art.js';
import { parseHash } from '../core/routes.js';
import { connected } from '../data/client.js';
import { saveInvite } from '../data/storage.js';
import { track } from '../data/telemetry.js';
import { S, isMod } from '../app/store.js';
import { render, renderNav, renderTabbar, closeDrawer, setWindow } from './shell.js';
import { current } from './current.js';
import { rememberNext } from './next.js';
import { renderGuestDraft, renderSignIn, renderSignup } from './pages/auth.js';
import { renderHome, renderPopular } from './pages/home.js';
import { renderSpace } from './pages/space.js';
import { renderExplore } from './pages/explore.js';
import { renderNew } from './pages/new-post.js';
import { renderStack } from './pages/stack.js';
import { renderPost } from './pages/post.js';
import { renderSignalPage } from './pages/signal.js';
import { renderProfile } from './pages/profile.js';
import { renderBuilders } from './pages/builders.js';
import { renderQuests } from './pages/quests.js';
import { renderNotifications } from './pages/notifications.js';
import { renderMod } from './pages/moderation.js';
import { renderRules, renderHow } from './pages/info.js';
import { renderAccount } from './pages/account.js';

let routing = 0;
export async function route() {
  if (!connected()) return;
  const n = ++routing;
  const r = parseHash(location.hash);
  closeDrawer();
  if (r.name === 'join' && r.arg) {
    saveInvite(r.arg.toUpperCase());
  }
  if (r.name === 'rules' && !S.me) { setWindow(r); document.body.classList.add('auth'); return renderRules(true); }
  if (!S.session || !S.me) rememberNext();
  if (!S.session && r.name === 'new') { setWindow(r); return renderGuestDraft(r.q.get('c') || '', r.q.get('d') || '', route); }
  if (!S.session) { setWindow(r, 'sign-in'); return renderSignIn(route); }
  if (!S.me) { setWindow(r, 'join'); return renderSignup(route); }
  document.body.classList.remove('auth');
  setWindow(r);

  // Old links
  if (r.name === 'feed') { location.replace(r.q.get('c') ? `#/s/${encodeURIComponent(r.q.get('c'))}` : '#/home'); return; }
  const sort = r.q.get('sort') || 'hot';
  Object.assign(current, { name: r.name, cid: r.name === 's' ? r.arg : '' });
  let navKey = r.name;
  const pages = {
    home: () => renderHome(sort),
    popular: () => renderPopular(sort),
    signal: () => renderSignalPage(),
    explore: () => renderExplore(r.q.get('f') || ''),
    stack: () => renderStack(r.q.get('c') || '', r.q.get('sort') || 'new'),
    builders: () => renderBuilders(),
    quests: () => renderQuests(),
    notifications: () => renderNotifications(),
    new: () => renderNew(r.q.get('c') || '', r.q.get('d') || ''),
    me: () => { location.replace(`#/u/${encodeURIComponent(S.me.handle)}`); },
    s: () => { current.name = 'space'; navKey = ''; return renderSpace(r.arg, sort, r.q.get('only') || 'all'); },
    post: () => { navKey = ''; return renderPost(r.arg, { edit: r.q.get('edit') === '1', focus: r.q.get('c') }); },
    u: () => { navKey = r.arg === S.me.handle ? 'me' : ''; return renderProfile(r.arg, r.q.get('t') || 'posts'); },
    how: () => renderHow(),
    rules: () => renderRules(),
    account: () => renderAccount(),
    mod: () => (isMod() ? renderMod(r.arg || 'queue') : (location.hash = '#/home')),
    join: () => { location.replace('#/home'); },
  };
  const page = pages[r.name] || pages.home;
  if (!pages[r.name]) current.name = 'home';
  renderNav(navKey === 'u' ? '' : (pages[r.name] ? navKey : 'home'), current.cid);
  renderTabbar(navKey === 'u' ? '' : navKey);
  // the screen Create opens has its own main action, so Create steps back there
  document.querySelector('.top-actions .create')?.setAttribute('aria-current', r.name === 'new' ? 'page' : 'false');
  track('screen', { screen: current.name });
  try {
    await page();
  } catch (e) {
    if (n !== routing) return;
    console.error(e);
    render(h('div', { class: 'empty card' }, sig(72, 'concerned'), h('p', {}, 'Something went wrong loading this page.'), h('button', { class: 'btn sm', type: 'button', onclick: () => route() }, 'Try again')));
  }
}

export function startRouter() {
  window.addEventListener('hashchange', () => { route(); });
}
