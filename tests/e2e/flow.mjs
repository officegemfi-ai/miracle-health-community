// End to end, in a real browser: three people use the community the way the
// beta will, and a member's token is used to try things the app never offers.
// Works against the local stand-in (scripts/local-api) or a local Supabase in CI.
// Usage: BASE_URL=... DB_URL=... [API_URL=...] node tests/e2e/flow.mjs
import { chromium } from 'playwright';
import pg from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:54321/';
const DB = process.env.DB_URL || 'postgresql://postgres@127.0.0.1:54322/app';
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const db = new pg.Client({ connectionString: DB });
await db.connect();
// Fresh people for this run (the seed provides the invite codes and the moderator)
await db.query(`delete from auth.users where phone in ('15555550102', '15555550103')`);
await db.query(`insert into public.invites (code, note, max_uses) values ('BETATEST01', 'e2e', 20)
                on conflict (code) do update set uses = 0, max_uses = 20`);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
async function person(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, phone) {
  await page.goto(BASE);
  await page.fill('#phone', phone);
  await page.click('form button[type=submit]');
  await page.waitForSelector('#code');
  await page.fill('#code', '123456');
  await page.click('form button[type=submit]');
}
async function signUp(page, invite, handle) {
  await page.waitForSelector('#handle');
  await page.fill('#invite', invite);
  await page.fill('#handle', handle);
  await page.check('#adult');
  await page.check('#rules-ok');
  await page.check('#health-ok');
  await page.click('form button[type=submit]');
  await page.waitForSelector('h1:text("Feed")');
}
async function newPost(page, compound, title, body) {
  await page.goto(`${BASE}#/new`);
  await page.waitForSelector('#title');
  await page.selectOption('#compound', compound);
  await page.fill('#title', title);
  await page.fill('#body', body);
  await page.click('form button[type=submit]');
}
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });

// ---------------------------------------------------------------------------
// A: a new member joins with an invite and shares an experience
// ---------------------------------------------------------------------------
const A = await person();
await signIn(A, '5555550102');
await signUp(A, 'betatest01', 'kneeguy');
check('A new member joins with an invite code', await A.isVisible('nav#nav'));
await newPost(A, 'bpc157', 'Week 4 on BPC-157 for a knee injury', 'Stairs are easier than before I started. Took it for six weeks; mild nausea the first days.');
await A.waitForSelector('h1:text("Week 4 on BPC-157")');
const postUrl = A.url();
const postId = decodeURIComponent(postUrl.split('#/post/')[1]);
check('Their post goes up and opens', !!postId);
await shot(A, '01_post');

await newPost(A, 'semaglutide', 'Where to buy sema cheap?', 'Anyone know where to buy it?');
await A.waitForSelector('.err');
check('Asking where to buy is refused with the rule', /rule 1/.test(await A.textContent('.err')));
await shot(A, '02_refused');

// ---------------------------------------------------------------------------
// B: a second member reads, votes, comments and reports
// ---------------------------------------------------------------------------
const B = await person({ width: 390, height: 844 });
await signIn(B, '(555) 555-0103');
await signUp(B, 'BETATEST01', 'sleepyjoe');
await B.waitForSelector(`[data-post="${postId}"]`);
check('Another member sees the post in the feed', true);
await shot(B, '03_feed_phone');
await B.goto(`${BASE}#/post/${postId}`);
await B.waitForSelector('.votes');
await B.click('article .votes button[aria-label=Helpful]');
await B.waitForFunction(() => document.querySelector('article .votes b')?.textContent === '1');
check('They upvote it', true);
await B.fill('#comment', 'Same here, week two was the turning point for me.');
await B.click('form button[type=submit]');
await B.waitForSelector('.comment');
check('They comment', (await B.textContent('.comment')).includes('turning point'));
await B.click('article button:text-is("Report")');
await B.check('dialog input[value=dosing]');
await B.click('dialog button[type=submit]');
await B.waitForSelector('dialog h2:text("Thanks")');
check('They report it', true);
await B.keyboard.press('Escape');
await shot(B, '04_post_phone');

await newPost(B, 'tb500', 'My TB-500 source', 'Got it from peptidesplace.shop, great prices');
await B.waitForSelector('.err');
check('A first-week member can’t post a shop link', /first week/.test(await B.textContent('.err')));

// B tries things the app never offers, straight against the API with B's own token
const token = await B.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('sb-') && x.endsWith('-auth-token'));
  return k ? JSON.parse(localStorage.getItem(k)).access_token : null;
});
const apiBase = process.env.API_URL || await B.evaluate(() => window.MH_CONFIG.supabaseUrl);
const anon = await B.evaluate(() => window.MH_CONFIG.supabaseAnonKey);
async function api(method, path, body, bearer = token) {
  const res = await fetch(`${apiBase}/rest/v1/${path}`, {
    method, headers: { apikey: anon, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const bId = (await db.query(`select id from public.profiles where handle = 'sleepyjoe'`)).rows[0].id;
let r = await api('PATCH', `profiles?id=eq.${bId}`, { role: 'admin' });
check('Through the API, a member can’t make themselves admin', r.status >= 400, `HTTP ${r.status}`);
r = await api('GET', 'moderation_actions?select=*');
check('Through the API, a member reads nothing from the moderation log', r.status === 200 && r.body.length === 0, `${r.body?.length ?? r.status} rows`);
r = await api('GET', 'reports?select=*');
check('Through the API, a member sees only their own report', r.status === 200 && r.body.length === 1, `${r.body?.length} rows`);
r = await api('GET', 'watch_terms?select=*');
check('Through the API, the watch list stays hidden', r.status === 200 && r.body.length === 0);
r = await api('PATCH', `posts?id=eq.${postId}`, { title: 'Hijacked' });
check('Through the API, a member can’t edit someone else’s post', r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `HTTP ${r.status}`);
r = await api('POST', 'posts', { compound_id: 'bpc157', kind: 'question', title: 'Status trick', body: 'x', status: 'visible', author_id: bId });
check('Through the API, nobody can set a post’s status or author', r.status >= 400, `HTTP ${r.status}`);
r = await api('GET', 'posts?select=*', null, anon);
check('Signed out, the API shows no posts', r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `HTTP ${r.status}`);

// ---------------------------------------------------------------------------
// M: the moderator removes the reported post
// ---------------------------------------------------------------------------
const M = await person();
await signIn(M, '5555550101');
await M.waitForSelector('nav#nav a[data-nav=mod]:not([hidden])');
check('The moderator sees the Moderation tab', true);
await M.goto(`${BASE}#/mod/queue`);
await M.waitForSelector(`[data-queue="${postId}"]`);
check('The reported post is in the moderation queue', true);
await shot(M, '05_queue');
const card = M.locator(`[data-queue="${postId}"]`);
await card.locator('select').selectOption('Rule 2: dosing instructions');
await card.locator('button:text-is("Remove")').click();
await M.waitForSelector(`[data-queue="${postId}"]`, { state: 'detached' });
check('The moderator removes it', true);
await M.goto(`${BASE}#/mod/numbers`);
await M.waitForSelector('table.metrics');
check('The beta numbers load for the moderator', (await M.textContent('table.metrics')).includes('week1 contributors pct'));
await shot(M, '06_numbers');

await B.goto(`${BASE}#/feed`);
await B.reload();
await B.waitForSelector('h1:text("Feed")');
await B.waitForTimeout(500);
check('The removed post is gone from other members’ feeds', !(await B.isVisible(`[data-post="${postId}"]`)));
await A.goto(`${BASE}#/post/${postId}`);
await A.waitForSelector('.chip.removed');
check('The author sees it was removed, and why', (await A.textContent('.chip.removed')).includes('Rule 2'));
await shot(A, '07_removed_author');

// ---------------------------------------------------------------------------
// A deletes their account
// ---------------------------------------------------------------------------
await A.goto(`${BASE}#/account`);
await A.fill('#confirm-delete', 'DELETE');
await A.click('form button[type=submit]');
await A.waitForSelector('h1:text("Your account is deleted")');
const left = await db.query(`select (select count(*) from public.profiles where handle = 'kneeguy') as profiles,
                                    (select count(*) from public.posts where id = $1) as posts`, [postId]);
check('Deleting the account removes the profile and posts', Number(left.rows[0].profiles) === 0 && Number(left.rows[0].posts) === 0);

check('No script errors in any browser', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
await db.end();
writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
