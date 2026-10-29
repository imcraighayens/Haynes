# Deploy — first time (about 15 minutes)

Everything below is copy-pasteable. You need: the GitHub repo, a Vercel account, the Supabase
dashboard for project `ledger-ecoloans`, and a terminal with `openssl`.

## 1. Import the repo into Vercel

Open:

```
https://vercel.com/new/clone?repository-url=https://github.com/imcraighayens/Haynes&project-name=ecoloans&env=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,LEDGER_KEY
```

On the import screen:

* Framework Preset: **Other**
* Build Command: leave **empty** (toggle off any override)
* Output Directory: leave **blank**
* Install Command: leave default (there is nothing to install)
* Root Directory: `./`

`vercel.json` in the repo already sets `framework: null` (no build), and `package.json` pins the
functions to Node 22 (`engines.node`), so these settings are only confirmations. Fill in the three environment variables from step 2, then **Deploy**.

## 2. Environment values

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | `https://rcektqecduuzqqmcsgat.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → **Project Settings → API → Project API keys → `service_role`** (click *Reveal*). Server-only. Never paste it into either app, a browser, or git. |
| `LEDGER_KEY` | Generate one now and keep it somewhere safe — you paste it into LEDGER in step 4: |

```
openssl rand -hex 32
```

Add all three to **Production** (and Preview if you want preview deployments to work).
Changing a value later: Vercel → Project → Settings → Environment Variables → edit → **Redeploy**.

## 3. Apply the database migration (once)

Supabase dashboard → **SQL Editor → New query**, paste the whole file
`supabase/migrations/20261029_quik1_bridge.sql` from the repo, **Run**. It is additive and
idempotent (safe to run twice): two columns on `applications`, four new tables, staff-only RLS.
Nothing existing is altered.

If the repo's commit history says the migration was already applied by Claude through the
Supabase MCP, running it again is harmless.

## 4. Connect LEDGER

1. Open `https://<project>.vercel.app/ledger/` (the project URL is on the Vercel deployment page;
   `https://<project>.vercel.app/` redirects there).
2. **Settings → Supabase**. The URL is pre-filled with `…/api/ledger`; leave it.
3. Paste your `LEDGER_KEY` into the key field → **Connect**. The status turns to connected.
4. Reload the page once. Clients, loans, logbook and the rest now come from the database.

## 5. Check the Quik1 link

LEDGER → **Ledger** tab → **Q1 connected apps** card (it opens as a modal). `Quik1` is listed,
pointing at `…/api/q1`, switched **on** with actions enabled. It was filled in automatically
from the same key; if the key field there is empty, paste `LEDGER_KEY` again and save.

## 6. Test an application end to end

1. On a phone open `https://<project>.vercel.app/app` (redirects to `/quik1/`).
2. Sign up (approved instantly), then **Apply** for a small amount.
3. Within a minute the application appears in LEDGER's Q1 panel. Approve or decline it.
4. The phone shows the verdict within a few seconds.

## 7. Custom domain (later)

Vercel → Project → **Settings → Domains → Add** (`app.ecoloans.co.za`, for example) and set the
CNAME it shows at your DNS provider. Nothing in the repo changes: the apps call `/api/…` on
whatever origin they are served from.

## 8. Rollback

Vercel → Project → **Deployments** → pick the previous good deployment → **⋯ → Promote to
Production**. Instant, no rebuild. The database is unaffected (the migration only adds).

## Netlify

The old Netlify site is no longer used by anything. Netlify → Site → **Site configuration →
Danger zone → Delete this site**. If a domain was pointed at Netlify, move its DNS record to
Vercel (step 7) first.

## Day-to-day

* Push to `main` → Vercel deploys automatically. Pull requests get preview URLs.
* Rotate `LEDGER_KEY`: new `openssl rand -hex 32` → update the Vercel env var → Redeploy →
  paste the new key in LEDGER Settings → Supabase → Connect.
* Logs: Vercel → Project → **Logs** (functions log request outcomes only, never customer data).
