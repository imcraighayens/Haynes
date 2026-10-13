# Quik1 app

The Quik1 customer app (iOS, Android, installable web), its back office and its database. The PRD and the open decisions are in [`docs/quik1/PRD.md`](../../docs/quik1/PRD.md).

## How the look is kept exactly as delivered

The delivered design is a single bundled HTML prototype ([`docs/quik1/design-source/quik1-prototype.html`](../../docs/quik1/design-source/quik1-prototype.html)). Nothing in it was redrawn by hand.

| Step | What it does |
|---|---|
| `npm run extract` | Unpacks the bundle into `design/`: `template.html`, `logic.js`, `props.json`, `global.css`, plus fonts and images in `public/assets/`. |
| `npm run compile` | `scripts/compile-template.mjs` compiles the template language into React (`src/generated/`), producing the **same DOM** the prototype's runtime produced. The logic class ships verbatim. |
| `design/overrides.mjs` | The **only** intentional changes, each with a reason and an exact-match count. If a re-export of the design doesn't match, the build fails. |
| `npm run parity` | Drives the prototype and the build into 29 screen states and pixel-diffs them. Every screen must stay within 1%. |

Current overrides:
- splash illustration removed
- demo persona (name, initials, bank) replaced by the signed-in customer's
- the prototype's pinned date replaced by the real date
- statement logo path fixed

If the design is updated, re-export the bundle over `docs/quik1/design-source/quik1-prototype.html`, then run `npm run extract && npm run build && npm run parity`.

## Architecture

```
src/generated/      compiled design (template.tsx, logic.js, pseudo.css)      — generated, not committed
src/runtime/        DCHost/DCLogic: hosts the design's logic class
src/app/            production layer
  Quik1App.ts         subclass of the design logic; swaps only the handlers that touch
                      identity, money or messages, and hydrates from the server
  api.ts              every network call (Supabase RPC + edge functions + storage)
  link.ts             server-backed replacements for the prototype's window.Quik1Link / window.claude
  errors.ts           server error codes → the design's own toast copy
src/admin/          back office (admin.html)
src/native.ts       Capacitor: Preferences, status bar, Face ID / fingerprint
supabase/
  migrations/         schema, lending rules, RLS, retention
  functions/auth      sign-up, 4-digit SMS code, PIN on trusted devices → Supabase session
  functions/assistant Q1 assistant (Claude), prompt + account facts built server-side
  tests/              lending + RLS tests (run against plain Postgres)
ios/ android/       Capacitor native projects (launch screens blank black)
```

**Two modes.**
- **Live:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set. Real accounts, server-side rules.
- **Demo:** neither variable is set, or the URL has `?demo`. The prototype runs unchanged, for design review.

**Where the rules live.**
- Every price, limit and decision is computed and enforced in Postgres: `quote`, `customer_headroom`, `submit_application`, `accept_offer`, `request_settlement`.
- The app's own checks are only there for quick feedback.
- Pricing is the `products` table. Changing it needs no code change.

**Pilot mode** (`app_config.pilot`, on by default):
- Payouts are recorded as `held_pilot`, so no money moves.
- Debit-order approvals and collections use a mock provider.
- Document checks use the prototype's filename rules (marked `mock-filename-check` on every row).

## Commands

```bash
npm install
npm run dev          # http://localhost:5174 (demo mode unless .env is set); back office at /admin.html
npm run build        # compile design + typecheck + build (app + admin)
npm test             # live-mode integration tests (vitest)
npm run parity       # visual parity (needs `npx vite preview --port 4173` running)
./scripts/db-test.sh # migrations + lending/RLS tests on a throwaway Postgres
cd supabase/functions && deno check auth/index.ts assistant/index.ts && deno test _shared/
npx cap sync && npx cap open android|ios   # native projects
```

CI (`.github/workflows/quik1.yml`) runs all of the above on every pull request, and also builds a debug APK and an unsigned iOS simulator build.

Deploying: [`docs/quik1/DEPLOY.md`](../../docs/quik1/DEPLOY.md). Before real lending: [`docs/quik1/COMPLIANCE.md`](../../docs/quik1/COMPLIANCE.md).
