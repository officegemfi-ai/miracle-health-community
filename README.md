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
- `supabase/tests/database/`: 384 access, Community Signal, certification, ratings-by-use, game and stack tests (pgTAP)
- `supabase/functions/`: `review-content` (Claude's first read: the rules, and each post's outcome for the Signal) and `delete-account`
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
