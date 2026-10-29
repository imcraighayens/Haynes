# Ecoloans — LEDGER console + Quik1 app on Vercel + Supabase

This repo hosts two finished front-ends and the thin bridge that makes them
share one Supabase database (`ledger-ecoloans`, project ref `rcektqecduuzqqmcsgat`).

**Rule zero: the two apps are design-frozen.** `ledger/index.html` and
`quik1/index.html` (plus the runtime/font/image/react files next to them) are
unpacked verbatim from Claude Design bundles. Not one visual or behavioural
feature changes. All integration lives in *pluggable modules the apps already
load dynamically* and in a small server API. If you think you need to edit the
app source inside `<script type="text/x-dc">`, stop — find the seam instead.

Readable copies of the app logic for reference only (never loaded at runtime):
`ledger/original/app.dc.source.txt`, `quik1/original/app.dc.source.txt`,
`ledger/original/ldbStandalone.local.js`, `quik1/original/quik1-link.local.js`.

## Layout

```
ledger/                 LEDGER console (desktop). Served at /ledger/
  index.html            design template (frozen) + tiny boot shim
  ledjaa-db.js          NEW  LedjaaDB adapter backed by the API (same API as ldbStandalone)
  ledjaa-seed.js        NEW  re-exports SEED_LOANS = [] (disables the "CSV lock")
  ledger-sync.js        NEW  boot pre-fetch + localStorage mirror (logbook/petty/bank/expenses/settings)
quik1/                  Quik1 customer app (mobile, 440x940). Served at /quik1/
  index.html            design template (frozen); script tag points at quik1-link.js
  quik1-link.js         NEW  window.Quik1Link backed by the API (same API as the local one)
api/                    Vercel Node 22 serverless functions (ESM)
  _lib/                 shared helpers (supabase REST client, auth, validation, rate limit)
  ledger/[...path].js   staff endpoints  (Bearer LEDGER_KEY)
  q1/[...path].js       LEDGER's "Quik1 loan app" integration endpoints (Bearer LEDGER_KEY)
  quik1/[...path].js    public customer endpoints (no auth; insert-only + read-own-by-id)
supabase/migrations/    additive SQL for the bridge tables/columns
tests/                  node:test unit tests + Playwright boot tests
tools/                  unpack-bundle.py (how the apps were unpacked), boot-test.js
vercel.json             redirects / → /ledger/, /app → /quik1/; security headers
```

## How each app loads its data layer (the seams)

### LEDGER
* Boot: `index.html` head defines `window.__resources` (map of ext ids → local files)
  and loads the dc runtime `c53b361c-….js`, which compiles the `<x-dc>` template and
  the `text/x-dc` class and mounts React. The app constructor reads localStorage
  synchronously (`evoltConsoleV4`, `evoltOrg`, `ledjaa.*`, `q1.apps`, `ledjaa.supabase`).
* Verified: the runtime boots correctly if its `<script>` is injected *after*
  `DOMContentLoaded` (even seconds later). So `ledger-sync.js` runs first, awaits the
  cloud pre-fetch, seeds localStorage, THEN injects the runtime script.
* After mount the app calls `initDb()`:
  `import(window.__resources.ldbStandalone || './ledjaa-db.js').then(m => { this.ldb = m.db;
  const actor = m.db.table('users').find(u=>u.role==='admin'); if(actor) m.db.setActor(actor.id);
  const s = m.db.toConsoleState(); this.csvLock(m, s); if(s.clients.length){ setState({clients, loans, employees, dbReady:true, prof}) } })`
  — so `m.db` must already hold cloud rows when the import resolves. Use top-level
  `await` in `ledjaa-db.js` (`export const db = new LedjaaDB(); await db.ready;`).
* `csvLock(m, s)` imports `./ledjaa-seed.js` and reads `SEED_LOANS`; with `[]` it is a no-op.
* On every state change the app calls `persist()` → `dbPush()` (only when `state.dbReady`):
  for each state client → `db.find('clients',id)` then `db.update('clients', id, patch)` or
  `db.insert('clients', {...})`; same for `users` (from `state.employees`) and `loans`;
  then `db.rows('loans')`/`db.rows('clients')` not present in state → `db.softDelete(...)`.
  **Therefore `toConsoleState()` must return EVERY non-deleted client and loan** or the
  console will archive the missing ones on its next save.
* dbPush column vocabulary (ldb v1.7 names) → live table columns:
  * clients: `id_number, job_title, net_salary, account_no, account_type, branch_code, blocked,
    blocked_at(ignore), score, ref, name, email, phone, address, city, province, employer,
    dob, employment, tenure, officer_id, branch_id(ignore), created_at, retain_until, deleted_at`
  * users → `employees`: `name, email, role(admin|manager|agent|collections|auditor), active,
    approval_limit, created_at, last_login_at(ignore), relogin_required_at(ignore), branch_id/client_id(ignore)`
  * loans: `ref, client_id, principal, return_rate_pct, status, due_date(ignore – derive), purpose,
    instalment → instalment_amount, schedule(ISO dates), issued_on, issued_by, employee_id → officer_id,
    mandate_id, instalments_paid, term_months(ignore), initiation_fee/service_fee(ignore),
    disbursed_on(ignore), parent_loan_id/relation(ignore), written_off_*, officer_id, created_at, deleted_at`
* The app ALSO has a native "Supabase book" feature (Settings → Supabase): config in
  `localStorage['ledjaa.supabase'] = {url, key, table:'ledger_book', bookId:'main', connected, ...}`.
  It calls `fetch(url + '/rest/v1/' + table + '?select=id&limit=1')`,
  `GET …/rest/v1/ledger_book?id=eq.main&select=payload,updated_at,updated_by`,
  `POST …/rest/v1/ledger_book?on_conflict=id` (body `[{id,payload,updated_at,updated_by}]`,
  header `Prefer: resolution=merge-duplicates,return=minimal`) with headers
  `apikey: key`, `Authorization: Bearer key`. We point `url` at `/api/ledger` and serve those
  exact paths — the book becomes a full-state backup. **The adapter and the mirror reuse the
  same `url` + `key` from `ledjaa.supabase`** (key = `LEDGER_KEY`).
* Q1 connected apps: `localStorage['q1.apps']` is a list of entries
  `{id, name, url, path, key, proxy, on, actions, hint, pathHint}`. The entry whose name
  matches `/quik1/i` is polled every minute: `GET url+path` (path default
  `/applications?status=new`) with `Authorization: Bearer key` (+`apikey` if url matches
  /supabase/i). Response: JSON array or `{applications|data|items|results}`. Each row is mapped
  by `qkMap` — accepted keys: `id|applicationId|application_id|ref|reference` (ext id),
  `name|fullName|full_name`, `phone|mobile|cell|contact|phoneNumber`, `email`,
  `idNumber|id_number|saId|nationalId`, `amount|loanAmount|loan_amount|requested`,
  `term|months|instalments|installments` (int), `purpose|reason`, `employer|company`,
  `jobTitle|job_title|occupation`, `income|netIncome|net_income|salary|netSalary`,
  `bank|bankName|bank_name`, `docs|documents` (array), `submitted|createdAt|created_at|date`,
  and rows whose `status` matches `/declin|approv|reject|cancel/i` are skipped.
  Decisions go back as `PATCH url + '/applications/' + extId` body `{"status":"approved"|"declined"}`.
  Console state for a Q1 application: `{id:'qk_'+ext, extId, name, phone, email, idNumber, amount,
  term, purpose, employer, jobTitle, income, bank, docs, status:'new', source:'Quik1 app · via Q1', submitted}`.
* Logbook entries (`state.logbook`, written by `logAdd`) look like
  `{ref, customer, amount, type:'LOAN ADDED'|'PAYMENT RECEIVED'|…, date, by, comment, id?, at?}` —
  check `logAdd` in the source for the exact id/time fields.
* Petty cash entries (`state.petty`, form `pcf:{borrower,amount,purpose,notes,cat,date}`) —
  check the source for the stored shape.
* Bank: `localStorage['ledjaa.bank'] = {balance, at, by, history}`, `['ledjaa.bank.tx'] =
  [{type:'in'|'out', amount, ref, label, at, by}]`, `['ledjaa.expenses'] = [{name, amount, …}]`,
  `['evoltOrg'] = {name, admin, email, …}`, `['ledjaa.lent'] = {ECL-ref: amountLent}`,
  `['ledjaa.clientRefHigh']`.
* Loan fields the console reads (from grep): `status sched id ref due clientId amount instTotal
  paidInst ret instRemaining instDone retAmt issued term mandate purpose nextDue lent instNo`.
  Client fields: `name id contract ref idFull bank phone blocked netSalary employee account city
  score employer added jobTitle employment province email address`.
  **Grep the source for `statusMeta`, `instNorm`, `pifAmt`, `isCsvLoan`, `lentOf`, `lentNum`,
  `todayStamp`, `slParse` to learn the exact status vocabulary and date formats before mapping.**
  Dates in console state are labels like `25 Jun 2026`; DB dates are ISO `2026-06-25`.

### Quik1
* `index.html` loads `quik1-link.js` (was `e8b7a801-….js`) BEFORE the runtime; it must
  define `window.Quik1Link` synchronously with exactly this API (see
  `quik1/original/quik1-link.local.js`): `getState()`, `subscribe(fn)` (calls fn immediately and on
  every change, returns unsubscribe), `submitApplication(app)` → id,
  `submitRequest(req)` → id, `submitSignup(rec)` → id, `decideSignup(id, verdict, by, note)`,
  `decide(id, verdict, amount, by, note)`, `confirmRepayment(key, by, ok)`, `repaymentFor(key)`,
  `decisionFor(id)`, `reset()`.
  State shape consumed by the app: `{applications:[{id, submittedAt, status, source, name, phone,
  amount, term:'3 mo', purpose, income, surplus}], decisions:{[id]:{verdict:'approved'|'declined'|
  'escalated'|'info', amount, by, note, at}}, requests:[…], signups:[{id, status:'Pending review'|
  'Approved'|'Declined', submittedAt, reviewer, decidedAt, by, note, name, idnum, phone, email,
  employment, employer, income, payday}], repayments:{[key]:{ok, by, at}}}`.
  The app reacts to: `signups` status for `state.suRef`; `decisions[state.linkId]` (compares `.at`);
  `repayments.app.ok`.

## Live database (do not restructure; additive migration only)

Postgres 17, schema `public`. RLS: every table requires `authenticated` + `is_staff()`
(no anon access anywhere). Triggers block hard DELETE on `clients, loans, audit_log, bank_tx`
and block UPDATE on `audit_log` (append-only). The server uses the **service role** key
(bypasses RLS) and must enforce the same discipline in code: never DELETE, only
`deleted_at`; never UPDATE `audit_log`.

Columns (★ = NOT NULL without default):
* `employees`: id★ name★ email★(unique) role(default 'agent'; admin|manager|agent|collections|auditor) active approval_limit created_at updated_at updated_by
* `clients`: id★ ref★ name★ id_number dob(date) email phone address city province employment employer job_title tenure net_salary gross_salary other_income expenses(jsonb {rent,other,groceries,otherDebt,transport}) bank branch_code account_no account_type officer_id score blocked contract(jsonb {no,signedOn,signature}) created_at created_by retain_until deleted_at updated_at updated_by
* `loans`: id★ ref★ client_id★ application_id principal principal_derived return_rate_pct(35) instalment_amount★ collection_fee schedule(jsonb ISO date array) instalments_paid prior_instalments status(issued|overdue|paid|settled_early|written_off) status_at mandate_id contract_ref paid_dates(jsonb) purpose issued_on issued_by officer_id created_at written_off_at write_off_reason deleted_at updated_at updated_by
* `applications`: id★ ref★ client_id name★ phone email id_number employer job_title net_income bank amount★ term_months(1) purpose('Personal') source('Walk-in') status(new|reviewing|approved|declined) decline_reason decided_by decided_at loan_id created_at updated_at updated_by  — migration adds `meta jsonb default '{}'` and `decision jsonb`
* `audit_log`: id★ at type★ ref('—') customer('—') amount(0) by★ comment('') updated_at updated_by   (append-only)
* `petty_cash`: id★ date★ amount★ category(travel|office|airtime|meals|advance|other) purpose★ borrower('') notes('') status(PENDING|APPROVED|REPAID|DECLINED) by★ created_at updated_at updated_by
* `expenses`: id★ name★ amount deleted_at updated_at updated_by
* `bank_tx`: id★ at type★(in|out) amount★ ref('—') label('') by★ updated_at updated_by
* `settings`: id('org', only row) org_name org_legal_name ncr_reg_no company_reg_no tagline address contact_email contact_phone website default_return_rate_pct default_collection_fee protection_fee bank_opening_balance bank_opening_at mask_pii contract_intro contract_clauses updated_at updated_by
  (currently NO row exists — treat absent as defaults; upsert id='org' on first write.)

Current data: 15 clients, 112 loans (88 paid, 9 settled_early, 8 overdue, 7 issued), 196 audit
rows (types: PAYMENT RECEIVED, LOAN UPDATED, DEBIT FAILED, NUPAY IMPORT, MANDATE REJECTED),
1 employee (`e1` Craig Moatshe, admin). Loan ids look like `l_nupay_80786120`, client ids
`c_nupay_15`, loan refs `ECL-112`, client refs `EC-015`. `audit_log.by` holds employee ids
(`e1`) in existing rows; the console writes names — map both ways (id → employee name on read).

### Migration (additive only; file `supabase/migrations/20261029_quik1_bridge.sql`)
* `alter table applications add column if not exists meta jsonb not null default '{}'::jsonb, add column if not exists decision jsonb;`
* `create table if not exists ledger_book (id text primary key, payload jsonb not null, updated_at timestamptz not null default now(), updated_by text);`
* `create table if not exists q1_signups (id text primary key, status text not null default 'Pending review', name text not null, id_number text, phone text, email text, employment text, employer text, income numeric default 0, payday text, reviewer text default 'applications@ecoloans.co.za', decided_at timestamptz, decided_by text, note text default '', meta jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());`
* `create table if not exists q1_requests (id text primary key, type text not null, detail text default '', name text default '', "to" text default '', status text not null default 'New', meta jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());`
* `create table if not exists q1_repayments (key text primary key, ok boolean not null default true, "by" text default 'Admin', at timestamptz not null default now());`
* enable RLS on all four new tables; add `staff read` (`authenticated`, `using (is_staff())`) policies, plus `admin write` on ledger_book (`is_admin()`); nothing for `anon`.
* Never touch: `ncr_reg_no, company_reg_no, default_collection_fee, protection_fee`, fee logic, contract clauses, `is_staff/is_admin`, existing policies/triggers.

## Server API (`api/`)

* Runtime: Vercel Node 22 (`engines.node` = `22.x` in package.json), ESM (`"type":"module"`), zero npm dependencies (use global `fetch`).
  Each file `export default async function handler(req, res)`. Catch-all routes:
  `api/ledger/[...path].js`, `api/q1/[...path].js`, `api/quik1/[...path].js`.
* Env: `SUPABASE_URL` (`https://rcektqecduuzqqmcsgat.supabase.co`), `SUPABASE_SERVICE_ROLE_KEY`,
  `LEDGER_KEY` (long random secret shared with the console). Optional `ALLOWED_ORIGIN`.
  Missing env → 503 with a plain message, never a stack trace.
* `_lib/supabase.js`: PostgREST helper (`select(table, query)`, `upsert(table, rows, onConflict)`,
  `update(table, match, patch)`, `insert`) sending `apikey`/`Authorization` service headers,
  `Prefer: return=representation` where needed; `_lib/auth.js`: `requireStaff(req)` does a
  constant-time compare of the Bearer token (also accept `apikey` header) against `LEDGER_KEY`;
  `_lib/validate.js`: column whitelists per table + status maps; `_lib/ratelimit.js`:
  best-effort in-memory per-IP limiter for public routes (e.g. 30 req/min).
* Staff (`/api/ledger/*`, Bearer LEDGER_KEY):
  * `GET state` → `{clients, loans, employees, applications (newest 500), audit_log (newest 1000),
    petty_cash, bank_tx (newest 500), expenses, settings|null, ledger_book:{updated_at}|null, server_time}`
    (include `deleted_at` rows; client filters). Unlimited tables are paged through PostgREST's
    `db-max-rows` cap and checked against `Content-Range`; a snapshot that cannot be completed is a
    503 `partial state`, never a truncated book.
  * `POST sync` body `{ops:[{table, op:'upsert'|'insert'|'update'|'soft_delete', rows?, id?, patch?, reason?}]}`
    — applies in order with per-table whitelists; `audit_log` and `bank_tx` accept insert/upsert
    only (ignore duplicates: `on_conflict=id` + `resolution=ignore-duplicates`); `settings` is
    upsert on id='org' with the NCR/fee columns stripped; soft_delete sets `deleted_at`
    (and `write_off_reason`/`delete_reason` never — just `deleted_at`). Returns
    `{ok, results:[{table, op, count, error?, retryable?}]}` — partial failures are reported, not
    thrown; `retryable:true` (upstream unreachable / 5xx / 429) tells the clients to keep the op
    and retry with backoff, anything else is final and dropped.
  * `GET rest/v1/ledger_book?...` and `POST rest/v1/ledger_book?on_conflict=id` (PostgREST
    semantics the console expects: `id=eq.main`, `select=`, `limit=`; respond with JSON arrays).
    The book is a **write-only backup**: a GET that projects `payload` returns it without
    `clients/loans/employees/applications`, so the console's own "Stored book is missing records"
    guard stops sbPull from restoring a stale snapshot over the live tables (sbPush still works).
* Q1 integration (`/api/q1/*`, Bearer LEDGER_KEY) — shaped for `qkMap`/`qkPush`:
  * `GET applications?status=new` → JSON array of `applications` rows where `source='quik1'`
    (default status filter `new`; `status=all` for everything) each augmented with
    `term: term_months, income: net_income, submitted: created_at, docs: meta.docs||[]`.
  * `PATCH applications/:id` body `{status}` (`approved|declined|reviewing|new`) → update row:
    `status, decided_at (now for approved/declined), decided_by:'ledger',
    decision: {verdict, amount: amount, by:'Ecoloans', note:'', at: now}`; returns the row.
* Public customer routes (`/api/quik1/*`, no auth, rate-limited, JSON only, 16 KB body cap):
  * `POST applications` body = Quik1Link app record → insert `applications` row:
    `id:'ap_'+random(12 hex), ref:'AP-'+(1085+count)` (use count query), `name, phone, email?,
    id_number?, amount (number > 0, ≤ 50000), term_months: parseInt(term)||1, purpose, net_income:
    income, employer?, job_title?, bank?, source:'quik1', status:'new',
    meta:{surplus, submittedAt, client:'quik1', raw: <whitelisted extras>}` → `201 {id, ref, status:'Needs decision'}`.
    A POST whose id already exists answers `200 {id, ref, status, decision}` from the stored row
    (retries never mint a second ref or reset a decided status). Before inserting, two DB-backed
    throttles (they survive cold starts, unlike the in-memory limiter) answer 429: more than
    `QUIK1_HOURLY_CAP` (60) quik1 applications in the last hour, or `QUIK1_PHONE_DAILY_CAP` (3)
    from the same phone in 24 h. Stored rows stay small: ≤ 5 doc names of ≤ 80 chars, raw extras ≤ 60 chars.
  * `GET applications/:id` → `{id, status, decision}` mapped for the app:
    `status: new|reviewing→'Needs decision', approved→'Approved', declined→'Declined'`,
    `decision: null | {verdict:'approved'|'declined', amount, by, note, at (ms)}`.
    404 for unknown ids; ids are unguessable so no auth.
  * `POST signups` → insert `q1_signups` with **status 'Approved'** immediately (auto-approval
    policy; `decided_by:'auto'`, `note:'Auto-approved by Quik1 bridge'`) → `{id, status}`.
    `GET signups/:id` → `{id, status, decidedAt, by, note}`.
  * `POST requests` → insert `q1_requests` → `{id, status:'New'}`.
  * `GET repayments/:key` → `{ok, by, at}` or `null`. Keys are scoped to one customer record:
    `app:<applicationId>` (staff write that key); the unscoped `app` of the local original would be
    one global flag for every customer and is answered `null` without a lookup.
* Responses: `Content-Type: application/json`, `Cache-Control: no-store`. Validate everything;
  strip unknown keys; never echo the service key; never log PII.

## Client modules

### `ledger/ledger-sync.js` (classic script, runs first in `<head>`)
1. Read `ledjaa.supabase` from localStorage; if absent seed
   `{url: location.origin + '/api/ledger', key:'', table:'ledger_book', bookId:'main', connected:false}`.
   Expose `window.__ledger = {cfg(), api(method, path, body) (adds Bearer key), state: Promise}`.
2. If `cfg.key` is set: `GET /api/ledger/state`; on success seed localStorage BEFORE the app
   constructs: merge `evoltConsoleV4` (`logbook` ← `audit_log` mapped to console shape,
   `petty` ← `petty_cash`, keep local `applications`), `ledjaa.bank.tx` ← `bank_tx`,
   `ledjaa.expenses` ← `expenses` (not deleted), `ledjaa.bank` ← settings bank_opening_*,
   `evoltOrg` ← settings org fields, `ledjaa.clientRefHigh` ← max client ref number. Also ensure
   `q1.apps` has the Quik1 entry pointing at `location.origin + '/api/q1'` with the same key,
   `on:true, actions:true` (only fill fields that are empty — never overwrite a user's edits; the
   key is filled **only when the entry's url is our own `/api/q1`** — LEDGER_KEY never accompanies a
   third-party url). Seed `loanSeq`/`clientSeq` from the highest live `ECL-`/`EC-` ref + 1 so a
   fresh browser never reissues a ref (the console formats `'ECL-0'+seq`).
   On failure or no key: continue local-only, remember the error for the adapter — but always make
   sure `evoltConsoleV4` holds `clients/loans/logbook/petty/employees/applications` arrays (`[]`
   when absent): the console only discards its built-in demo book when `clients` and `loans` exist.
3. Then inject the dc runtime `<script src="c53b361c-bb83-4c37-90f5-7116b8407f79.js">`
   (the original tag is removed from the head and replaced by this shim).
4. Mirror: wrap `Storage.prototype.setItem`; on writes to `evoltConsoleV4`, `ledjaa.bank.tx`,
   `ledjaa.expenses`, `ledjaa.bank`, `evoltOrg` compute diffs against the last synced snapshot and
   queue ops (`audit_log` inserts for new logbook entries, `petty_cash` upserts, `bank_tx` inserts,
   `expenses` upsert + soft_delete, `settings` upsert for bank/org fields). Debounce 1.5 s, POST
   `/api/ledger/sync`, retry with backoff, persist the pending queue in localStorage
   (`ledjaa.sync.queue`). Show nothing in the UI; `console.info` only.

### `ledger/ledjaa-db.js` (ES module with top-level await)
Exports exactly what the app and `csvLock` import: `SEED_CLIENTS=[]`, `SEED_LOANS=[]`,
`STORE_KEY`, `SCHEMA` (copy the table list/`append_only` flags from the original so `meta()`/`can()`
work), `ROLES`, `PERMISSIONS` (copy), `class LedjaaDB`, `const db`, default `db`.
* Tables held in memory: `users` (from `employees`), `clients`, `loans`, `applications`,
  `audit_log`, `row_versions` (local only), plus pass-through of the rest.
* `ready`: await `window.__ledger.state` (if present) else fetch itself; populate; cache a copy in
  `localStorage['ledjaa.db.v3']` for offline boot; if neither cloud nor cache → the module
  **rejects** (the console's `initDb()` catch sets `dbReady:false`, "DATABASE UNAVAILABLE") and the
  adapter refuses every write, so an empty adapter can never originate writes (dbPush against an
  empty book would "create" everything the console holds — demo rows included — once a key exists).
  NOT the demo seed — the hosted console must never show demo clients.
* `toConsoleState()` → `{clients, loans, employees}` in console vocabulary, every non-deleted row,
  dates as labels, `employee` = officer name or 'Unassigned', loans with
  `amount=principal, ret=return_rate_pct, retAmt=instalment_amount, paidInst=instalments_paid,
  instDone=prior_instalments, sched=labels, due/nextDue/instNo/instTotal/instRemaining` computed
  like the original, `issued/issuedBy/mandate/purpose`, `paidDates`, `pif/collection fee` mapped to
  whatever `pifAmt`/`isCsvLoan` read, console status vocabulary (verify in source).
* `insert/update/softDelete/restore`: apply locally (same semantics, versions, local audit) AND
  queue the op (`upsert` rows with live column names, status normalised to the DB enum,
  dates to ISO) → debounce 400 ms → `POST /api/ledger/sync` via `window.__ledger.api`.
  Unknown columns are dropped by the whitelist — do not send them. `principal_derived` is never
  sent (live boolean NOT NULL the console does not own). A console-created loan carries only
  `due_date`: when no schedule exists anywhere it becomes `schedule:[due]`. A closed loan
  (`paid|settled_early|written_off`) that stays closed never has `instalments_paid`/`paid_dates`
  rewritten by the console's "every instalment paid" presentation. Per-op `retryable` errors go
  back on the queue with backoff. "Removed in console" archives are collected per save and refused
  as a burst (> max(3, 10 %) of a table) — a stale console state must not archive the book.
* `setActor`, `table`, `rows`, `find`, `where`, `can`, `meta`, `id`, `subscribe`, `history`,
  `balance`, `staffMetrics`, `reassignBook`, `forceRelogin`, `actorTrail`, `counts`, `feeAt`,
  `empty`, `reset`, `logRaw`, `version` — keep signatures; `staffMetrics` may return zeros for
  tables we do not sync (payments).

### `quik1/quik1-link.js` (classic script)
Same public API as the local version. Local cache in `localStorage['quik1-link-v1']` (own
records only). Network via `window.QUIK1_API || location.origin + '/api/quik1'`.
`submitApplication` → optimistic local record → `POST applications` → store server id (replace
the temp id in the record AND return the server id synchronously? No: the app uses the returned
id as `linkId` immediately, so generate the id client-side (`'ap_' + 12 hex`) and send it in the
body; the server honours a well-formed client id). Same for signups (`'su_'…`) and requests.
Poll `GET applications/:id` / `signups/:id` / `repayments/app:<latest own application id>` every
6 s while any own record is undecided and a subscriber exists (the result still lands in
`repayments.app`, where the app reads it); stop when decided; also poll once on `subscribe`. Keep the
BroadcastChannel so two tabs stay in step. `decide/decideSignup/confirmRepayment/reset` keep
working on the local cache (they are admin-side helpers the customer app never calls).

## Conventions
* No build step. No bundler. No npm dependencies in production code. Node 22 features only.
* Plain readable JS; small functions; comments say *why*.
* Never DELETE rows, never UPDATE `audit_log`, never write NCR/fee columns, never put the service
  key or `LEDGER_KEY` in any committed file, never log PII (names, ID numbers, bank accounts).
* Tests: `npm test` (= `node --test` over every `tests/**/*.test.js`; on Node 21+ a bare
  `node --test tests/` fails, so use the glob or a single file) for units (mock `fetch`), Playwright for boot
  (`tools/boot-test.js` pattern: serve the folder, open, wait, assert text, screenshot).
