// Writes config.js (public settings only) and the Content-Security-Policy for one
// environment into a built copy of the web app.
// Usage: node scripts/write_config.mjs <out_dir>
// Reads: SUPABASE_URL, SUPABASE_ANON_KEY, TURNSTILE_SITE_KEY, POSTHOG_KEY,
//        POSTHOG_HOST, SENTRY_DSN, CONTACT_EMAIL, PRIVACY_URL, ENVIRONMENT,
//        SITE_PASSWORD (optional: puts the whole site behind a password),
//        DEMO=1 (a preview build: the real database running in the browser with a
//        sample community; see web/preview/engine.js and scripts/build_preview.mjs)
import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
const E = process.env;
const demo = E.DEMO === '1';
if (!out || (!demo && (!E.SUPABASE_URL || !E.SUPABASE_ANON_KEY))) {
  console.error('Need an output folder, SUPABASE_URL and SUPABASE_ANON_KEY (or DEMO=1 for a preview)');
  process.exit(1);
}
const SUPABASE_URL = E.SUPABASE_URL || 'https://preview.invalid';
const SUPABASE_ANON_KEY = E.SUPABASE_ANON_KEY || 'preview';
const SENTRY_VERSION = '11.5.0';
const posthogHost = E.POSTHOG_HOST || 'https://us.i.posthog.com';
const posthogAssets = posthogHost.replace('://us.i.', '://us-assets.i.').replace('://eu.i.', '://eu-assets.i.');
const cfg = {
  environment: E.ENVIRONMENT || (demo ? 'preview' : 'live'),
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  turnstileSiteKey: E.TURNSTILE_SITE_KEY || '',
  posthogKey: E.POSTHOG_KEY || '',
  posthogHost,
  posthogAssets,
  sentryDsn: E.SENTRY_DSN || '',
  contactEmail: E.CONTACT_EMAIL || '',
  privacyUrl: E.PRIVACY_URL || '',
  sentryBundle: E.SENTRY_DSN ? `https://browser.sentry-cdn.com/${SENTRY_VERSION}/bundle.min.js` : '',
};
if (demo) cfg.demo = true;
if (E.SITE_PASSWORD) {
  // The public API key ships encrypted with the site password (PBKDF2 + AES-GCM),
  // so the app can't reach the community until someone types the password.
  // The salt is fixed per Supabase project, so a browser that knows the password
  // stays unlocked across deploys until the password changes.
  const iter = 600000;
  const salt = createHash('sha256').update(`miracle-health-gate|${SUPABASE_URL}`).digest().subarray(0, 16);
  const key = pbkdf2Sync(E.SITE_PASSWORD, salt, iter, 32, 'sha256');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(SUPABASE_ANON_KEY, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  cfg.gate = { iter, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') };
  cfg.supabaseAnonKey = '';
}
writeFileSync(join(out, 'config.js'), `window.MH_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`);

const origin = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const sentryIngest = cfg.sentryDsn ? `https://${new URL(cfg.sentryDsn).host}` : '';
const supa = origin(cfg.supabaseUrl);
const csp = [
  "default-src 'self'",
  `script-src 'self'${demo ? " 'wasm-unsafe-eval'" : ''}${cfg.turnstileSiteKey ? ' https://challenges.cloudflare.com' : ''}${cfg.posthogKey ? ` ${origin(posthogAssets)}` : ''}${cfg.sentryDsn ? ' https://browser.sentry-cdn.com' : ''}`,
  // Realtime runs over a websocket on the same host: wss:// for https://, ws:// for a local http:// one
  // and the Library's grades on the website (one public file, the same for every visitor)
  `connect-src 'self' ${supa} ${supa.replace(/^http/, 'ws')} https://miraclehealth.us${cfg.posthogKey ? ` ${origin(posthogHost)} ${origin(posthogAssets)}` : ''}${sentryIngest ? ` ${sentryIngest}` : ''}`,
  `frame-src${cfg.turnstileSiteKey ? ' https://challenges.cloudflare.com' : " 'none'"}`,
  "img-src 'self' data:",
  "style-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');
const indexPath = join(out, 'index.html');
let html = readFileSync(indexPath, 'utf8').replace('__CSP__', csp);
if (demo) {
  // Runs before app.js: it hands the app a client backed by the in-browser database
  html = html.replace('<!--preview-engine-->', '<script type="module" src="preview/engine.js"></script>');
} else {
  // Real builds never carry the preview
  html = html.replace('<!--preview-engine-->\n', '');
  rmSync(join(out, 'preview'), { recursive: true, force: true });
}
writeFileSync(indexPath, html);
console.log(`wrote config.js and CSP for ${cfg.environment}${demo ? ' (preview with sample posts)' : ''}${cfg.gate ? ', behind the site password' : ''}`);
