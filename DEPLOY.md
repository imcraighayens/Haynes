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

Staff Admin sign-in is Supabase Auth on that same project, not `LEDGER_KEY`. The Admin
screen asks for email and password (`POST /api/ledger/login`). The server checks them with
GoTrue, then allows the session only when `public.employees` has an active row for that email
(the same rule that keeps sign-up closed). The confirmed admin is `craig@ecoloan.co.za`. A
second staff member is added by inserting another active employee row — there is no second
address until then. Do not give staff `LEDGER_KEY` to paste into the sign-in form. The
Settings connect field is still the machine secret for the bridge.

Optional server-only values. Leave them unset until you are ready. None of them belong in the
browser, in git, or in the staff UI.

| Name | What it does |
| --- | --- |
| `LEDGER_UNLOCK_PIN` | Legacy server PIN for `POST /api/ledger/unlock`. Mints the same httpOnly staff cookie. The Admin screen does not send it and does not show a passcode. |
| `LEDGER_MANAGER_PIN` | Required before a loan delete or a full book replace. Plain text, or `sha256:` plus the hex digest. |
| `LEDGER_ALLOW_DEMO_RESET` | Set to `true` only on a non-production host to show Reset demo data. Production hosts and `NODE_ENV=production` keep it hidden. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Document reader. Q1 chat answers from the book without these. If neither is set, the reader shows "Not configured". |
| `LEDGER_AI_PROVIDER` | Optional when both reader keys are set: `anthropic` or `openai`. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | Voice and SMS. If any is missing, staff see "Not configured" and nothing is sent. |
| `Q1_WEBHOOK_URL` | Optional. Scrubbed Q1 chat summaries. Chat still answers when this is empty. |
| `QUIK1_SESSION_SECRET` | Required for Quik1 borrower sign-in. At least 32 characters (`openssl rand -hex 32`). Signs the httpOnly session cookie. Server-only. |
| `QUIK1_INVITE_TTL_HOURS` | Optional. Invite lifetime in hours. Default 72. |
| `QUIK1_PIN_MAX_ATTEMPTS` | Optional. Failed PIN attempts before lockout. Default 5. |
| `QUIK1_SESSION_TTL_HOURS` | Optional. Borrower session lifetime in hours. Default 12. |

Optional, for the marketing-site ingest only (`POST /api/ecoloans/applications`). Leave them unset
to keep the defaults. They are separate from `QUIK1_HOURLY_CAP`, `QUIK1_PHONE_DAILY_CAP` and
`QUIK1_RATE_LIMIT`.

| Name | Default | What it caps |
| --- | --- | --- |
| `ECOLOANS_HOURLY_CAP` | 60 | new `source = ecoloan_web` applications in the last hour |
| `ECOLOANS_PHONE_DAILY_CAP` | 3 | applications from the same phone in 24 hours |
| `ECOLOANS_RATE_LIMIT` | 30 | requests per minute per IP on this route |

## 3. Apply the database migration (once)

Supabase dashboard → **SQL Editor → New query**, paste the whole file
`supabase/migrations/20261029_quik1_bridge.sql` from the repo, **Run**. It is additive and
idempotent (safe to run twice): two columns on `applications`, four new tables, staff-only RLS.
Nothing existing is altered.

Then paste and run `supabase/migrations/20261105_quik1_borrower_auth.sql` as well. That file
adds the Quik1 invite, PIN-hash, and session tables. It does not create borrower logins in
Supabase Auth, and it does not change the staff sign-up allowlist. Set `QUIK1_SESSION_SECRET`
(32 or more characters) on Vercel before a client can choose a PIN. Leave it unset and the
invite link can still be created, but redeeming it answers "Server not configured".

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

## 7. Marketing site applications

The public ingest is `POST https://<project>.vercel.app/api/ecoloans/applications` with
`Content-Type: application/json`. No `LEDGER_KEY`. Required JSON: `name`, `phone`, and `amount`
(1–50000). The live form can send `aName`, `aCell`, and `aAmt`. Income is optional: a number
is stored on `net_income`; a pay band such as `takeHome` (`R5 000 to R10 000`) is stored on
`meta.takeHome` and `net_income` defaults to `0`. Also accepted: `term`, `purpose` / `why`,
`loanType` (`personal` or `business`), `email`, `employer`, `bank`, `province`, `docs` names.
The response is
`{ "id": "ew_…", "ref": "EW-…", "status": "new" }`.

Browsers may call it from these exact origins:

* `https://ecoloan.co.za`
* `https://www.ecoloan.co.za`
* `https://ecoloans.co.za`
* `https://www.ecoloans.co.za`

The row is stored in `applications` with `source = ecoloan_web` and waits for a staff decision.
Details and a copy-paste `fetch` are in the README section **EcoLoans marketing site**.

## 8. Custom domain (later)

Vercel → Project → **Settings → Domains → Add** (`app.ecoloans.co.za`, for example) and set the
CNAME it shows at your DNS provider. Nothing in the repo changes: the apps call `/api/…` on
whatever origin they are served from.

## 9. Rollback

Vercel → Project → **Deployments** → pick the previous good deployment → **⋯ → Promote to
Production**. Instant, no rebuild. The database is unaffected (the migration only adds).

## Netlify

The old Netlify site is no longer used by anything. Netlify → Site → **Site configuration →
Danger zone → Delete this site**. If a domain was pointed at Netlify, move its DNS record to
Vercel (step 8) first.

## Day-to-day

* Push to `main` → Vercel deploys automatically. Pull requests get preview URLs.
* Rotate `LEDGER_KEY`: new `openssl rand -hex 32` → update the Vercel env var → Redeploy →
  paste the new key in LEDGER Settings → Supabase → Connect.
* Logs: Vercel → Project → **Logs** (functions log request outcomes only, never customer data).
