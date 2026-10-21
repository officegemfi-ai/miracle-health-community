// Writes config.js (public settings only) and the Content-Security-Policy for one
// environment into a built copy of the web app.
// Usage: node scripts/write_config.mjs <out_dir>
// Reads: SUPABASE_URL, SUPABASE_ANON_KEY, TURNSTILE_SITE_KEY, POSTHOG_KEY,
//        POSTHOG_HOST, SENTRY_DSN, CONTACT_EMAIL, PRIVACY_URL, ENVIRONMENT
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
const E = process.env;
if (!out || !E.SUPABASE_URL || !E.SUPABASE_ANON_KEY) {
  console.error('Need an output folder, SUPABASE_URL and SUPABASE_ANON_KEY');
  process.exit(1);
}
const SENTRY_VERSION = '11.5.0';
const posthogHost = E.POSTHOG_HOST || 'https://us.i.posthog.com';
const posthogAssets = posthogHost.replace('://us.i.', '://us-assets.i.').replace('://eu.i.', '://eu-assets.i.');
const cfg = {
  environment: E.ENVIRONMENT || 'live',
  supabaseUrl: E.SUPABASE_URL,
  supabaseAnonKey: E.SUPABASE_ANON_KEY,
  turnstileSiteKey: E.TURNSTILE_SITE_KEY || '',
  posthogKey: E.POSTHOG_KEY || '',
  posthogHost,
  posthogAssets,
  sentryDsn: E.SENTRY_DSN || '',
  contactEmail: E.CONTACT_EMAIL || '',
  privacyUrl: E.PRIVACY_URL || '',
  sentryBundle: E.SENTRY_DSN ? `https://browser.sentry-cdn.com/${SENTRY_VERSION}/bundle.min.js` : '',
};
writeFileSync(join(out, 'config.js'), `window.MH_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`);

const origin = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const sentryIngest = cfg.sentryDsn ? `https://${new URL(cfg.sentryDsn).host}` : '';
const supa = origin(cfg.supabaseUrl);
const csp = [
  "default-src 'self'",
  `script-src 'self'${cfg.turnstileSiteKey ? ' https://challenges.cloudflare.com' : ''}${cfg.posthogKey ? ` ${origin(posthogAssets)}` : ''}${cfg.sentryDsn ? ' https://browser.sentry-cdn.com' : ''}`,
  `connect-src 'self' ${supa} ${supa.replace('https://', 'wss://')}${cfg.posthogKey ? ` ${origin(posthogHost)} ${origin(posthogAssets)}` : ''}${sentryIngest ? ` ${sentryIngest}` : ''}`,
  `frame-src${cfg.turnstileSiteKey ? ' https://challenges.cloudflare.com' : " 'none'"}`,
  "img-src 'self' data:",
  "style-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');
const indexPath = join(out, 'index.html');
writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace('__CSP__', csp));
console.log(`wrote config.js and CSP for ${cfg.environment}`);
