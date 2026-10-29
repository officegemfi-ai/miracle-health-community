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
injury healing, sleep...): Miracle AI reads what each report was for (the list is
`shared/uses.json`), and a use gets its own rating from members' reports once three name it, next
to how often the public forums mention it. `web/lib/signalviz.js` draws these as plain SVG,
so the public library on miraclehealth.us can use the same drawings.

## What's where
- `supabase/migrations/`: the database (tables, access rules, the checks on every post, moderation)
- `supabase/tests/database/`: 400 access, Community Signal, certification, ratings-by-use, game, stack and chat-limit tests (pgTAP)
- `supabase/functions/`: `review-content` (Claude's first read: the rules, and each post's outcome for the Signal),
  `delete-account`, and `ask`: Miracle AI's chat on the public website (miraclehealth.us/ai), below
- `web/`: the app (plain HTML, CSS and JavaScript modules in `web/lib/`; no build step)
- `shared/rules.json`, `shared/uses.json`: the community rules and the list of uses, copied to the app and
  the AI reviewer by `scripts/sync_rules.sh`
- `shared/signal_baseline.json`: the Community Signal's public-forum starting point, loaded by a migration
  that `scripts/build_signal_baseline_sql.mjs` generates (CI checks they match)
- `web/preview/`, `scripts/build_preview.mjs`: the preview: the same migrations running in the browser
  (PGlite) with a sample community (preview builds only)
- `tests/e2e/`: real-browser tests (the whole flow with three people and live updates, the site
  password, the preview) and a scripted spam attack
- `.github/workflows/`: tests on every change, deploy to test, promote to live
- `docs/SETUP.md`: the one-time setup; `docs/evidence/`: test results and the forum research

## Miracle AI's chat (`supabase/functions/ask`)
Anyone can talk with Miracle AI on miraclehealth.us/ai about improving with peptides,
supplements, hormones and the medicines taken with them; no account needed. Each message goes
through four agents, and the page shows each step as it happens:

1. **Safety agent** (Claude Haiku) reads the message first: emergencies (911), signs of crisis
   (988), under-18s, pregnancy, medicines and conditions, and requests for doses or sellers.
2. **Recommender** (Claude Sonnet, the voice of the chat) works from the public Library
   (`miraclehealth.us/library/data/index.json` and each fact sheet) and the Community Signal
   (`snapshot.json`), with tools to rank options for a goal, open fact sheets and search. It
   talks like a caring clinician, briefly: it asks or answers, never both. When it doesn't yet
   know what would change its answer, it first asks 2 to 4 questions, the way a clinician takes
   a history (age range, sex, medicines, conditions, what they've tried), on a card the visitor
   answers by tapping or typing; past a full answer, it can only end with one question in prose.
   It never asks for names, contact details, birthdays, amounts taken or where things come from.
   Warning signs are never worded by the model: it picks them from a fixed table
   (`urgency.ts`, drafted from public medical guidance, not yet reviewed by a clinician), and
   the page shows each under its level: call 911 now, same day, or this week. Someone who
   says they inject gets the safety basics once in a chat (adults only); questions about a
   product's quality point to the Library's guide to reading a lab report.
3. **Synergy auditor** (Claude Haiku) checks compounds together with the member's medicines and
   conditions: overlapping mechanisms, additive risks, interactions.
4. **Stack builder** shows a shortlist card "to discuss with a clinician"; anything on FDA's
   safety-risk list is never on it, and the auditor checks every shortlist. When someone names
   compounds they take or weigh together, it also lays out "Your stack", with the auditor's check
   on it (shown as it is, safety-risk items plainly marked rather than hidden). If the
   Recommender asks about their medicines first, the stack waits for their answers. Pairs never
   studied together are marked "unknown", not "good to know". The visitor can keep their stack
   on their own device (never sent anywhere).
5. **Safety agent, before anything is shown**: every paragraph of the reply, and every label on
   its cards, is read by Claude (Haiku) against the rules and released only once it's cleared,
   rewritten, or held back; if the check can't run, nothing unchecked goes out. Amounts in
   dosing units, supplement-extract brands and outside links are always taken out as well.
   Nothing here is a plan until the visitor's own clinician, outside Miracle Health, has
   reviewed it (no one at Miracle Health reviews chats). The page builds a review packet the
   visitor takes to their own clinician (print or PDF, or a QR
   code and link that carry the packet in the URL fragment to `miraclehealth.us/ai/packet/`, so
   no server ever receives it); after the visit they mark it reviewed, in their own browser.

No doses, no sellers, no diagnosis, ever. Flags that matter for the rest of a chat (under 18,
pregnancy, an earlier crisis) carry over through Miracle AI's own replies, which the page sends
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
project eight real questions (`scripts/ask_smoke.py`) and shows the answers on the run's page.

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
