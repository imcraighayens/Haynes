# Ecoloans — LEDGER console + Quik1 app

One repo, one Supabase database, two finished front-ends:

| App | Who uses it | Served at | Source |
| --- | --- | --- | --- |
| **LEDGER** — the staff console: clients, loans, applications, logbook, petty cash, bank, settings | Ecoloans staff, desktop | `/ledger/` (`/` redirects here) | `ledger/index.html` |
| **Quik1** — the customer app: sign up, apply for a loan, see the decision, repay | Customers, phone (440×940) | `/quik1/` (`/app` redirects here) | `quik1/index.html` |

A customer submits a loan application in Quik1; it lands in the shared `applications` table;
LEDGER picks it up through its **Q1 connected apps** panel (Ledger tab), staff approve or
decline, and the verdict shows up in the customer's phone. Everything else staff do in LEDGER (loans, payments, petty
cash, bank, expenses, settings) is saved to the same database and comes back on the next load,
on any machine.

Hosting: Vercel (static files + `api/` functions, no build step). Database: Supabase project
`ledger-ecoloans` (`rcektqecduuzqqmcsgat`). First-time setup is in [DEPLOY.md](DEPLOY.md); the
engineering contract is in [docs/BRIDGE-SPEC.md](docs/BRIDGE-SPEC.md).

## Rule zero: the apps are design-frozen

`ledger/index.html` and `quik1/index.html` (and the fonts, images, React and runtime files
beside them) are the two Claude Design bundles, unpacked verbatim. **Not one visual or
behavioural feature is changed.** The only two edits ever made inside those files:

1. LEDGER head: the runtime `<script>` is replaced by a boot shim (`ledger-sync.js`) that loads
   the same runtime after the cloud data is in place.
2. Quik1 head: one `<script src>` swapped from the demo-only link file to `quik1-link.js`.

Both apps already loaded their data layer dynamically; the bridge plugs into those seams. If a
change seems to need an edit to the app source inside `<x-dc>` / `text/x-dc`, it is the wrong
change. Readable copies of the original app logic sit in `ledger/original/` and
`quik1/original/` for reference only (never loaded, never deployed).

## Layout

```
ledger/                 LEDGER console (frozen) + 3 bridge modules
  index.html              design template + boot shim in <head>
  ledger-sync.js          boot pre-fetch, localStorage seeding, write mirror -> /api/ledger/sync
  ledjaa-db.js            LedjaaDB adapter the console imports; rows come from /api/ledger/state
  ledjaa-seed.js          SEED_LOANS = [] (no demo data, no "CSV lock")
quik1/                  Quik1 app (frozen) + 1 bridge module
  index.html              design template; script tag points at quik1-link.js
  quik1-link.js           window.Quik1Link backed by /api/quik1 (same API as the demo version)
api/                    Vercel Node functions, ESM, zero dependencies
  _lib/                   PostgREST client, auth, validation whitelists, rate limit, http helpers
  ledger.js              staff routes       (Bearer LEDGER_KEY)
  q1.js                  LEDGER's Q1 panel  (Bearer LEDGER_KEY)
  quik1.js               customer routes    (no auth; insert-only + read-own-by-id)
supabase/migrations/    20261029_quik1_bridge.sql — additive only
tests/  tools/  docs/   unit + boot tests, boot-test runner, the spec (not deployed)
vercel.json             redirects, security headers, cache rules
```

## How the bridge works

### Boot sequence

```
  LEDGER (/ledger/)                                  Quik1 (/quik1/)
  ─────────────────                                  ───────────────
  index.html <head>                                  index.html <head>
     │                                                  │
     ▼                                                  ▼
  ledger-sync.js (classic script)                    quik1-link.js (classic script)
     │ read localStorage['ledjaa.supabase']            │ defines window.Quik1Link synchronously
     │ {url:/api/ledger, key:LEDGER_KEY}               │ loads own records from localStorage
     │                                                  │ ['quik1-link-v1'], flushes outbox
     ├─ key set? ──GET /api/ledger/state──► api ──► Supabase
     │              (≤ 8 s, else local-only)            │
     │ seed localStorage: logbook, petty, bank,         ▼
     │ expenses, org, q1.apps (Quik1 entry)           dc runtime compiles the template,
     ▼                                                mounts React, app calls
  inject dc runtime <script> ─► compiles template,    Quik1Link.subscribe()/submit*()
     mounts React, app constructor reads the
     seeded localStorage synchronously
     │
     ▼
  app.initDb() → import('./ledjaa-db.js')
     │  (top-level await: db.ready = the same /state response)
     ▼
  db.toConsoleState() → {clients, loans, employees} → setState(dbReady:true)
     │
     ▼
  every later save: db.insert/update/softDelete + localStorage writes
     └─ debounced ──POST /api/ledger/sync──► api ──► Supabase (upsert / soft-delete only)
```

### Application flow

```
  phone                 Vercel API                 Supabase              LEDGER (admin browser)
  ─────                 ──────────                 ────────              ──────────────────────
  Quik1 "Apply"
    │ Quik1Link.submitApplication()
    │ id = 'ap_' + 12 hex (client-side, used as linkId at once)
    ├──POST /api/quik1/applications──► validate, rate-limit
    │                                  insert applications
    │                                  {source:'quik1', status:'new'} ──► row
    │◄── {id, status:'Needs decision'}
    │
    │  (every 6 s while undecided)                                      Q1 connected apps panel
    │                                                                   polls every minute:
    │                                   applications ◄──select──────── GET /api/q1/applications?status=new
    │                                   where source='quik1'            (Bearer LEDGER_KEY)
    │                                                                        │ qkMap → console rows
    │                                                                        ▼
    │                                                                   staff: Approve / Decline
    │                                   update status, decided_at,  ◄── PATCH /api/q1/applications/:id
    │                                   decision{verdict,amount,at}      {status:'approved'|'declined'}
    │
    ├──GET /api/quik1/applications/:id──► select by id ──────────────► {id, status:'Approved', decision}
    │◄── decision {verdict, amount, by, note, at}
    ▼
  Quik1 shows the verdict (same state shape the app always read); polling stops
```

Sign-ups (`POST /api/quik1/signups`) and service requests (`POST /api/quik1/requests`) follow the
same POST-then-poll pattern into `q1_signups` / `q1_requests`; repayment confirmations are read
from `q1_repayments` under the customer's own key (`app:<applicationId>`).

## Where data lives

| Data | Table | Written by |
| --- | --- | --- |
| Staff accounts | `employees` | LEDGER (via `ledjaa-db.js`) |
| Clients, loans | `clients`, `loans` | LEDGER (upsert; `deleted_at` instead of delete) |
| Loan applications (walk-in and Quik1) | `applications` (+ `meta`, `decision` from the migration) | Quik1 inserts; LEDGER decides |
| Logbook | `audit_log` (append-only) | LEDGER mirror (insert only) |
| Petty cash, bank transactions, expenses | `petty_cash`, `bank_tx`, `expenses` | LEDGER mirror |
| Org name, bank opening balance, contract text | `settings` (single row `org`) | LEDGER mirror (fee/NCR columns stripped) |
| Full-state backup from Settings → Supabase | `ledger_book` | LEDGER's own "Supabase book" feature, pointed at `/api/ledger` |
| Customer sign-ups, requests, repayment flags | `q1_signups`, `q1_requests`, `q1_repayments` | Quik1 / bridge |

Browsers keep a cache (`localStorage`) so both apps open instantly and work offline; the cloud
copy is the source of truth and wins on the next load.

## Security model

* **Service role key is server-only.** Only the Vercel functions hold `SUPABASE_SERVICE_ROLE_KEY`;
  it never appears in either app, in git, or in a response. Supabase RLS stays as it was: no
  `anon` access to any table, staff-only policies on the new tables.
* **`LEDGER_KEY` lives in the admin's browser.** Staff paste it once under Settings → Supabase
  (`localStorage['ledjaa.supabase'].key`). Every `/api/ledger/*` and `/api/q1/*` call sends it
  as `Authorization: Bearer …`; the server compares it in constant time. Rotate it by changing
  the Vercel env var and pasting the new value in Settings.
* **Public routes are insert-only.** `/api/quik1/*` has no auth, is rate-limited per IP
  (~30 req/min), caps bodies at 16 KB, whitelists every field, and can only insert a new row or
  read one row by its unguessable id. It cannot list, update or delete anything.
* **The server never deletes.** Rows are retired with `deleted_at`; `audit_log` is never
  updated; the Postgres triggers that enforce this stay in place.
* Responses are `Cache-Control: no-store`; nothing logs names, ID numbers or bank details.
* Site-wide headers (`vercel.json`): `nosniff`, `Referrer-Policy`, `Permissions-Policy`
  (camera/mic/geolocation off — neither app uses them) and `frame-ancestors 'self'`, which
  stops other sites framing the apps while leaving LEDGER's own YouTube embed untouched.

## What is auto-approved, and why

**Quik1 sign-ups** are stored with `status: 'Approved'` immediately (`decided_by: 'auto'`).
The Quik1 design shows a "Pending review" screen that only clears when a reviewer approves,
and nothing in LEDGER reviews sign-ups; without auto-approval every new customer would wait
forever. A sign-up only creates a login identity — it grants no money. **Loan applications are
never auto-approved**: every one waits for a staff decision in LEDGER.

## What is not touched

* NCR registration, company registration, fee logic (`default_collection_fee`, `protection_fee`),
  contract clauses: the server strips these columns from every write and the migration never
  references them.
* Existing tables, policies, triggers, `is_staff()` / `is_admin()`: the migration is additive
  (two nullable/defaulted columns on `applications`, four new tables, idempotent indexes).
* The two apps' design and behaviour (rule zero).

## Local testing

```
npm test            # unit tests, node:test, fetch mocked — no network
npm run boot:ledger # headless boot of /ledger → /tmp/ledger.png (Playwright, preinstalled globally)
npm run boot:quik1  # headless boot of /quik1  → /tmp/quik1.png
```

Full stack locally: copy `.env.example` to `.env`, fill it in, run `vercel dev`, open
`http://localhost:3000/ledger/`, paste `LEDGER_KEY` under Settings → Supabase → Connect, then
submit a test application from `http://localhost:3000/quik1/`. Details in
[tests/README.md](tests/README.md).
