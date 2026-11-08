// Miracle Health Community · web app
// Plain JavaScript modules, no build step. It talks to Supabase with the public key only; who can
// see or change what is enforced by the database, not here.
//
// This file puts the app together and starts it. The code is in four layers, each importing only
// from the ones listed before it (docs/web-architecture.md; scripts/check_layers.mjs checks it):
//   core/  the rules: pure functions, no page, no network, no store
//   data/  the only code that reaches Supabase, the network, storage and analytics
//   app/   what the app knows (the store), the use cases that fill it, and live news
//   ui/    the page: the frame, the rail, components, pages and the router
// kit/ is Miracle Health's design kit, shared with the website (scripts/sync_kit.sh).
import { C } from './data/config.js';
import { connect } from './data/client.js';
import * as Auth from './data/auth.js';
import { startTelemetry } from './data/telemetry.js';
import { S, setSession } from './app/store.js';
import { loadLists } from './app/session.js';
import { mountShell, renderFooter } from './ui/shell.js';
import { wireLive } from './ui/live.js';
import { route, startRouter } from './ui/router.js';
import { enter } from './ui/enter.js';
import { unlock } from './ui/pages/gate.js';
import { enterPreview } from './ui/pages/auth.js';
import { onboarding } from './ui/pages/onboarding.js';

async function boot() {
  mountShell();
  wireLive();
  startRouter();
  startTelemetry(C);
  await loadLists();
  renderFooter();
  const key = await unlock();
  connect(C.supabaseUrl, key);
  const { data } = await Auth.session();
  setSession(data.session);
  Auth.onChange(setSession);
  if (!S.session && C.demo && C.skipSignIn && await enterPreview()) {
    location.hash = '#/home';
    await route();
    onboarding();
    return;
  }
  if (S.session) await enter();
  await route();
}
boot();
