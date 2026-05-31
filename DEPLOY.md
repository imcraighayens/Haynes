# Deployment Guide — e.Volt Dashboard → Vercel

This app is a static Vite + React SPA. It runs in two modes:

- **Offline / demo** — no env vars; seeded data in `localStorage`, demo login.
- **Production** — Supabase backend + real Supabase Auth (email/password).

Follow these steps for a production deploy on **Vercel**.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste and run [`supabase/schema.sql`](supabase/schema.sql).
   This creates the tables, indexes, **production RLS policies** (public read,
   authenticated write), and seeds the real clients + active loans.
3. Create your admin login — **Authentication → Users → Add user** (set an email
   and password, tick "Auto-confirm").
4. (Optional) Add a matching row to the `team` table so your name/role resolve
   correctly — see the note at the bottom of `schema.sql`. Without it you still
   get the `admin` role by default.
5. **Settings → API** — copy the **Project URL** and the **anon public** key.

## 2. Deploy to Vercel

The repo includes [`vercel.json`](vercel.json) (build command, SPA rewrites,
security headers, asset caching) and pins Node 20 via `.nvmrc`.

1. **Add New → Project**, import this repo and branch.
2. Vercel auto-detects Vite; `vercel.json` provides build settings
   (`npm run build` → output `dist`).
3. **Settings → Environment Variables** — add (for Production, Preview, Dev):
   | Key | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | your Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your anon public key |
4. **Deploy**. (Env vars are read at build time — redeploy after changing them.)

## 3. Point Supabase at your domain

In Supabase **Authentication → URL Configuration**, set the **Site URL** and add
your Vercel domain(s) to **Redirect URLs** so auth links resolve correctly.

## 4. Smoke-test the live site

- [ ] Login screen appears; the demo-credentials link is **gone** (confirms Supabase mode)
- [ ] Sign in with your Supabase user
- [ ] Dashboard loads the seeded clients/loans from the database
- [ ] Add a client, refresh → it persists (DB write working)
- [ ] Settings → Data management shows **🟢 Connected to Supabase**
- [ ] Direct-load a deep route (e.g. `/loans`) and refresh → no 404 (SPA rewrite)
- [ ] Log out returns you to the login screen

## Rollback / preview

Every push/PR gets a Vercel **preview deployment**. Production deploys are
atomic — use **Deployments → ⋯ → Promote to Production** (or **Rollback**) on a
previous build to revert instantly.

## Local production check

```bash
npm ci
npm run build      # type-check + bundle
npm run preview    # serve dist/ at http://localhost:4173
```

> A `netlify.toml` is also included if you ever prefer Netlify — same build,
> redirects, and headers. Vercel ignores it.
