# Miracle Health Community

The backend and web app for the Miracle Health community: phone sign-in (open to adults; an
invite link adds its perks), posts, comments, votes, reports and moderation, built on Supabase.

Posts name what the member took, from a library of about 300 peptides, hormones, supplements,
medications and pre-mixed blends (searchable by brand names and nicknames too). Several picked
together make a stack: a space of its own with its own Signal, scored only from reports of that
exact stack. "Find your stack" searches every report that includes what you take. Members suggest
what the library is missing; moderators add it under Moderation > Library.

Every Signal earns a certification level from the database (Forum data, Early signal,
Community-backed, Community-verified, Signal Certified) as members' first-hand reports take over
from the public forums, which count as 50 reports per compound. Each space shows its measuring
tools: how first-hand reports split, with a 95% interval for "better", the side effects members
mention and where it sits on the takeover line. Each Signal is also rated by use (joint pain,
injury healing, sleep...): Sig reads what each report was for (the list is
`shared/uses.json`), and a use gets its own rating from members' reports once three name it, next
to how often the public forums mention it. `web/lib/signalviz.js` draws these as plain SVG,
so the public library on miraclehealth.us can use the same drawings.

## What's where
- `supabase/migrations/`: the database (tables, access rules, the checks on every post, moderation)
- `supabase/tests/database/`: 400 access, Community Signal, certification, ratings-by-use, game, stack and chat-limit tests (pgTAP)
- `supabase/functions/`: `review-content` (Claude's first read: the rules, and each post's outcome for the Signal),
  `delete-account`, `ask`: Sig's chat on the public website (miraclehealth.us/ai), below,
  `newsletter`: The Signal, the weekly email (sign-ups from miraclehealth.us, double opt-in, confirm and
  unsubscribe links, sending an issue; emails go out once `RESEND_API_KEY` and `NEWSLETTER_FROM` are set),
  and `send-texts`: check-in texts for members who ask for them (once a Twilio messaging service is
  registered and `TWILIO_MESSAGING_SERVICE_SID` is set)
- `scripts/build_public_reports.mjs`, `site/r.css`: the pages at community.miraclehealth.us/r/ for reports
  their authors chose to let anyone read, rebuilt every hour by the Pages workflow
- `web/`: the app (plain HTML, CSS and JavaScript modules in `web/lib/`; no build step)
- `shared/rules.json`, `shared/uses.json`: the community rules and the list of uses, copied to the app and
  the AI reviewer by `scripts/sync_rules.sh`
- `shared/kit/`: Miracle Health's design kit, the pieces the app and the website (miraclehealth.us) share
  so they look like one product and can't drift apart: the bar of the four places (Library, Ask Sig,
  Community, My Miracle), the evidence meter, the Community Signal number, compound tiles and chips, Sig,
  the Signal drawings (`signalviz.js`) and the links between places (a question for Sig, a check-in
  from a member's Miracle Plan drafted as a post). `scripts/sync_kit.sh [path/to/miraclehealth-site]`
  copies it to `web/kit`, `web/lib/signalviz.js` and the website; CI checks every copy matches
  (`scripts/check_kit_sync.sh`), the website's on its main branch included
- `shared/signal_baseline.json`: the Community Signal's public-forum starting point, loaded by a migration
  that `scripts/build_signal_baseline_sql.mjs` generates (CI checks they match)
- `web/preview/`, `scripts/build_preview.mjs`: the preview: the same migrations running in the browser
  (PGlite) with a sample community (preview builds only)
- `tests/e2e/`: real-browser tests (the whole flow with three people and live updates, the site
  password, the preview) and a scripted spam attack
- `.github/workflows/`: tests on every change, deploy to test, promote to live; the site build every hour
  (`pages.yml`); **Check-in texts** (hourly, once the variable `CHECKIN_TEXTS` is `on`); **Weekly email**
  (by hand: send the confirm links, or send issue *n*); **Health check** (every six hours: both sites,
  the snapshot's age, the evidence files and the server functions answer; a failure emails you)
- `docs/SETUP.md`: the one-time setup; `docs/evidence/`: test results and the forum research

## Ask Sig (`supabase/functions/ask`)
Sig is the Community Signal in person, and Miracle Health's AI: it reads every report into the
Signal in the community, and answers questions in the chat called Ask Sig on the website.
- **The names**: "Ask Sig" is the place (the menu, buttons, the page at miraclehealth.us/ai, with
  miraclehealth.us/sig as a short link); "Sig" is who answers, and speaks as "I". The first mention
  on a page says it plainly: "Sig, Miracle Health's AI". Never "Sig AI", never "Miracle AI".
- **Saying it's an AI**: the page's opening line, its fine print, the adults-only check, the
  welcome in the community, the privacy notice and the terms all say Sig is an AI, not a person
  or a clinician; if asked, Sig says so too (`prompts.ts`).
- **The voice**: friendly, plain and upbeat; never cute about risks; when safety comes up the
  cheer goes and the words get plain. Never doses or directions for taking anything (on a
  prescription, "Sig" is the pharmacist's word for the directions; Sig never gives them).
- **No clinician step**: Sig doesn't make review packets any more; it says what to ask a
  clinician, and the member's own clinician decides. Old packet links still open at
  miraclehealth.us/ai/packet/.

Anyone can talk with Sig on miraclehealth.us/ai about improving with peptides,
supplements, hormones and the medicines taken with them; no account needed. Every answer speaks
for two sources at once, and says which is which: the studies (the Library's fact sheets) and the
community (the Community Signal: members' first-hand reports and public forum data). Each message
goes through nine agents and the community's numbers, and the page shows each step as it happens:

1. **Safety agent** (Claude Haiku) reads the message first: emergencies (911), signs of crisis
   (988), under-18s, pregnancy, medicines and conditions, and requests for doses or sellers.
2. **Planner** (no model: `outcomes.ts`) reads what the visitor wants as what studies measure:
   "fat loss" is body fat, with the body weight and lean mass that studies of it measure too;
   "my knee" is joint pain and function, with tendon and ligament healing. It goes by their own
   words (the latest message that names something), or their goal when they name nothing
   measurable.
3. **Recommender** (Claude Sonnet, the voice of the chat) works from the public Library
   (`miraclehealth.us/library/data/index.json` and each fact sheet) and the Community Signal
   (`snapshot.json`), with tools to rank options for a goal, open fact sheets and search. It
   talks like a caring clinician, briefly: it asks or answers, never both. When it doesn't yet
   know what would change its answer, it first asks 2 to 4 questions, the way a clinician takes
   a history (what's going on, what they've tried, their foundations, medicines and conditions;
   never their age or sex), on a card the visitor
   answers by tapping or typing; past a full answer, it can only end with one question in prose.
   It never asks for names, contact details, birthdays, amounts taken or where things come from.
   Warning signs are never worded by the model: it picks them from a fixed table
   (`urgency.ts`, drafted from public medical guidance, not yet reviewed by a clinician), and
   the page shows each under its level: call 911 now, same day, or this week. Someone who
   says they inject gets the safety basics once in a chat (adults only); questions about a
   product's quality point to the Library's guide to reading a lab report.
4. **Evidence librarian** (no model: `outcomes.ts`) reads every fact sheet opened in the turn
   (the compounds named, and any the Recommender opens) for findings on exactly what the Planner
   read, strongest first, each with who was studied ("in adults with excess belly fat" is who was
   studied, not a finding about belly fat), and says plainly when a sheet has none. Sig answers
   rung by rung: tested together; each one studied for the goal, with who; how each works, from its
   fact sheet, said as expected and not tested; what people report. Not studied together is never
   "no evidence", and the risks, US status and legal limits get as much room as the benefits.
   When a reply says nothing is known, the final check is given these findings (rule 9).
   **Relatives agent** (no model: `relatives.ts`, over the Library's pathways in
   `library/data/axes.json`, written from each member's fact sheet) adds the rung below: for a
   compound that raises a hormone the body makes, that hormone's own findings (testosterone's for
   enclomiphene, HGH's for ipamorelin), said as expected from how it works, not tested; for the
   hormone itself, the findings of what raises it (tesamorelin's for HGH), as support, never as
   a test of it; and, when a compound's own sheet has nothing, what acts on the same receptor.
   Their sheets count among the sources, never among the findings the final check puts back.
   **Mechanism agent** (no model: `mechanism.ts`) reads how each compound could bear on it: the
   sentences of its own sheet's "what it is" that are about it, or else its pathway, always as
   expected from how it works, not tested. Then the page gets the evidence ladder (a `ladder`
   event: each compound's own findings, its relatives', how it could bear on it, how the compounds
   relate), and the screen beside the chat opens on it, rung by rung.
5. **The community** (no model: the community's public totals in `snapshot.json`, read by
   `community.ts`): for each compound named, and for what the visitor wants it for (one of the
   uses in `shared/uses.json`, which the Safety agent picks out), what members' first-hand reports
   and the public forums say: the Signal and its level, how members rate it for that use (or how
   often the forums mention it), how reports went, side effects members mention. Compound by
   compound it decides which voice leads: the studies when there are studies in people for what
   was asked; the community's reports when there aren't (animal studies only, nothing on that use,
   or no fact sheet yet), with their sample size and where they come from; plain words when
   neither has anything. For two or more taken together, it first gives what the community has on
   that exact combination: its own Signal (members' first-hand reports of that stack), or plainly
   that nobody has reported it yet, so Sig never describes a combination from what each does alone.
   The page shows the two side by side, and when the visitor asks what the
   community rates highest for something, the community's list (members' ratings first, then
   forum mentions; never anything on FDA's safety-risk list), as reports, not recommendations.
   Totals only: never a post or a name. Each answer ends with where it came from (fact sheets and
   Signals, in totals).
6. **Combination agent** (no model: `relatives.ts`) says how what was named together relates,
   from the same pathways: the same receptor (overlap: little extra expected, side effects add),
   the same hormone by different routes (its effects and risks can add up), or different
   pathways (separate roads to a goal; only a study of the pair shows whether they add up). Not
   for comparisons.
   **Synergy auditor** (Claude Haiku) checks compounds together with the member's medicines and
   conditions: overlapping mechanisms, additive risks, interactions.
7. **Stack builder** shows a shortlist card "to discuss with a clinician"; anything on FDA's
   safety-risk list is never on it, and the auditor checks every shortlist. When someone names
   compounds they take or weigh together, it also lays out "Your stack", with the auditor's check
   on it (shown as it is, safety-risk items plainly marked rather than hidden). If the
   Recommender asks about their medicines first, the stack waits for their answers. Pairs never
   studied together are marked "unknown", not "good to know". The visitor can keep their stack
   on their own device (never sent anywhere).
8. **Safety agent, before anything is shown**: every paragraph of the reply, and every label on
   its cards, is read by Claude (Haiku) against the rules and released only once it's cleared,
   rewritten, or held back; if the check can't run, nothing unchecked goes out. Amounts in
   dosing units, supplement-extract brands and outside links are always taken out as well.
   Sig lists questions for the visitor's own clinician, who decides what's right for them (no
   one at Miracle Health reviews chats); the page copies them in one tap.

No doses, no sellers, no diagnosis, ever. Flags that matter for the rest of a chat (under 18,
pregnancy, an earlier crisis) carry over through Sig's own replies, which the page sends
back signed, so nobody can put words in its mouth. The page keeps the conversation in the
visitor's own browser tab; this function stores no messages and logs only timings and token
counts. To keep the free chat from being run up, the database counts messages per visitor
(an HMAC of their address, or its /64 for IPv6, with a random secret that changes daily and is
deleted after two days; never the address) and for the whole site: 8 per ten minutes, 40 a day,
1,000 a day in all (`private.settings`, keys `ask_*`; set `ask_enabled` to `off` to pause it).
A limit or a pause never turns away someone in crisis or describing an emergency: they get a
reply written in advance (988, or 911) with no AI call, and the message is still counted.
Models and effort can be changed with the GitHub variables `ASK_MODEL`, `ASK_FAST_MODEL`,
`ASK_FALLBACK_MODEL` and `ASK_EFFORT`. When the chat changes, "Deploy to test" asks the test
project eleven real questions (`scripts/ask_smoke.py`) and shows the answers on the run's page.

## Run it on your machine (no Docker needed)
```
scripts/local_db.sh up      # Postgres 16, set up like a Supabase project
scripts/local_db.sh reset   # rebuild from the migrations and seed data
scripts/local_db.sh test    # the access tests
scripts/local_db.sh lint    # Supabase's security lints
scripts/local_api.sh start  # a stand-in for Supabase's API and live updates, serving the app
```
Open http://127.0.0.1:54321 and sign in with any phone number and the code 123456; no invite
is needed. The moderator account is 555-555-0101.

Then: `node tests/e2e/flow.mjs` (browser test) and `node tests/e2e/attack_sim.mjs` (attack).

## Adding to the database later
Write a new file in `supabase/migrations/`. Supabase grants every new table to signed-in
and signed-out users by default, so each new table needs `alter table ... enable row level
security`, policies, and the same `revoke` and `grant` pattern as the foundation migration.
Add tests for it before it ships.
