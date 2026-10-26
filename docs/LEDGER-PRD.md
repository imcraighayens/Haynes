# LEDGER by Ecoloans — PRD

Status: **Signed off with amendments 25 Oct 2026. Build in progress.** Written 25 Oct 2026 from the `Ledger.zip` prototype export.

## 0. Decision log

| Date | Decision | By |
|---|---|---|
| 25 Oct 2026 | LEDGER replaces e.Volt in `imcraighayens/Haynes` (same stack, same business). | Craig |
| 25 Oct 2026 | Scope for this pass: P0–P2. P3 integrations (Q1 LLM, Quik1, Twilio, news) come later. | Craig |
| 25 Oct 2026 | Pricing: keep 35% flat return and the R241.25 protection fee as configurable defaults. No in-app NCA cap warning. The §3.2 compliance flag stays open, with Craig, for review with the compliance officer. | Craig |
| 25 Oct 2026 | Craig asked for real borrower data in the repo. **Not done:** the repo is public, and committing ID numbers, bank accounts and mandates would publish third-party special personal information permanently. Instead the seed is synthetic, and real data loads through *Ledger › Data › Import prototype book*, which reads the prototype's own saved book. **Revisit if Haynes is made private.** | Claude (pushback, pending Craig) |
| 25 Oct 2026 | The prototype's client-side passcode and delete PIN are replaced by role-based access (Supabase Auth + RLS) and typed confirmations. | Claude (per §3.3) |
| 25 Oct 2026 | Simulated Twilio is replaced by honest device `tel:`/`sms:` links, logged as such. Biz.Mag news is replaced on the dashboard by an Attention panel. The Q1 assistant answers deterministically from the book, with no LLM and no keys in the browser. | Claude (per §3.3–3.4) |
| 26 Oct 2026 | No demo data anywhere: the app starts with an empty book and a getting-started screen (NuPay report, prototype book, by hand). The made-up market ticker is removed. The synthetic seed stays as a unit-test fixture only. | Craig |
| 26 Oct 2026 | Q1 rebuilt to the Q1 Assistant Button spec and connected to Claude through a Vercel function (`api/q1.ts`, key server-side, Supabase staff sign-in required, refusal fallback on). Claude receives a minimised snapshot: refs, names, amounts, dates and statuses; no ID numbers, bank details, contact details, addresses or salaries. POPIA s72 (cross-border operator) to be recorded by Craig. | Craig asked; Claude designed |
| 26 Oct 2026 | Host is Vercel. Changes are previewed (private claude.ai preview) before anything is pushed. | Craig |
| 26 Oct 2026 | Paid-up letter follows Craig's Ecoloans template (logo, layout, wording). It can be generated only when the loan's stored status is Paid (or Settled early) **and** every instalment is collected; written-off, open or status-not-set accounts are refused with the reason. All of a client's fully paid accounts can share one letter. The full ID must be revealed (logged) before printing; each account is logged as PAID-UP LETTER ISSUED. | Craig asked; Claude built |
| 26 Oct 2026 | Letter cites **section 71A** NCA (paid-up letter within 7 days of settlement, copy to credit bureaus), not section 71 as in the template draft — s71 is the debt-review clearance certificate. Craig to confirm with compliance. | Claude flagged |
| 26 Oct 2026 | NuPay import now keeps the DebiCheck contract reference (printed as the account ref), the actual debit (action) date per instalment, and the debtor's bank when the client has none. | Claude |

## 1. What we received

`Ledger.zip` holds one 1 MB file, `deploy/github/index.html`. It's a Claude Design bundle: a base64/gzip manifest that unpacks at runtime into:

| Asset | What it is |
|---|---|
| Template markup (~380 KB) | The full console UI as a `<x-dc>` component template, with inline styles |
| Component script (~370 KB) | One class with 129 methods holding all the state and business logic |
| `ledjaa-db.js` (44 KB) | An in-browser "database": a 14-table schema, a role/permission grid, seed data, soft-delete and an audit log |
| `ledjaa-seed.js` (57 KB) | Seed clients and loans taken from a NuPay transaction report |
| Q1 Assistant Button (13 KB) | A floating assistant-button sub-component |
| React 18 UMD, QR generator, Plus Jakarta Sans fonts | Vendored libraries |

The bundle's README tells you to push it to a separate `imcraighayens/Ledger` repo as-is. **This PRD argues against shipping it as-is** (see §3).

### Relationship to what's already in this repo

`imcraighayens/Haynes` already ships **e.Volt**: React 18 + TypeScript + Vite + Tailwind + Supabase, with 9 pages and a flat 5-table schema. LEDGER is its successor. It has the same business (Ecoloans micro-lending, the same borrowers), a full visual redesign, and roughly 4× the features. LEDGER's data model (from `ledjaa-db.js`) is much more mature than e.Volt's. It has applications, mandates, payments, consents, documents, settlement letters, versioned fees config, retention dates and soft deletes.

## 2. Feature inventory (prototype)

**Shell:** collapsible sidebar, dark/light theme, accent colour, market ticker (hardcoded values), a 4-card KPI strip (loaned out this month, collection outstanding, active clients, overdue), drag-to-arrange dashboard cards, toasts, and a white-label org name.

**Pages:**
1. **Dashboard:** collections calendar (dots per day, totals per day), collections-by-month bar chart, expected return with the principal/interest split, top exposures by client, and the Biz.Mag news panel (RSS + YouTube "reels").
2. **Loans:** search, status tabs with counts and totals (All, Issued, Due today, Overdue, Paid, Written off), a book table (ref, customer, lent, return, debit, status, due, instalment n/N), and a row menu (edit, status, settlement, contract, history, delete behind a PIN).
3. **Applications:** an inbox fed from the borrower app ("Quik1"), with New, Reviewing, Approved and Declined states, an affordability run, and approve-to-loan.
4. **Clients:** a masked-PII list, a client hub (overview, loans, affordability, activity), add/edit, block, client portal access, and a master credit agreement with a signature pad.
5. **Logbook:** an append-only activity log.
6. **Ledger (admin, locked behind a 6-digit passcode):** bank balance and transactions, monthly office expenses, employees and roles, settings, integrations (Supabase, AI provider, Twilio, Quik1) and an "API" pane.
7. **Petty cash:** a log with categories.
8. **Notifications:** instalments due today, plus "stale" loans whose due date passed without a status update. Supports bulk status update.

**Workflows:**
- **New loan wizard:** client, amount, term (1/2/3/6 months), obligations, a live affordability verdict (APPROVE/REFER/DECLINE on DTI ≤55% / ≤70%, with a repayment cap of 33% of net pay), and an instalment schedule.
- **NuPay recon:** import the CSV/XLSX debit-order report, match rows on Mandate ID and debtor ID, mark instalments paid or unpaid, and add unknown mandates as new loans.
- **Bulk upload:** paste or upload loans or client documents. Fields are extracted locally (regex) or by AI (Claude/OpenAI, key held in the browser).
- **Settlement quotation / paid-up letter:** printable, with a QR verify code and a 5-business-day expiry.
- **Q1 assistant:** a daily brief (due today, stale loans, bank balance), Q&A over the whole book via an LLM, and action buttons that navigate the app.
- **Calls/SMS via Twilio:** **simulated.** Nothing is sent, but the logbook records "SMS sent · delivery confirmed".

**Money rules in the prototype:**
- Return amount = principal × (1 + 35%), simple interest.
- CSV/NuPay loans carry a fixed debit per instalment, which includes a NuPay "PIF" fee.
- A "Total protection fee" of R241.25/month is added to settlement quotes when the client has a bank account on file.

## 3. Problems to fix before anything ships

These come first because each one is hard or impossible to undo.

### 3.1 Real borrower PII, and a public repo — **blocker**
`imcraighayens/Haynes` is a **public** repository. The prototype seed holds real data:
- about 13 South African ID numbers
- about 12 bank account numbers with branch codes
- 12 NuPay mandate IDs
- personal emails, phone numbers and home addresses

Committing it would publish special personal information (POPIA s26 covers ID numbers in combination, and bank details are personal information). Git history is permanent: a later deletion doesn't remove it, and forks and caches keep it. **Plan:** replace all seed data with synthetic borrowers. Load real data only into Supabase, behind auth, through the import tools (NuPay recon / bulk upload). Separately, decide whether Haynes should be private. e.Volt already has real borrower names in public seed data.

### 3.2 Pricing vs NCA caps — **flag for compliance; not a build blocker**
The prototype charges a flat 35% "return" on what are short-term credit transactions (≤ R8 000, ≤ 6 months). Under NCA Reg 42, short-term credit is capped at **5% per month** (3% for repeat loans in the same year). On top of that you may only add an initiation fee (capped, max R1 207.50 incl. VAT) and a service fee (R69/month incl. VAT).
- **Worked example:** R6 000 over 1 month. The legal maximum all-in cost is ≈ R1 134 (300 + 765 + 69). The prototype charges R2 100.
- **Credit life:** the R241.25/month "Total protection fee" looks far above the credit-life cap. That cap is R4.50 per R1 000 of deferred amount per month.
- **NuPay PIF:** passing the PIF fee through to the client in the debit amount may be an unpermitted charge.

Unlawful charges can be declared void (s101/s164) and refunds ordered. **Ask your NCR compliance officer to confirm.** The build will make the rate, fees and caps **configuration** (the `fees_config` table already exists) with a cap check that warns. It won't hardcode 35%.

### 3.3 Security
- **Passcode screen:** the Ledger passcode and the delete PIN are checked in the browser, and the passcode is *printed on the lock screen*. **Fix:** gate these screens with Supabase Auth roles and RLS.
- **Book stored as one JSON row:** the prototype stores the whole book as one row through the anon key. Anyone holding the anon key, which ships in every browser, can read and overwrite it. **Fix:** use normalized tables with auth-only RLS.
- **e.Volt's current read policy:** `DEPLOY.md` sets "public read" policies. That exposes client rows to the world. **Fix:** make reads authenticated-only.
- **AI keys:** these sit in `localStorage`, and calls go out with `anthropic-dangerous-direct-browser-access`. The full loan book (names, statuses, amounts) is sent to the LLM on every question. That's a POPIA s72 cross-border transfer, and an operator agreement is needed. **Fix:** route calls through a Supabase Edge Function with a server-side key. Minimize the data sent (refs and amounts, no IDs or bank details) and log what was sent.

### 3.4 Integrity
- **Simulated SMS and calls:** these write "delivery confirmed" into the audit logbook. That's a false collections record, which matters if the NCR or a debt counsellor asks for it. **Fix:** either wire Twilio for real or label these entries "SIMULATED".
- **Market ticker:** it shows hardcoded figures. **Fix:** label them "indicative / static", or drop the ticker.

## 4. Problem statement

Ecoloans runs its loan book in a console that only exists as a design prototype. The prototype is unmaintainable (a 750 KB single file), stores data per browser, embeds real PII, and has pricing and security gaps. e.Volt is maintainable but under-featured. **We need one production console with LEDGER's design and workflows on e.Volt's engineering base, with a normalized, auth-protected Supabase backend.**

## 5. Success criteria

1. Every P0 and P1 screen below matches the prototype's layout and visual language in both dark and light themes.
2. KPIs, tab totals, calendar totals and affordability verdicts follow the prototype's rules. The affordability rule is identical. Unit tests on the `src/domain/` money math enforce this. Loan amounts use one explicit model (principal, return per instalment, collection fee, schedule), replacing the prototype's two overloaded meanings of `amount`.
3. `npm run build` (tsc + vite) is clean, and the unit tests pass.
4. No real PII and no secrets in the repo or the client bundle.
5. With Supabase configured, every write lands in a normalized table under auth-only RLS. Every mutation writes an audit-log row, and deletes are soft deletes.
6. Without Supabase, the app runs fully offline on synthetic data. This is the demo mode e.Volt has today.

## 6. Scope and phases

| Phase | Contents |
|---|---|
| **P0 Foundations** | LEDGER design tokens (dark/light, Plus Jakarta Sans, accent); app shell (sidebar, KPI strip, ticker, toasts); TypeScript domain model from `ledjaa-db` SCHEMA; data store (local + Supabase repo); synthetic seed; `lib/loan-math` (due, debit, schedule, status derivation, affordability, fee-cap check) with tests; roles and permissions grid |
| **P1 Core book** | Dashboard (calendar, collections by month, expected return, top exposures); Loans (tabs, table, row actions, status changes, instalments, edit, soft delete); Clients (masked list, client hub, add/edit, block); New-loan wizard with affordability; Notifications (due today / stale, bulk status); Logbook; Petty cash; CSV export |
| **P2 Operations** | Ledger admin area, auth-gated (bank balance/transactions, expenses, employees and roles, settings); NuPay CSV/XLSX recon import; printable settlement quotation and paid-up letter with QR verify; master credit agreement with signature pad; applications inbox (manual capture) |
| **P3 Integrations** (server-side) | Q1 assistant through an Edge Function with data minimization; Quik1 application feed; real Twilio SMS/call; Biz.Mag news through an RSS proxy; AI document extraction |
| **Out of v1** | Video reels, the fictional public "API" pane (`api.ledgerconsole.io`), live market data |

Recommended for this build pass: **P0 + P1 + P2**. P3 needs secrets and accounts (Anthropic, Twilio, Quik1) and server code that should be reviewed separately.

## 7. Constraints

- Stack stays React 18, TypeScript, Vite, Tailwind and Supabase. Deploy to Vercel or Netlify keeps working.
- All amounts in ZAR. Dates use the SA format (`23 Oct 2026`).
- Records are never hard-deleted (NCA s170 / FICA retention: 5 years).
- A supabase migration ships alongside `schema.sql`. Existing e.Volt tables stay readable until data is migrated.

## 8. Plan

1. Branch `claude/optimistic-lovelace-sylp98`; add this PRD.
2. P0: tokens, shell, domain types, loan-math with tests, store/repo, synthetic seed.
3. P1 pages, one at a time, each compared against the prototype screenshot.
4. P2 admin, recon, letters, agreement.
5. New `supabase/schema.sql` (normalized, auth-only RLS, audit trigger), with a note on migrating from e.Volt.
6. Update README and DEPLOY. Build, test, screenshot, then a draft PR.

## 9. Open questions

1. **Where:** replace e.Volt in Haynes (recommended: same business, same stack), or a new `imcraighayens/Ledger` repo?
2. **PII:** confirm synthetic seed only. Should Haynes go private?
3. **Scope for this pass:** P0–P2 (recommended), or P0–P1 only, or P0–P3?
4. **Pricing:** what defaults go in `fees_config` until compliance confirms? (Proposed: keep 35% as configured, but show a visible NCA-cap warning on any loan that exceeds the cap.)
5. **Branding:** "LEDGER by Ecoloans" in place of "e.Volt"?
