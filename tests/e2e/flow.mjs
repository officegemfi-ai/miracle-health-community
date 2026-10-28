// End to end, in a real browser, against the real database: three people use the
// community the way the beta will (spaces, the game, the live Signal, threads,
// notifications, moderation), and a member's token is used to try things the app
// never offers. Live updates are checked across browsers: what one member does
// shows up on another member's screen without a reload.
// Works against the local stand-in (scripts/local-api, live updates included) or a
// local Supabase in CI.
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
const total = async (handle) => Number((await db.query(
  `select coalesce(sum(p.amount) filter (where not p.void), 0) as t
     from public.profiles pr left join public.points p on p.user_id = pr.id where pr.handle = $1`, [handle])).rows[0].t);
const shown = async (handle) => Number((await db.query(
  `select s.total from public.member_scores s join public.profiles pr on pr.id = s.user_id where pr.handle = $1`, [handle])).rows[0]?.total ?? -1);

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
  if (invite) {
    // Sign-up is open; an invite comes in through its link, and the form then shows it
    await page.evaluate((c) => { location.hash = `#/join/${c}`; }, invite);
    await page.waitForSelector('#invite');
    await page.fill('#invite', invite);
  } else if (await page.isVisible('#invite')) {
    throw new Error('The sign-up form asks for an invite without an invite link');
  }
  await page.fill('#handle', handle);
  await page.check('#adult');
  await page.check('#rules-ok');
  await page.check('#health-ok');
  await page.click('form button[type=submit]');
  await page.waitForSelector('dialog.modal h2:text("Hi, I’m Sig.")');
}
// Onboarding: Sig says hello, the member joins spaces, then sees the emblems
async function onboard(page, pick) {
  await page.click('dialog button:text("Show me around")');
  await page.waitForSelector('dialog .pick');
  const names = await pick(page);
  for (const name of names) {
    const b = page.locator('dialog .pick', { has: page.locator(`b:text-is("${name}")`) });
    await b.click();
    await page.waitForSelector(`dialog .pick[aria-pressed=true] b:text-is("${name}")`);
  }
  await page.click('dialog button:text("Next")');
  await page.waitForSelector('dialog h2:text("Earn your emblems.")');
  await page.click('dialog button:text("Let’s go")');
  await page.waitForSelector('h1:text("Your feed.")');
  return names;
}
const points = async (page) => Number((await page.textContent('#my-points')).replace(/\D/g, ''));
// The header counts up to the new total; wait until it settles on the expected value
async function waitPoints(page, want, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if ((await points(page)) === want) return want;
    await page.waitForTimeout(250);
  }
  return points(page);
}
const tickerValue = (page, cid) => page.evaluate((c) => document.querySelector(`#tick-track [data-sig-of="${c}"]`)?.textContent ?? null, cid);
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });

// ---------------------------------------------------------------------------
// A: a new member joins through an invite link, gets their bearings with Sig, plays
// ---------------------------------------------------------------------------
const A = await person();
await signIn(A, '5555550102');
await signUp(A, 'betatest01', 'kneeguy');
check('A new member joins through an invite link, and Sig welcomes them', await A.isVisible('dialog .sig'));
const aSpaces = await onboard(A, async (p) => (await p.locator('dialog .pick b').allTextContents()).slice(0, 3));
await A.waitForSelector('.kick:has-text("3 spaces you follow")');
check('Onboarding joins three spaces, and the left menu lists them', (await A.locator('#nav .nav-space').count()) === 3, aSpaces.join(', '));
check('The live Signal ticker runs across the top', (await A.locator('#tick-track .tick-i').count()) >= 20);
await A.waitForSelector('.quest button:has-text("Claim +20")');
await A.click('.quest button:has-text("Claim +20")');
check('Joining three spaces finishes a quest; claiming it pays 20, plus 5 for the first contribution of the day',
  (await waitPoints(A, 25)) === 25 && (await shown('kneeguy')) === 25, `${await points(A)} points`);
check('and the emblem card beside the feed shows the same total', Number((await A.textContent('[data-mecard] .pts')).replace(/\D/g, '')) === 25);

await A.goto(`${BASE}#/s/bpc157`);
await A.waitForSelector('.space-hero h1:text("BPC-157.")');
if ((await A.getAttribute('.space-hero button.join', 'aria-pressed')) !== 'true') {
  await A.click('.space-hero button.join');
  await A.waitForSelector('.space-hero button.join[aria-pressed=true]');
}
check('A space has its own page, its Community Signal and a Join button', await A.isVisible('.sigcard'));
await shot(A, '01_space');

// The rules apply before anything is saved
await A.goto(`${BASE}#/new`);
await A.waitForSelector('#title');
await A.fill('#compound', 'Ozempic');
await A.waitForSelector('.cpick-opt.on:has-text("Semaglutide")');
await A.keyboard.press('Enter');
await A.waitForSelector('.cchip:has-text("Semaglutide")');
check('Picking what you took: brand names find compounds (Ozempic is semaglutide)', true);
await A.fill('#title', 'Where to buy sema cheap?');
await A.fill('#body', 'Anyone know where to buy it?');
await A.click('form button[type=submit]:text("Post")');
await A.waitForSelector('.msg.err');
check('Asking where to buy is refused with the rule', /rule 1/.test(await A.textContent('.msg.err')));

await A.goto(`${BASE}#/new?c=bpc157`);
await A.waitForSelector('#title');
await A.fill('#title', 'Week 4 on BPC-157 for a knee injury');
await A.fill('#body', 'Stairs are easier than before I started. Took it for six weeks; mild nausea the first days.');
await A.click('form button[type=submit]:text("Post")');
await A.waitForSelector('h1.post-title:text("Week 4 on BPC-157")');
const postId = decodeURIComponent(A.url().split('#/post/')[1]);
check('Their report goes up, and Miracle AI starts reading it', !!postId && await A.isVisible('.airead:has-text("Miracle AI is reading")'));

// ---------------------------------------------------------------------------
// B: a second member, on a phone, joins with no invite at all, and follows the same space
// ---------------------------------------------------------------------------
const B = await person({ width: 390, height: 844 });
await signIn(B, '(555) 555-0103');
await signUp(B, '', 'sleepyjoe');
check('Sign-up is open: someone joins with no invite, and the form never asks for one', await B.isVisible('dialog .sig'));
await onboard(B, async () => ['BPC-157']);
await B.waitForSelector(`[data-post="${postId}"]`);
check('Another member joins s/BPC-157, and the report is on their Home feed', true);
await B.waitForSelector('#tick-track [data-sig-of="bpc157"]', { state: 'attached' });
const bpcBefore = await tickerValue(B, 'bpc157');

// Miracle AI reads the report. Test runs have no Anthropic key, so the test records
// the read the way the review-content function does (with the database owner's rights).
await db.query(`select public.record_post_read($1, true, 'better', '6 weeks', array['Nausea'], 'e2e',
                 '[{"use": "injury", "outcome": "better"}, {"use": "joints", "outcome": "better"}]')`, [postId]);

await A.waitForSelector('.sigsay.in:has-text("Miracle AI read your report")', { timeout: 20000 });
check('The author hears from Sig the moment the read lands, without a reload (live)', /Better/.test(await A.textContent('.sigsay')), (await A.textContent('.sigsay')).slice(0, 100));
await A.waitForSelector('.airead:has-text("Better")', { timeout: 15000 });
check('The post shows what Miracle AI read: better, what for, for 6 weeks, side effects, feeding the BPC-157 Signal',
  /6 weeks/.test(await A.textContent('.airead')) && /Nausea/.test(await A.textContent('.airead')) && /BPC-157 Signal/.test(await A.textContent('.airead'))
  && /for injury healing, joint pain/.test(await A.textContent('.airead')), (await A.textContent('.airead')).slice(0, 160));
await A.waitForSelector('dialog .celebrate h2:text("You reached Pulse.")', { timeout: 15000 });
check('Passing 60 points celebrates the second emblem, Pulse (live)', (await waitPoints(A, 70)) === 70 && (await shown('kneeguy')) === 70, `${await points(A)} points`);
await shot(A, '02_level_up');
await A.click('dialog button:text("Keep going")');
await A.waitForSelector('dialog.modal', { state: 'detached' });
// The season's shared count (whenever a season is running) follows the report too
if (await A.isVisible('#nav .season-mini')) {
  await A.waitForSelector('#nav .season-mini b:has-text("1 of ")', { timeout: 10000 }).catch(() => {});
  check('The season’s shared count of reports moves with it (live)', /^1 of /.test(await A.textContent('#nav .season-mini b')), await A.textContent('#nav .season-mini b'));
}
await shot(A, '03_report_read');

await B.waitForFunction((before) => {
  const v = document.querySelector('#tick-track [data-sig-of="bpc157"]')?.textContent;
  return v && v !== before;
}, bpcBefore, { timeout: 20000 }).catch(() => {});
const bpcAfter = await tickerValue(B, 'bpc157');
check('On another member’s phone, the BPC-157 number in the ticker moves by itself (live)', bpcAfter && bpcAfter !== bpcBefore, `${bpcBefore} → ${bpcAfter}`);

// The week's first report finishes another quest
await A.goto(`${BASE}#/quests`);
await A.waitForSelector('.quest button:has-text("Claim +50")');
await A.click('.quest button:has-text("Claim +50")');
check('A first report this week finishes the weekly quest: +50', (await waitPoints(A, 120)) === 120 && (await shown('kneeguy')) === 120, `${await points(A)} points`);

// A asks a question; B, on Home, is told there's something new
await A.goto(`${BASE}#/new?c=bpc157`);
await A.waitForSelector('#title');
await A.click('.seg label:has-text("A question")');
await A.fill('#title', 'Anyone else tired in the first week?');
await A.fill('#body', 'Curious whether that faded for others.');
await A.click('form button[type=submit]:text("Post")');
await A.waitForSelector('h1.post-title:text("Anyone else tired")');
await B.waitForSelector('.newposts:not(.hide) button:has-text("1 new post")', { timeout: 20000 });
await B.click('.newposts button');
await B.waitForSelector('article.post:has-text("Anyone else tired in the first week?")');
check('Another member on Home is told a new post arrived, and it loads with one tap (live)', true);
await shot(B, '04_home_phone');

// A reads their notifications, which marks them read
await A.click('#bell');
await A.waitForSelector('.notif-pop .notif');
const aNotes = await A.locator('.notif-pop .notif').allTextContents();
check('Notifications open from the bell: the read, the new emblem, the badges',
  aNotes.some((t) => /Miracle AI read your report/.test(t)) && aNotes.some((t) => /You reached Pulse/.test(t)) && aNotes.some((t) => /New badge/.test(t)), `${aNotes.length} notifications`);
await A.click('#bell');   // closes it
await A.waitForSelector('.notif-pop', { state: 'detached' });
await A.waitForSelector('#bell .count.hide', { state: 'attached' });

// ---------------------------------------------------------------------------
// B reads the report, votes, comments, says "same for me" and reports it.
// The author, on another screen, is told as it happens.
// ---------------------------------------------------------------------------
// Start watching the author's screen before B acts, so a short-lived note isn't missed
const seen = (page, selector) => page.waitForSelector(selector, { timeout: 20000 }).then(() => true, () => false);
await B.goto(`${BASE}#/post/${postId}`);
await B.waitForSelector('article.post .acts .vote.h');   // on a phone the votes sit in the action row
await B.locator('article.post .vote button.up:visible').first().click();
await B.waitForFunction(() => document.querySelector('article.post .vote.h b')?.textContent === '1');
check('They upvote it', true);
const aToldComment = seen(A, '.toast:has-text("u/sleepyjoe commented on your post")');
await B.fill('#comment', 'Same here, week two was the turning point for me.');
await B.click('form.composer button:text("Comment")');
await B.waitForSelector('.cm:has-text("turning point")');
check('They comment, and the count updates', (await B.textContent('.row h2:has-text("Comments")')).includes('(1)'));
check('The author is told about the comment on their screen (live)', await aToldComment);
check('Miracle AI’s read shows on the post for everyone, and it feeds the BPC-157 Signal',
  (await B.textContent('.airead')).includes('Better') && (await B.textContent('.airead')).includes('BPC-157 Signal'));
const aToldSame = seen(A, '.toast:has-text("said “same for me” on your report")');
await B.click('article.post button.same');
await B.waitForSelector('article.post button.same[aria-pressed=true]:has-text("· 1")');
const signalAfterSame = (await db.query(`select first_hand, same_for_me from public.signal_board where compound_id = 'bpc157'`)).rows[0];
check('“Same for me” adds to the Signal', signalAfterSame.first_hand === 1 && signalAfterSame.same_for_me === 1, JSON.stringify(signalAfterSame));
check('and the author hears about it (live)', await aToldSame);
await A.waitForFunction(() => Number(document.querySelector('#bell .count:not(.hide)')?.textContent) >= 2, null, { timeout: 20000 }).catch(() => {});
check('The author’s bell counts what’s new, without a reload (live)', Number(await A.textContent('#bell .count')) >= 2, `${await A.textContent('#bell .count')} new`);
// Votes and "same for me" from accounts in their first week don't pay the author,
// so nobody can farm points with new accounts
const paidByNew = (await db.query(`select count(*)::int as n from public.points p join public.profiles pr on pr.id = p.user_id
                                    where pr.handle = 'kneeguy' and p.reason in ('upvote', 'same_received')`)).rows[0].n;
check('Backing from a first-week account doesn’t pay the author, so new accounts can’t farm points',
  paidByNew === 0 && (await shown('kneeguy')) === 125 && (await total('kneeguy')) === 125, `${await shown('kneeguy')} points`);
await B.click('article.post button[aria-label=More]');
await B.click('.pop button:has-text("Report post")');
await B.check('dialog input[value=dosing]');
await B.click('dialog button[type=submit]');
await B.waitForSelector('dialog h2:text("Thanks")');
check('They report it', true);
await B.click('dialog button:text("Close")');
await shot(B, '05_post_phone');
check('Their points follow what they did: 5 for “same for me”, 3 for the comment, 5 for the day',
  (await shown('sleepyjoe')) === 13 && (await total('sleepyjoe')) === 13, `${await shown('sleepyjoe')} points`);

// A replies in the thread; B is told
await A.goto(`${BASE}#/post/${postId}`);
await A.waitForSelector('.cm:has-text("turning point")');
const bToldReply = seen(B, '.toast:has-text("u/kneeguy replied to you")');
await A.click('.cm:has-text("turning point") button:has-text("Reply")');
await A.fill('.reply-box textarea', 'Good to hear. Did the nausea fade for you too?');
await A.click('.reply-box button:text("Reply")');
await A.waitForSelector('.cm-kids .cm:has-text("nausea fade")');
check('Replies nest under the comment they answer, marked as the author’s', await A.isVisible('.cm-kids .cm .chip.ink:text("OP")'));
check('The member who was answered is told (live)', await bToldReply);

await B.goto(`${BASE}#/new?c=tb500`);
await B.waitForSelector('#title');
await B.fill('#title', 'My TB-500 source');
await B.fill('#body', 'Got it from peptidesplace.shop, great prices');
await B.click('form button[type=submit]:text("Post")');
await B.waitForSelector('.msg.err');
check('A first-week member can’t post a shop link', /first week/.test(await B.textContent('.msg.err')));

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
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
const none = (r) => r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0);
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
check('Through the API, a member can’t edit someone else’s post', none(r), `HTTP ${r.status}`);
r = await api('POST', 'posts', { compound_id: 'bpc157', kind: 'question', title: 'Status trick', body: 'x', status: 'visible', author_id: bId });
check('Through the API, nobody can set a post’s status or author', r.status >= 400, `HTTP ${r.status}`);
r = await api('POST', 'points', { user_id: bId, reason: 'report', amount: 500 });
check('Through the API, a member can’t write themselves points', r.status >= 400, `HTTP ${r.status}`);
r = await api('PATCH', `member_scores?user_id=eq.${bId}`, { total: 99999, level: 15 });
check('or change their score or emblem', none(r) && (await shown('sleepyjoe')) === 13, `HTTP ${r.status}`);
r = await api('POST', 'member_badges', { user_id: bId, badge: 'builder' });
check('or hand themselves a badge', r.status >= 400, `HTTP ${r.status}`);
r = await api('POST', 'rpc/claim_quest', { quest: 'report' });
check('A quest can’t be claimed before it’s done', r.status >= 400 && /Not done yet/.test(r.body?.message || ''), r.body?.message);
r = await api('POST', 'rpc/confirm_read', { post_id: postId, outcome: 'worse' });
check('Only the author can confirm or correct Miracle AI’s read', r.status >= 400, `HTTP ${r.status} ${r.body?.message || ''}`);
r = await api('GET', 'notifications?select=user_id');
check('Through the API, a member reads only their own notifications', r.status === 200 && r.body.length > 0 && r.body.every((x) => x.user_id === bId), `${r.body?.length} rows`);
r = await api('GET', 'points?select=user_id');
check('and nobody else’s points', r.status >= 400 || r.body.every((x) => x.user_id === bId), `HTTP ${r.status}`);
r = await api('GET', 'posts?select=*', null, anon);
check('Signed out, the API shows no posts', none(r), `HTTP ${r.status}`);

// ---------------------------------------------------------------------------
// M: the moderator removes the reported post
// ---------------------------------------------------------------------------
await B.goto(`${BASE}#/s/bpc157`);
await B.waitForSelector('.sigcard .tools .cert-row');
const tools = await B.textContent('.sigcard .tools');
await B.waitForSelector('a.lib-link', { state: 'attached' });
check('A space links to its fact sheet in the public library', (await B.getAttribute('a.lib-link', 'href')) === 'https://miraclehealth.us/library/bpc157/');
const jointRow = (await B.textContent('.sigcard .uses [data-use="joints"]')) || '';
check('A space rates the compound by use: joint pain shows its first report and how often the forums mention it',
  /Joint pain/.test(jointRow) && /1 report/.test(jointRow) && /forums: very common/i.test(jointRow) && /2 more to rate/i.test(jointRow), jointRow);
check('A space shows its Signal’s measuring tools: the level, how first-hand reports went with a 95% interval, and the takeover line',
  /Forum data/.test(tools) && /How 1 first-hand report went/.test(tools) && /95% CI \d+–\d+%/.test(tools)
  && await B.isVisible('.sigcard .split') && await B.isVisible('.sigcard .viz-compact .takeover .tk-you'), tools.slice(0, 160));

await B.goto(`${BASE}#/signal`);
await B.waitForSelector('.sig-row');
check('The Signal page ranks the compounds', (await B.locator('.sig-row').count()) >= 50);
check('and lists the live moves with their causes', (await B.locator('.move-i').count()) >= 1);
await B.waitForSelector('.viz-compact .flowviz.compact');
check('It draws how the number is made: public forums and members’ reports in, one number out',
  /FROM MEMBERS/.test(await B.textContent('.viz-compact .flowviz')) && /[\d,]+ first-hand reports?\b/.test(await B.textContent('.viz-compact .flowviz'))
  && /THE FORMULA/.test(await B.textContent('.viz-compact .flowviz')));
const ladderCounts = await B.locator('.ladder-steps .step-l .cnt b').allTextContents();
check('with the certification ladder, which counts every Signal once',
  ladderCounts.length === 5 && ladderCounts.reduce((a, t) => a + Number(t.replace(/\D/g, '')), 0) === await B.locator('.sig-row').count(), ladderCounts.join(' '));
await B.$eval('#sim-n', (el) => { el.value = '150'; el.dispatchEvent(new Event('input', { bubbles: true })); });
check('The takeover slider shows what 150 first-hand reports would do: 75% from members, Signal Certified',
  /75% from members/.test(await B.textContent('.sim-out')) && /Signal Certified/.test(await B.textContent('.sim-out'))
  && /150 REPORTS · 75%/.test(await B.textContent('.takeover-card .viz-compact .tk-you')));

const M = await person();
await signIn(M, '5555550101');
await M.waitForSelector('h1:text("Your feed.")');
await M.waitForSelector('#nav a[data-nav=mod]');
check('The moderator sees Moderation in the menu', true);
await M.fill('#search input', 'Week 4');
await M.waitForSelector('.search-pop:not(.hide) a:has-text("Week 4 on BPC-157")');
check('Search finds posts as you type', true);
await M.keyboard.press('Escape');
await M.goto(`${BASE}#/mod/queue`);
await M.waitForSelector(`[data-queue="${postId}"]`);
const card = M.locator(`[data-queue="${postId}"]`);
check('The reported post is in the queue, on the rule the report named',
  (await card.locator('select').inputValue()) === 'Rule 2: dosing instructions');
await shot(M, '06_queue');
const aToldRemoved = A.waitForSelector('.toast:has-text("A moderator removed your post")', { timeout: 20000 })
  .then((el) => el.textContent(), () => '');
await card.locator('button:text-is("Remove")').click();
await M.waitForSelector(`[data-queue="${postId}"]`, { state: 'detached' });
check('The moderator removes it', true);
check('A removed post stops counting toward the Signal',
  (await db.query(`select first_hand from public.signal_board where compound_id = 'bpc157'`)).rows[0].first_hand === 0);
const owed = (await db.query(`select count(*)::int as n from public.points where post_id = $1 and not void`, [postId])).rows[0].n;
check('and the points it earned are taken back (83 left: the quests, the day, the question, the reply)',
  owed === 0 && (await shown('kneeguy')) === 83 && (await total('kneeguy')) === 83, `${await shown('kneeguy')} points`);
await M.goto(`${BASE}#/mod/numbers`);
await M.waitForSelector('table.metrics');
check('The beta numbers load for the moderator', (await M.textContent('table.metrics')).includes('week1 contributors pct'));

const removedNote = await aToldRemoved;
check('The author is told it was removed, and why (live)', /Rule 2/.test(removedNote), removedNote.slice(0, 80));
// The author still has the post open: it redraws by itself
await A.waitForSelector('.chip.removed', { timeout: 15000 });
check('The open post shows it was removed, and why, without a reload (live)', (await A.textContent('.chip.removed')).includes('Rule 2'));
check('and the header shows the points taken back', (await waitPoints(A, 83)) === 83, `${await points(A)} points`);
await shot(A, '07_removed_author');

await B.goto(`${BASE}#/home`);
await B.reload();
await B.waitForSelector('h1:text("Your feed.")');
await B.waitForSelector('article.post');
check('The removed post is gone from other members’ feeds', !(await B.isVisible(`[data-post="${postId}"]`)));

// The leaderboard and profiles, from the real numbers
await B.goto(`${BASE}#/builders`);
await B.waitForSelector('.lb-row, .pod');
const builders = await B.locator('.lb-row, .pod').allTextContents();
check('Signal Builders ranks this month’s members by points', builders.some((t) => t.includes('kneeguy')) && builders.some((t) => t.includes('sleepyjoe')), `${builders.length} rows`);
await A.goto(`${BASE}#/u/kneeguy`);
await A.waitForSelector('h1:text("u/kneeguy")');
check('A profile shows the emblem and the badges earned', (await A.locator('.bdg:not(.locked)').count()) >= 2, `${await A.locator('.bdg:not(.locked)').count()} badges`);
await shot(A, '08_profile');

// ---------------------------------------------------------------------------
// Stacks: B posts two compounds taken together, then finds the stack
// ---------------------------------------------------------------------------
await B.goto(`${BASE}#/new`);
await B.waitForSelector('#compound');
await B.fill('#compound', 'bpc');
await B.waitForSelector('.cpick-opt.on:has-text("BPC-157")');
await B.keyboard.press('Enter');
await B.fill('#compound', 'tb 500');
await B.waitForSelector('.cpick-opt.on:has-text("TB-500")');
await B.keyboard.press('Enter');
await B.waitForSelector('.cpick-note:has-text("A stack")');
check('Two picks make a stack, and the form says so before posting',
  /BPC-157 \+ TB-500/.test(await B.textContent('.cpick-note')) && /first to post this exact stack/.test(await B.textContent('.cpick-note')));
await shot(B, '09_stack_compose');
await B.fill('#title', 'BPC-157 + TB-500 for a shoulder, week 5');
await B.fill('#body', 'Reaching overhead is easier than before I started both. Five weeks, no side effects.');
await B.click('form button[type=submit]:text("Post")');
await B.waitForSelector('h1.post-title:text("BPC-157 + TB-500 for a shoulder")');
const stackPost = decodeURIComponent(B.url().split('#/post/')[1]);
const stackRow = (await db.query(`select p.compound_id, c.name, c.kind from public.posts p join public.compounds c on c.id = p.compound_id where p.id = $1`, [stackPost])).rows[0];
check('The post goes to the stack’s own space, made for it', stackRow?.kind === 'stack' && stackRow.name === 'BPC-157 + TB-500', JSON.stringify(stackRow));
const partsShown = await B.locator('.post-chips.parts a').evaluateAll((els) => els.map((e) => e.lastChild.textContent));
check('and the post lists what’s in the stack', partsShown.join('|') === 'BPC-157|TB-500', partsShown.join('|'));
await B.goto(`${BASE}#/stack?c=bpc157,tb500`);
await B.waitForSelector('.stack-hit h2:text("BPC-157 + TB-500")');
await B.waitForSelector(`[data-post="${stackPost}"]`);
check('Find your stack shows that exact stack and its posts', true);
await B.waitForSelector('.lib-row:has-text("Wolverine blend")');
check('and the blends that contain it', true);
await shot(B, '10_find_stack');
await B.goto(`${BASE}#/s/bpc157?only=stacks`);
await B.waitForSelector(`[data-post="${stackPost}"]`);
check('BPC-157’s space shows it under "In stacks and blends"', true);
await B.goto(`${BASE}#/s/bpc157?only=own`);
await B.waitForSelector('.space-hero h1');
await B.waitForTimeout(800);
check('and not under "Just BPC-157"', !(await B.isVisible(`[data-post="${stackPost}"]`)));

// Something missing: B suggests it, the moderator adds it, B hears back
await B.goto(`${BASE}#/new`);
await B.fill('#compound', 'Glycocyamine');
await B.waitForSelector('.cpick-none button:has-text("Suggest it")');
await B.click('.cpick-none button:has-text("Suggest it")');
await B.waitForSelector('dialog h2:text("Suggest for the library")');
await B.click('dialog button[type=submit]');
await B.waitForSelector('dialog h2:text("Thanks, a moderator will add it")');
await B.click('dialog button:text("Close")');
check('A member suggests something the library is missing', true);
await M.goto(`${BASE}#/mod/library`);
await M.waitForSelector('.mod-card:has-text("Glycocyamine")');
await M.locator('.mod-card:has-text("Glycocyamine") select').nth(0).selectOption('Supplements');
await M.locator('.mod-card:has-text("Glycocyamine") select').nth(1).selectOption('Muscle & performance');
await M.click('.mod-card:has-text("Glycocyamine") button:text("Add to the library")');
await M.waitForSelector('.toast:has-text("Added to the library")');
const added = (await db.query(`select c.family, c.category, r.status from public.compounds c join public.compound_requests r on r.compound_id = c.id where c.name = 'Glycocyamine'`)).rows[0];
check('The moderator adds it to the library', added?.status === 'added' && added.category === 'Muscle & performance', JSON.stringify(added));
check('and whoever suggested it gets a note', Number((await db.query(`select count(*) from public.notifications where user_id = $1 and kind = 'library'`, [bId])).rows[0].count) === 1);
await M.fill('#search input', 'Ozempic');
await M.waitForSelector('.search-pop:not(.hide) a:has-text("s/Semaglutide")');
check('Search knows brand names', true);
await M.keyboard.press('Escape');

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
