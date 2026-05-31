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
  - Loan table with **search**, **status tabs**, and per-row actions
    (mark as paid / delete) that flow through to the ledger and logbook
  - Auto-computed loan statuses (issued / due today / overdue / paid)
- **Seven pages** — Dashboard, Loans, Clients, Roles & Permissions, Activity
  Logbook, Ledger, and Petty Cash.
- **Real data layer** — everything is driven by a typed data store. It runs
  offline by default (seeded sample data persisted to `localStorage`) and can
  be pointed at a **Supabase** backend with two environment variables.

## 🔐 Logging in

The app opens on a login screen. Use the demo admin credentials (or click
**"Use demo admin credentials"** to auto-fill):

```
Email:    ecoakcess@mail.com
Password: admin123
```

Sessions persist in `localStorage`; **LogOut** clears them. Swap `AuthContext`
for Supabase Auth in production.

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

## 🔌 Connecting a real backend (optional)

The app works fully offline out of the box. To use live data:

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql)
   in the SQL editor.
2. Copy `.env.example` to `.env` and fill in:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
3. Restart the dev server. The dashboard will hydrate from Supabase.

## 🗂 Project structure

```
src/
  components/
    layout/      Sidebar, Topbar, page shell
    ui/          Button, Card, Modal, Badge, StatCard
    loans/       LoanTable (search, tabs, row actions)
    modals/      New Loan, Add Client, Log Petty Cash
  context/       Theme + Data (state, CRUD, persistence)
  data/          types, seed sample data, store (local + remote)
  lib/           formatting, metrics/derived analytics, supabase client
  pages/         Dashboard, Loans, Clients, Roles, Logbook, Ledger, PettyCash
```

All amounts are in South African Rand (ZAR). The default interest rate is 35%.
