# e.Volt — Loan Operations Dashboard

A modern, full-featured loan-management dashboard for the **e.Volt / Ecoloan**
micro-lending service. This is a ground-up upgrade of the original FlutterFlow
dashboard, rebuilt as a fast, responsive React web app.

![stack](https://img.shields.io/badge/React-18-61dafb) ![ts](https://img.shields.io/badge/TypeScript-5-3178c6) ![tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8)

## ✨ What's new vs. the old dashboard

- **Full visual redesign** — clean KPI cards, gradient header, dark/light theme
  toggle, responsive layout that works on mobile through desktop.
- **Real analytics** — disbursed-vs-collected area chart and a loan-status
  donut chart (Recharts), plus live secondary KPIs (collected this month,
  outstanding principal, repayment rate).
- **Working features**, not just a mockup:
  - Issue a **New Loan** (with live expected-return calculation)
  - **Add Client**, **Log Petty Cash**
  - Loan table with **search**, **sortable columns**, **status tabs**, and
    per-row actions (view / **edit** / mark as paid / delete) that flow through
    to the ledger and logbook
  - Full client management: **add**, **edit**, and **delete** borrowers
    (deleting a client cascades to their loans and ledger entries)
  - One-click **Clear sample data** on the Loans page and in Settings
  - **CSV export** of loans and the ledger
  - Auto-computed loan statuses (issued / due today / overdue / paid)
- **Seven pages** — Dashboard, Loans, Clients, Roles & Permissions, Activity
  Logbook, Ledger, and Petty Cash.
- **Real data layer** — everything is driven by a typed data store. It runs
  offline by default (seeded sample data persisted to `localStorage`) and can
  be pointed at a **Supabase** backend with two environment variables.

## 🔐 Logging in

Auth has two modes, chosen automatically by whether Supabase env vars are set:

- **Production (Supabase configured):** real email/password sign-in via Supabase
  Auth. Create users in the Supabase dashboard. The app resolves each user's
  display name and role from the `team` table by email. See
  [`DEPLOY.md`](DEPLOY.md).
- **Demo (no env vars):** offline login persisted in `localStorage`. Click
  **"Use demo admin credentials"** to auto-fill:

  ```
  Email:    ecoakcess@mail.com
  Password: admin123
  ```

**LogOut** ends the session in both modes.

## ⚙️ Admin settings

The **Settings** page (admin only) lets you:

- Edit your profile (name, email)
- Set the **default interest rate** applied to new loans
- **Remove sample data** — deletes the seeded paid/history loans and any clients
  with no active loans, keeping only the real issued loans on the street
- **Reset to demo data** — restores the full seeded sample set

## 🚀 Getting started

```bash
npm install
npm run dev      # http://localhost:5173
```

Build for production:

```bash
npm run build
npm run preview
```

## 🔌 Connecting the database (Supabase)

The app works fully offline out of the box (seeded data in `localStorage`).
To switch to a shared, persistent database:

1. Create a free [Supabase](https://supabase.com) project.
2. Open the **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql).
   This is idempotent and:
   - creates the `clients`, `loans`, `ledger`, `logs`, `team` tables + indexes,
   - enables Row Level Security with demo read/write policies,
   - **seeds the 5 real clients and 6 active loans** so the dashboard loads
     populated immediately.
3. In **Project Settings → API**, copy the Project URL and the `anon` public key.
4. Copy `.env.example` to `.env` and fill in:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
5. Restart the dev server. The dashboard hydrates from Supabase, and **every
   capture flows to the database**: adding a client, issuing a loan, recording a
   repayment, logging petty cash, deleting a loan, and clearing sample data all
   write through (`src/data/repo.ts`). Settings → Data management shows a green
   "Connected to Supabase" indicator when live.

> **Security note:** the bundled policies grant the anon key full read/write so
> the prototype works instantly. For production, swap them for the auth-gated
> policies in the commented `PRODUCTION` block at the bottom of the SQL file and
> use Supabase Auth.

## 🗂 Project structure

```
src/
  components/
    layout/      Sidebar, Topbar, page shell
    ui/          Button, Card, Modal, Badge, StatCard
    loans/       LoanTable (search, tabs, row actions)
    modals/      New Loan, Add Client, Log Petty Cash
  context/       Theme, Auth, Toast + Data (state, CRUD, persistence)
  data/          types, seed sample data, store (local + remote), repo (DB writes)
  lib/           formatting, metrics, settings, csv, supabase client
  pages/         Dashboard, Loans, Clients, Roles, Logbook, Ledger, PettyCash, Settings, Login
```

All amounts are in South African Rand (ZAR). The default interest rate is 35%.
