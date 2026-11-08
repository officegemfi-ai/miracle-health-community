# The community app's architecture

The app in `web/` is plain JavaScript modules with no build step. Its code is in four layers. Each
layer imports only from the layers inside it, so a change to how a page looks can't break a rule,
and a change to the database is made in one place.

```
             ┌──────────────────────────────────────────────┐
  app.js ──▶ │ ui/    the page: frame, rail, components,    │  draws, listens, routes
             │        pages, router                         │
             ├──────────────────────────────────────────────┤
             │ app/   the store (S), the use cases that     │  what the app knows
             │        fill it, live news                    │
             ├──────────────────────────────────────────────┤
             │ data/  Supabase, the network, storage,       │  the only way out
             │        analytics                             │
             ├──────────────────────────────────────────────┤
             │ core/  the rules: pure functions             │  no page, no network
             └──────────────────────────────────────────────┘
  kit/  Miracle Health's design kit, shared with the website (scripts/sync_kit.sh)
```

## The rules

`scripts/check_layers.mjs` checks these on every change (CI), and fails naming the file and the rule
it broke:

| Layer | May import | May not |
| --- | --- | --- |
| `core/` | nothing but `core/` | touch the page, the network, storage or the store |
| `data/` | `core/`, `kit/` | draw anything or read the store |
| `app/` | `core/`, `data/` | touch the page |
| `ui/` | `core/`, `data/`, `app/`, `kit/` | call Supabase, `fetch` or storage directly |
| `app.js` | everything | (it only wires things together and starts the app) |

And for all of them: no two modules import each other, directly or round a loop.

## What lives where

```
web/
├── app.js                composition root: connect, wire the frame, the live news and the router, boot
├── core/                 the rules, each testable on its own (tests/web/core.test.mjs)
│   ├── format.js         numbers, counts, "3h ago"
│   ├── errors.js         errors in plain words
│   ├── phone.js          a typed phone number as sign-in needs it
│   ├── gate.js           the beta password's key (Web Crypto)
│   ├── routes.js         what a #/link means; which places are worth returning to after sign-in
│   ├── signal.js         outcomes, causes, a Signal's move, where its data came from
│   ├── library.js        search by name, brand or nickname; stacks and blends
│   ├── posts.js          report reasons, a title from the first sentence, the comment tree
│   ├── reads.js          Sig's read in one line; what a report may have been for
│   ├── game.js           progress to the next emblem, quests ready to claim, the season
│   └── notifications.js  what a moderator's action says
├── data/                 the only code that reaches outside the page
│   ├── client.js         the one Supabase client (public key only)
│   ├── rows.js           paging past the API's 200 rows
│   ├── auth.js           sign-in by text, joining, deleting an account
│   ├── posts.js          the feed and its scopes, votes, "same for me", stickers, reports
│   ├── comments.js  members.js  spaces.js  signal.js  notifications.js  checks.js  moderation.js
│   ├── library.js        the Library's grades and index, suggesting a compound
│   ├── live.js           the realtime channel, handed to app/events.js
│   ├── storage.js        guest draft, return-to link, invite code, the gate's key
│   ├── lists.js          rules.json, uses.json, baselines.json
│   ├── scripts.js  telemetry.js  config.js
├── app/
│   ├── store.js          S and the questions asked of it (spaceOf, signalOf, levelOf, claimable…)
│   ├── session.js        use cases: load who's signed in and what the frame needs, the Signal,
│   │                     history, card, pulse, quests, unread; join a space; sign out; live
│   └── events.js         live news by topic (signal, notification, post)
├── ui/
│   ├── dom.js  art.js    elements, icons, toasts, dialogs; Sig, emblems, tiles, sparklines
│   ├── shell.js          the frame: menu, top bar, tabs, search, footer, Sig in the corner
│   ├── rail.js           which cards go beside which page
│   ├── router.js  current.js  next.js  tips.js  enter.js  live.js
│   ├── components/       pieces used on several pages: post, signal, moves, game, notifications,
│   │                     checks, feed, spaces, picker, report, bodymap (the kit's body map on a space)
│   └── pages/            one module per page: home, space, explore, new-post, stack, post, signal,
│                         profile, builders, quests, notifications, onboarding, moderation, info,
│                         account, auth, gate
└── kit/                  kit.js, kit.css, signalviz.js, bodymap.js (copies of shared/kit)
```

## Adding something

- **A new database call**: a function in the right `data/` module, returning the Supabase builder
  or result as it is. Pages never write `sb.`.
- **A rule** (a calculation, a wording that depends on data, a validation): a pure function in
  `core/`, with a test in `tests/web/core.test.mjs`.
- **Something every screen needs to know**: a field in `S` (`app/store.js`) and a loader in
  `app/session.js`.
- **A page**: a module in `ui/pages/`, its route in `ui/router.js`, its rail in `ui/rail.js`.
  Pages may use components; components never import pages.
- **A reaction to a live change**: in `ui/live.js`, which `app.js` wires once at start.

## Checks

- `node --test tests/web/*.test.mjs`: the rules in `core/`
- `node scripts/check_layers.mjs`: the layers above
- `tests/e2e/flow.mjs`, `gate.mjs`, `preview.mjs`: the whole app in a real browser (CI)
