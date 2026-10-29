# Tests

Two layers, no npm dependencies.

## Unit tests (`node:test`)

```
npm test
```

runs every `tests/**/*.test.js` with Node's built-in runner (`node --test`). Network is never
touched: each file replaces `globalThis.fetch` with a stub that records PostgREST calls and
answers with canned rows, and the client modules are loaded into a fake `window`/`localStorage`.

| File | Covers |
| --- | --- |
| `tests/ledger-sync.test.js` | boot pre-fetch, localStorage seeding, the write mirror and its op queue |
| `tests/ledjaa-db.test.js` | the `LedjaaDB` adapter: console-state mapping, writes queued to `/api/ledger/sync` |
| `tests/quik1-link.test.js` | `window.Quik1Link`: optimistic records, POSTs, decision polling |
| `tests/api/*.test.js` | the serverless handlers called directly with mock `req`/`res` |
| `tests/fake-postgrest.test.js` | the in-memory PostgREST that `tools/mock-api.js` runs the real handlers against |

Run one file: `node --test tests/quik1-link.test.js`.

On Node 21+ a bare directory (`node --test tests/`) is treated as a module path and fails; use the
glob form `node --test 'tests/**/*.test.js'` or `npm test`.

## End-to-end boot tests (Playwright + the mock API)

`tests/boot-ledger.test.js` and `tests/boot-quik1.test.js` run with the same `node --test` runner
(they are part of `npm test`) and skip themselves with a message when Playwright is not resolvable.
Each one starts `tools/mock-api.js` in-process: one local HTTP server that serves the repo root
exactly like Vercel (`/ledger/`, `/quik1/`, the two redirects) **and** runs the real `api/`
handlers against `tools/fake-postgrest.js`, an in-memory PostgREST seeded from
`tests/fixtures/state.json` (synthetic rows only: `Test Client One`, `ECL-901..905`, `NCRCP0000`).

* `boot-ledger`: pre-seeds `ledjaa.supabase = {url: origin + '/api/ledger', key: 'testkey'}`,
  opens `/ledger/`, asserts the fixture loans/clients render, `window.__ledgerDb.sync` is
  `ready/cloud/0 pending`, no `__bundler_err` or page errors beyond the template-parse SVG noise;
  then writes a logbook entry and an org change through `localStorage` and asserts the API received
  the `audit_log` insert and the `settings` upsert (with `ncr_reg_no` untouched), and that a
  `db.update()` reaches the database with live column names and no hard delete.
* `boot-quik1`: opens `/quik1/`, calls `window.Quik1Link.submitApplication(...)`, asserts the
  application lands as `status: new, source: quik1`, approves it through `PATCH /api/q1/...` with
  the staff key, and asserts the phone's `Quik1Link.getState().decisions[id].verdict === 'approved'`
  within 10 s.

Manual end-to-end without Supabase:

```
node tools/mock-api.js --port 8787        # LEDGER_KEY defaults to "testkey"
# open http://127.0.0.1:8787/ledger/  (Settings → Supabase → key "testkey") and /quik1/
# inspect http://127.0.0.1:8787/__mock/db and /__mock/log
```

## Boot tests (Playwright)

Playwright is **preinstalled globally** in this environment (`require('playwright')` resolves
through the global `node_modules`); it is deliberately not in `package.json`. Elsewhere install it
once with `npm i -g playwright && npx playwright install chromium`.

```
npm run boot:ledger   # serves ./ledger, opens index.html at 1440x900, writes /tmp/ledger.png
npm run boot:quik1    # serves ./quik1, opens index.html at 440x940,  writes /tmp/quik1.png
```

`tools/boot-test.js` serves the folder on a random local port exactly like a static host, waits
`BOOT_WAIT_MS` (default 6000 ms) for the dc runtime to compile and mount, prints a JSON summary
(`title`, first 400 chars of body text, console errors, failed requests) and exits non-zero if
the bundler reported an error, a page error was thrown, or nothing rendered.

Without a running API the ledger boots local-only (empty tables, no demo data) and Quik1 keeps
submissions in its outbox — that is the expected offline behaviour, not a failure.

## Against the real API

`vercel dev` serves the static folders and the `api/` functions together on `localhost:3000`
with the variables from `.env` (copy `.env.example`). Then open `/ledger/`, paste `LEDGER_KEY`
under Settings → Supabase → Connect, and submit a test application from `/quik1/`.
