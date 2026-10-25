# Deploying LEDGER

LEDGER is a static Vite + React single-page app. It runs in one of two modes:

- **Demo:** no env vars. A synthetic book is kept in the browser and you sign in with the demo login. Use this for previews only.
- **Production:** Supabase Auth plus Postgres, with Row Level Security.

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com). A region near South Africa (e.g. `af-south-1`) keeps latency down and simplifies POPIA cross-border questions.
2. **Moving from e.Volt?** Its `clients` and `loans` tables use different columns. Export what you need, then uncomment the rename block at the top of `supabase/schema.sql`, or drop the old tables.
3. **SQL Editor:** run [`supabase/schema.sql`](supabase/schema.sql). It is safe to run again.
4. **Authentication → Providers → Email:** turn off **Allow new users to sign up**.
5. **Authentication → Users → Add user:** your admin login, with auto-confirm on.
6. Add your team row:
   ```sql
   insert into public.employees (id, name, email, role, active, approval_limit, created_at)
   values ('e1', 'Your Name', 'you@ecoloans.co.za', 'admin', true, 50000, now());
   ```
   After this, add everyone else from **Ledger › Employees & roles**. Each person also needs a Supabase Auth user with the same email.
7. **Settings → API:** copy the **Project URL** and the **anon public** key. The anon key is safe in a browser bundle, because RLS grants it nothing.
8. **Authentication → URL Configuration:** set the **Site URL** to your production domain.

## 2. Vercel (or Netlify)

`vercel.json` sets the build (`npm run build` → `dist`), the SPA rewrites, security headers and asset caching. Node 20 is pinned in `.nvmrc`.

1. **Add New → Project:** import this repository.
2. **Settings → Environment Variables** (Production and Preview):

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | Project URL |
   | `VITE_SUPABASE_ANON_KEY` | anon public key |

3. Deploy. Env vars are read at build time, so **redeploy after changing them**.

Netlify works the same way through `netlify.toml`.

> Preview deployments built without the env vars run in demo mode. That's handy for reviewing UI changes, and safe because they hold no real data.

## 3. Load the book

Sign in as the admin, then either:

- **Ledger › Data › Import a book:** paste the prototype save. In the prototype's browser console, run `copy(localStorage.getItem('evoltConsoleV4'))`. Or choose a LEDGER JSON export. Confirm by typing `IMPORT`; the import is written straight to Supabase.
- **Ledger › Overview › Import NuPay report:** load the latest debit-order report to bring statuses up to date.

## 4. Smoke test

- [ ] The sign-in screen shows **no** demo-credentials shortcut (confirms Supabase mode)
- [ ] Sign in works, and the page header reads **SAVED · SUPABASE**
- [ ] Add a client, refresh: it is still there
- [ ] Issue a loan: it appears in the Logbook, and a bank movement appears under Ledger › Overview
- [ ] Sign in as a user with **no** employees row: they see an empty book (RLS working)
- [ ] An agent cannot open `/ledger` and cannot change roles
- [ ] Opening a deep link like `/loans` directly and refreshing gives no 404
- [ ] Log out returns to the sign-in screen

## Rollback

Every deploy is atomic. In Vercel, use **Deployments → ⋯ → Promote to Production / Rollback** on an earlier build. Database changes are additive (`create … if not exists`), so an older build keeps working against the same schema.

## Local production check

```bash
npm ci
npm test
npm run build      # type-check + bundle
npm run preview    # http://localhost:4173
```
