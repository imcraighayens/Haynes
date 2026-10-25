# LEDGER by Ecoloans

The loan-book console for Ecoloans: issuing, collecting and reconciling short-term loans, with a full audit trail. It replaces the e.Volt dashboard and turns the single-file LEDGER prototype into a maintainable React + TypeScript app with an optional Supabase backend.

- **Stack:** React 18, TypeScript, Vite, Tailwind (theme tokens as CSS variables), Supabase (Postgres + Auth), Vitest
- **Currency / locale:** ZAR, South African dates (`23 Oct 2026`)
- **Themes:** dark (default) and light

## What's in the console

| Page | What it does |
|---|---|
| **Dashboard** | KPI strip (loaned out this month, collection outstanding, active clients, overdue), collections calendar, collections by month, expected return split into principal and interest, top exposures |
| **Loans** | Status tabs (all, issued, due today, overdue, paid, written off) with counts and totals; the loan book table; per-loan actions (record an instalment, change status, edit, settlement quotation / paid-up letter, archive); new-loan wizard with a live affordability verdict; bulk upload |
| **Applications** | Capture applications, run affordability, approve into a loan or decline. Every decision is logged. |
| **Clients** | Client list with masked PII; client hub (overview, loans, personal, employment, banking, affordability, activity); master credit agreement with signature |
| **Logbook** | Append-only audit trail of every change, with search, type and date filters, and CSV export |
| **Ledger** (admin) | Bank balance and movements, this month's money in and out, monthly office expenses, book summary, **NuPay debit-order report import**, employees and roles, settings, and data import / export |
| **Petty cash** | Office float log with an approval flow (pending, approved, repaid, declined) and outstanding staff advances |
| **Notifications / Q1** | Instalments due today, and loans whose due date passed without anyone updating them; Q1 daily brief |

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # vitest: loan maths, ops, importers, NuPay recon
npm run build    # type-check + production bundle in dist/
```

### Demo mode (no database)

Without Supabase environment variables the console runs offline on a **synthetic** demo book stored in the browser. Sign in with:

```
Email:    demo@ecoloans.co.za
Password: ledger-demo
```

The sign-in screen has a **Use demo credentials** shortcut. Ledger › Employees & roles has a **Preview as role** control, so you can see what an agent, collections officer or auditor sees. Ledger › Data › **Reset to demo data** restores the demo book.

> The demo book is entirely fictional. ID numbers start with `000000` and bank accounts with `0000`. Real borrower data never belongs in this repository.

## Connecting Supabase

1. Create a Supabase project.
2. **SQL Editor:** run [`supabase/schema.sql`](supabase/schema.sql). It is idempotent, and its header explains each step. It creates normalized tables, Row Level Security (signed-in team members only, no anon access), soft-delete protection and an append-only audit log.
3. **Authentication:** turn off public sign-ups. Then add your user under **Users → Add user** with auto-confirm.
4. Add your `employees` row with role `admin`. The SQL is in the schema header. If you skip this, the first person to sign in is treated as admin until a team exists.
5. Copy `.env.example` to `.env` and set:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
6. Restart `npm run dev`. The sign-in screen switches to Supabase Auth, and the page header shows **SAVED · SUPABASE**.

Every change is written to Supabase row by row as it happens and cached on the device. If a write fails, the header turns red and the error is shown. The cached copy stays readable offline.

## Bringing in the real book

**From the LEDGER prototype.** In the browser where you used the prototype, open the DevTools console and run:

```js
copy(localStorage.getItem('evoltConsoleV4'))
```

Then go to **Ledger › Data › Import a book**, paste, check the preview and confirm by typing `IMPORT`. The prototype's Supabase payload (`ledger-book/2`) is accepted too. The import maps:
- manual loans (principal + 35% return)
- NuPay loans (return per instalment + collection fee, with the principal estimated where it was never recorded)
- schedules, instalments paid, mandates, the logbook, petty cash, expenses and bank figures

**From the debit-order platform.** Go to **Ledger › Overview › Import NuPay report** and drop the `.xlsx` or `.csv` transaction report. Rows are matched on Mandate ID, then on the debtor's ID number:
- **Success** rows collect the instalment and add it to the bank.
- **Failed** rows mark the loan overdue, with the bank's reason.
- **Unknown mandates** become new `ECL-F…` loans, creating the client when needed.

You see every row before anything changes.

**Moving a demo book into Supabase:** **Ledger › Data › Upload this browser's book**.

## Security model

- **Access is by role, not passcode.** Admin, manager, loan officer, collections and auditor each get a set of screens and actions (`src/domain/permissions.ts`). The prototype's on-screen ledger passcode and delete PIN are gone. Destructive actions now need a typed confirmation and are logged.
- **Database:**
  - RLS on every table; only active team members can read or write.
  - Only admins can change the team or settings, so nobody can raise their own role.
  - No anon access.
- **Nothing is hard-deleted.** Clients and loans are archived with `deleted_at`. A database trigger blocks `DELETE` (retention: NCA s170 / FICA).
- **Append-only audit log.** Every op writes a logbook entry, and the database rejects edits to existing entries.
- **PII masking.** ID and account numbers show as `••••••• 0086` until revealed by a role that may see them.
- **No API keys in the browser.** The prototype kept AI and Twilio keys in `localStorage` and sent the whole book to an LLM from the browser. That is removed.
- **Exports contain personal information.** Store them encrypted and delete copies you no longer need (POPIA).

## Project structure

```
src/
  domain/     types, loan maths, affordability, settlement, bank, permissions,
              prototype importer, synthetic seed (+ unit tests)
  store/      auth, book store (local cache + Supabase), audited ops, modal stack, theme, toasts
  ui/         Button, Modal, Menu, form fields, pills, confirm, print/QR/CSV helpers
  shell/      sidebar, market strip, KPI strip, page header, Q1 button
  pages/      Dashboard, Loans, Applications, Clients, Logbook, Ledger, PettyCash, Login
  features/   modals and panes per area (loans, clients, ledger, petty, q1, …)
supabase/schema.sql
docs/LEDGER-PRD.md
```

## Not in this build (planned P3)

These need server-side code and account keys, which should be reviewed separately:

- **Q1 AI answers.** The daily brief and quick questions work today and are computed locally. Free-text answers will go through a Supabase Edge Function that holds the API key server-side and sends the model only the data it needs.
- **Quik1 borrower-app feed.** Applications are captured manually for now.
- **Twilio SMS and calls.** Call and SMS actions use the device's `tel:` / `sms:` links. Nothing is logged as "delivered" that wasn't.
- **Biz.Mag news and live market data.** The market strip shows indicative reference figures and says so.

## Compliance notes

Pricing is configuration, not code. In **Ledger › Settings** you set:
- the default return rate (35% today)
- the collection fee per debit
- the protection fee on settlement quotes
- the NCR registration number printed on documents

These figures interact with the National Credit Act's caps on interest, initiation, service and credit-life charges for short-term credit. Confirm the configured values with your compliance officer before relying on them. The affordability check (approve at debt-to-income ≤ 55%, refer at ≤ 70%, repayment ≤ 33% of net pay) mirrors the prototype's rule. Record the assessment on each loan as your credit policy requires.

## Deploying

See [`DEPLOY.md`](DEPLOY.md). Vercel (`vercel.json`) and Netlify (`netlify.toml`) both work unchanged: `npm run build`, serve `dist/` with an SPA fallback.
