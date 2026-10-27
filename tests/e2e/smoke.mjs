// After a deploy: the test app, on the real test project, works end to end. A test
// number (no text is sent to it) signs up with the test invite, joins a space, posts
// a first-hand report, and Miracle AI reads it for real (the database asks the
// review-content function, which asks Claude); the read and the points arrive live.
// Then the account is deleted, which removes everything it wrote.
// Usage: BASE_URL=<the test app, e.g. served from the runner: http://127.0.0.1:4173/test/>
//        EXPECT_SUPABASE_URL=https://<ref>.supabase.co [GATE_PASSWORD=...] node tests/e2e/smoke.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'https://community.miraclehealth.us/test/';
const PASSWORD = process.env.GATE_PASSWORD || '';
const EXPECT = process.env.EXPECT_SUPABASE_URL || '';
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}
function finish() {
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (process.env.GITHUB_ACTIONS) {
    if (failed.length) failed.forEach((f) => console.log(`::error title=Test app::${f.name}${f.detail ? ` (${f.detail})` : ''}`));
    else console.log(`::notice title=Test app::All ${results.length} checks passed on ${BASE}`);
  }
  return failed.length ? 1 : 0;
}

// Wait for the new build: GitHub Pages can take a minute to serve it
if (EXPECT) {
  const t = Date.now();
  let seen = '';
  while (Date.now() - t < 6 * 60000) {
    seen = await fetch(`${BASE}config.js?${Date.now()}`, { cache: 'no-store' }).then((r) => r.text()).catch(() => '');
    if (seen.includes(`"supabaseUrl": "${EXPECT}"`)) break;
    await new Promise((r) => setTimeout(r, 10000));
  }
  check('The site serves the test app built for the test project', seen.includes(`"supabaseUrl": "${EXPECT}"`), EXPECT);
  if (!seen.includes(EXPECT)) process.exit(finish());
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (name) => page.screenshot({ path: `${OUT}smoke_${name}.png` }).catch(() => {});
let code = 1;
try {
  await page.goto(BASE);
  await page.waitForSelector('#site-password, #phone', { timeout: 60000 });
  if (await page.isVisible('#site-password')) {
    await page.fill('#site-password', PASSWORD);
    await page.click('form button[type=submit]');
    await page.waitForSelector('#phone', { timeout: 60000 });
  }
  check('The test app opens on its sign-in page', true);

  // A test number: Supabase skips the text and takes the fixed code
  await page.fill('#phone', '5555550104');
  await page.click('form button[type=submit]');
  await page.waitForSelector('#code, .msg.err', { timeout: 30000 });
  if (await page.isVisible('.msg.err')) throw new Error(`Sign-in refused: ${await page.textContent('.msg.err')}`);
  await page.fill('#code', '123456');
  await page.click('form button[type=submit]');
  await page.waitForSelector('#handle, h1:text("Your feed.")', { timeout: 30000 });
  check('A test number signs in with its fixed code', true);

  if (await page.isVisible('#handle')) {
    await page.fill('#invite', 'BETATEST01');
    await page.fill('#handle', `smoke_${String(Date.now()).slice(-6)}`);
    await page.check('#adult');
    await page.check('#rules-ok');
    await page.check('#health-ok');
    await page.click('form button[type=submit]');
    await page.waitForSelector('dialog.modal h2:text("Hi, I’m Sig.")', { timeout: 30000 });
    await page.click('dialog button:text("Show me around")');
    await page.waitForSelector('dialog .pick');
    await page.click('dialog .pick:has(b:text-is("BPC-157"))', { timeout: 3000 }).catch(() => page.locator('dialog .pick').first().click());
    await page.click('dialog button:text("Next")');
    await page.click('dialog button:text("Let’s go")');
    await page.waitForSelector('h1:text("Your feed.")');
    check('Sign-up with the test invite, then Sig’s onboarding', true);
  }
  await page.waitForSelector('#tick-track .tick-i', { state: 'attached', timeout: 30000 });
  check('The live Signal ticker shows the real numbers', (await page.locator('#tick-track .tick-i').count()) >= 20);
  await shot('1_home');

  await page.goto(`${BASE}#/new?c=bpc157`);
  await page.waitForSelector('#title');
  await page.fill('#title', 'Smoke check: three weeks on BPC-157');
  await page.fill('#body', 'Took it for three weeks for a sore shoulder. Compared with before I started, it feels better: I can lift my arm overhead again.');
  await page.click('form button[type=submit]:text("Post")');
  await page.waitForSelector('h1.post-title:text("Smoke check")', { timeout: 30000 });
  check('A first-hand report goes up', true);

  // The read comes back through the database's hook, the function and Claude
  const read = await page.waitForSelector('.airead:has-text("Better")', { timeout: 150000 }).then(() => true, () => false);
  check('Miracle AI reads it for real: better, and it feeds the BPC-157 Signal', read, read ? '' : (await page.textContent('.airead').catch(() => 'no read panel')).slice(0, 120));
  const told = await page.waitForSelector('.sigsay:has-text("Miracle AI read your report")', { timeout: 15000 }).then(() => true, () => false);
  check('and Sig tells the author as it lands (live updates work)', told);
  await shot('2_read');

  await page.goto(`${BASE}#/account`);
  await page.fill('#confirm-delete', 'DELETE');
  await page.click('form button[type=submit]');
  await page.waitForSelector('h1:text("Your account is deleted")', { timeout: 30000 });
  check('The account deletes itself again, with everything it wrote', true);
  check('No script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  code = finish();
} catch (e) {
  await shot('failed');
  check('The run got through', false, String(e.message || e).split('\n')[0]);
  code = finish();
} finally {
  await browser.close();
}
process.exit(code);
