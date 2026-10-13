# Quik1 Mobile App: PRD

**Status:** DRAFT. Waiting on Craig's sign-off. No build work starts until this is approved.
**Owner:** Craig Moatshe · **Drafted:** 13 Oct 2026
**Source of truth for the look:** [`design-source/quik1-prototype.html`](design-source/quik1-prototype.html) (the delivered bundle, kept here unchanged)

---

## 0. Read this first: two blockers that are not code problems

### 0.1 The core product, as designed, can't be listed on either app store

| Store rule | What the design does | Result |
|---|---|---|
| **Google Play, Financial Services policy:** no apps that promote personal loans needing repayment **in full in 60 days or less** | Loan is repaid in full on the next payday (around 5–35 days). The 1-month term is the default. Longer terms only unlock at 5 stars. | **Rejected** |
| **Apple App Store guideline 3.2.2(ix):** loan apps must disclose the max APR and due date, may not charge **more than 36% APR including fees**, and may not require **full repayment in 60 days or less** | A flat 35% over about 1 month works out to an APR of several hundred percent. Repayment is in full on payday. | **Rejected** |

These rules apply to the **loan product**, not to the code. A perfect build still gets rejected.
The Apple wording comes from a third-party tracker of the guidelines, so check the current text on developer.apple.com before relying on it. Google's 60-day rule is confirmed on Google's own help page.

**Options (this is your decision, see §9 Q1):**
- **A. Restructure the product for the stores:** minimum term 61+ days in instalments. That satisfies Google. Apple's 36% APR cap still can't be met at micro-lending pricing.
- **B. Launch as an installable web app (PWA) at a Quik1 domain first.** No store gatekeeping, and the same codebase. The native store builds are prepared but only submitted once the product terms qualify. **← my recommendation**
- **C. Store app for servicing only** (balance, repay, statements, support), with applications on the web. This is grey-area. Both policies also cover apps that *facilitate* loans, so rejection risk stays high.

### 0.2 The pricing appears to breach the NCA caps (Reg. 42)

The design charges **one flat 35% of the amount drawn, no initiation fee, no service fee**, even on a 1-month loan.
Short-term credit transactions (≤ R8 000, ≤ 6 months) are capped at roughly: interest **5%/month** (first loan) or **3%/month** (repeat loans in the same calendar year), initiation fee **R165 + 10% above R1 000 (max R1 050)**, and service fee **R60/month**.

| Loan, 1 month | Quik1 charge (35%) | NCA max total cost (excl. VAT) | Over by |
|---|---|---|---|
| R1 000 | R350 | ≈ R275 (50 + 165 + 60) | ≈ R75 |
| R2 500 | R875 | ≈ R500 (125 + 315 + 60) | ≈ R375 |
| R8 000 | R2 800 | ≈ R1 325 (400 + 865 + 60) | ≈ R1 475 |

Over 3 months, 35% lands close to the cap. Over 1 month it is far above it, and repeat loans at 3%/month make the gap wider.
Charges above the caps are unlawful and can't be recovered, which is NCR enforcement exposure.
Separately, a single "flat fee" with no breakdown conflicts with the itemised pre-agreement quote the NCA requires.
**This needs compliance counsel before any real loan is granted.** These figures are my reading of the regulations, not legal advice.

**What the build does about it:** pricing becomes a **server-side product table** (rate per term, fees, caps, repeat-loan rules), not a hard-coded `35`. When counsel rules, the fix is a config change, not a rebuild. The UI keeps its look. Only the **pricing copy** may have to change (for example, "One flat fee of 35%" on the login screen).

### 0.3 Also found: e.Volt, the dashboard already in this repo, exposes customer data
`supabase/schema.sql` has three problems:
- It lets **anyone with the anon key read** every table (`read all … using (true)`), including `clients` with names, phone numbers and ID numbers. The seed says it is "the real active loan book". The anon key ships inside the web bundle.
- **Any signed-in user can write to every table.**
- **Any signed-in user with no `team` row defaults to `admin`.**

If that dashboard is live, this is a **POPIA breach risk now**.
On top of that, the seeded e.Volt loans of R12 000 and R9 000 at 35% over 30 days are above R8 000. That makes them unsecured credit, where the interest cap is much lower, so the same NCA pricing problem applies there too.
The fix is small (auth-gated, role-checked policies). I'm logging it as a separate thread so it doesn't get lost (see §10).

---

## 1. Problem

Quik1 exists as a polished, single-file interactive prototype. Its state lives in browser `localStorage`, it has no real accounts, no database, and no real decisioning. Its AI assistant only works inside claude.ai (`window.claude`), and the admin side is faked (`window.Quik1Link`).
Craig needs it turned into a **production full-stack mobile app**. The UI has to stay exactly as delivered (the one exception is the splash illustration, which goes), and it has to sit on a real database, ready for store or PWA distribution.

## 2. What exists today (checked before proposing anything new)

**The prototype** (unpacked from the bundle): a 440×940 phone UI with the Ubuntu font. Ink `#0B0620`, yellow `#FDD10D`, bone `#F2F0EA`, frosted-glass panels, dark and light modes.
- **Auth:** splash (5 s) → login (new/returning, phone + OTP, passkey/biometric) → 3-step signup → "pending approval"
- **New-loan flow:** estimate → who → amount → purpose → eligibility → docs (3 months of bank statements, with file checks) → KYC → deciding → offer (agreement, DebiCheck mandate, terms)
- **Repeat-loan flow:** amount → purpose
- **Home** plus 11 sheets: accounts, loan, activity, schedule, statements, support (human chat), profile, tracker, documents, performance, credit
- **Q1 AI assistant:** chat, voice in/out, quick-ask bubble, account briefing
- **Growth mechanic:** a R500 base that doubles as paid interest reaches the base, up to R8 000. 5-star rating unlocks longer terms.
- **Admin hooks** (`Quik1Link`): signups, applications, decisions, repayments. The admin side is simulated.
- About 2 250 lines of logic, about 2 150 lines of template, 4 images, 24 font files

**This repo** (`imcraighayens/Haynes`): **e.Volt**, a React + Vite + Tailwind + Supabase loan-ops dashboard, also ZAR, also 35%. It is a natural candidate for the Quik1 back office (§9 Q3).

## 3. Success criteria (measurable)

1. **Visual parity:** every screen and sheet, rendered at 440×940 (and at 390×844), matches the prototype within **≤ 1% pixel difference**. This is checked automatically in CI against reference screenshots of the delivered bundle. Allowed exceptions: the splash illustration (removed) and pricing/compliance copy Craig approves.
2. **Splash:** the native launch screen and the in-app splash show **no image**. They are blank on the brand background.
3. **Real backend:** no business state in `localStorage`. Accounts, applications, documents, decisions, loans, repayments, chats and consents all persist in Postgres and Storage.
4. **Security:** automated RLS tests prove that customer A can't read or write anything belonging to customer B, and that the anon role can read nothing personal. Every admin action is written to an append-only audit log.
5. **Pricing:** no hard-coded rate in the client. Every amount shown comes from the server product table.
6. **Builds:** the Android project builds (`.aab`/`.apk`), the iOS project is generated and ready for Xcode, and the PWA is installable and passes the Lighthouse PWA checks.
7. **The AI assistant** answers only from the signed-in customer's own data through a server proxy. It never gives credit advice beyond stated facts, and no API key ever sits on the device.
8. **Accessibility:** touch targets ≥ 44pt, text contrast ≥ 4.5:1 on body copy, screen-reader labels on every icon-only button. These are additive fixes that don't change the look.

## 4. Scope

**In (Phase 1, this build):**
- Faithful port of the whole prototype into a maintainable React + TypeScript codebase
- Splash image removed
- Capacitor shell for iOS and Android, plus a PWA build
- Supabase: Postgres schema, migrations, RLS, Storage (documents), Auth (phone OTP), Edge Functions (decisioning, AI proxy, pricing)
- Device features swapped to native: biometric unlock (in place of WebAuthn in the webview), native speech, share, push notifications. The UI stays the same.
- Rules-based affordability and decision engine, a server port of the prototype's `estimate()` and `assess()`, with admin override
- Back office: applications queue, approve/decline/refer, loan book, repayments, audit (extend e.Volt or build a minimal admin, see §9 Q3)
- Provider **interfaces with mock implementations** for KYC/liveness, credit bureau, bank-statement parsing, DebiCheck collections and payouts. These are clearly labelled as mocks until contracts exist.

**Out (later phases, need vendors, contracts or your accounts):**
- Live KYC, bureau, statement-parsing, DebiCheck and payout integrations (Phase 2)
- Store submission: Apple and Google developer accounts, signing certificates, listings, privacy forms (Phase 3, and gated on §0.1)
- iOS binary compilation. This needs macOS and Xcode, which this cloud session doesn't have. I'll generate the project and the CI workflow.

## 5. Constraints

- **The look is frozen.** Layout, colours, type, motion and copy stay as delivered. Any change is listed in a change log for your approval.
- **Regulatory:** NCA (affordability per Reg. 23A, pre-agreement quote, caps per Reg. 42, NCR registration number; the prototype shows the placeholder `NCRCP00000`). FICA (KYC, record keeping ≥ 5 years). POPIA (consent, purpose limitation, data minimisation, breach handling, cross-border transfer for the AI provider). DebiCheck mandate rules.
- **Data residency:** host Supabase in the nearest region and document the cross-border transfer. Supabase has no ZA region (the closest is EU or another region), so POPIA s72 consent is needed.
- **Stack continuity:** React + TypeScript + Supabase, the same as e.Volt, so one team and one toolchain.

## 6. Architecture (recommended)

```
apps/quik1/                 React 18 + TS + Vite. Ported UI, pixel-faithful
  ├─ capacitor (ios/, android/)   native shell, blank splash, biometric/speech/push plugins
  └─ PWA manifest + service worker
supabase/quik1/
  ├─ migrations/            schema + RLS + seed (products/pricing)
  ├─ functions/             decide, price-quote, ai-assistant (Claude proxy), webhooks
  └─ tests/                 RLS tests
apps/evolt/ (existing)      back office, pointed at the same DB (if Q3 = yes)
```

**Why Capacitor and not React Native/Flutter:** the brief is "the look stays as delivered". The prototype is HTML/CSS. Capacitor renders that same CSS natively in the app, so parity can be **proven by pixel diff**. A React Native or Flutter rewrite re-creates every screen by hand and will drift. The trade-off is slightly less native feel on heavy animations. That is acceptable here.

**Core tables (first draft):** `customers`, `consents`, `kyc_checks`, `applications`, `documents`, `affordability_assessments`, `decisions`, `products` (pricing, terms, caps), `loans`, `drawdowns`, `schedules`, `debit_mandates`, `collections`, `payouts`, `statements`, `support_threads` / `support_messages`, `ai_conversations` (with retention limit), `notifications`, `admin_users`, `audit_log` (append-only). Money is stored as integer cents.

## 7. Plan, step by step (after sign-off)

1. Monorepo layout: move e.Volt into `apps/evolt`, nothing else in it changes.
2. Reference capture: a script drives the delivered bundle through every screen and saves golden screenshots.
3. Port the UI: convert the template language (`sc-if`/`sc-for`) and the logic class into React components. Remove the splash illustration. Run the pixel-diff CI until every screen passes.
4. Supabase schema, migrations, RLS and RLS tests. Seed the product table with the current 35% (flagged as non-compliant pending counsel).
5. Replace `localStorage` and `Quik1Link` with a typed data layer. Phone-OTP auth.
6. Edge Functions: price quote, decision engine, AI proxy with guardrails, document upload checks.
7. Back office: applications queue, decisions, loan book, audit.
8. Capacitor iOS and Android, native plugins, blank launch screen, icons. PWA manifest.
9. Accessibility and UX pass (additive only), using the HIG and accessibility review skills.
10. Docs: README, DEPLOY, and a compliance checklist for counsel. Then hand back to you.

## 8. UX notes from the review (recommendations, none applied without your OK)

- **The 5-second forced splash** sits on every launch. Store reviewers and users both penalise it. Recommendation: show the brand ≤ 1 s, or only as long as loading actually takes.
- **The three icon-only buttons on login** (face scan, lock, ID card) have no labels. First-time users won't know what they do. Recommendation: screen-reader labels (invisible) and a long-press hint. The look stays the same.
- **Footer legal text** is small grey on dark, so contrast needs checking. NCA and POPIA disclosures need to be legible.
- **The AI says "powered by Claude"** and answers money questions. It must be limited to the customer's own facts, must not encourage borrowing, and must hand off to a human for disputes or hardship (debt-counselling referral).

## 9. Open questions (I need your answers)

1. **Distribution (§0.1):** PWA first with store builds held back (recommended), product restructure, or servicing-only store app?
2. **Pricing (§0.2):** will you take the NCA caps to compliance counsel? Until then, should the app run as a **closed pilot with no real disbursements**?
3. **Back office:** should **e.Volt become Quik1's admin**, pointing at the same database? Or are they separate businesses or entities, each needing its own NCR registration?
4. **Splash, "leave blank":** remove only the illustration (keeping the Quik1 wordmark and progress bar on black), or a completely empty screen?
5. **Lender of record:** which entity holds the NCR registration, and what is the NCRCP number?
6. **Vendors:** any existing relationships for SMS, KYC/liveness, bureau, statement parsing or DebiCheck/payout PSP? Otherwise I'll recommend a shortlist in Phase 2.
7. **Repo:** OK to make this repo a monorepo (`apps/quik1`, `apps/evolt`)?

## 10. Decision log and open threads

| Date | Item | Status |
|---|---|---|
| 13 Oct 2026 | Quik1 prototype received. PRD drafted. | Waiting on sign-off |
| 13 Oct 2026 | Store policy conflict (≤ 60-day / 36% APR) | **Open: Q1** |
| 13 Oct 2026 | 35% flat vs NCA Reg. 42 caps | **Open: Q2, needs counsel** |
| 13 Oct 2026 | e.Volt `schema.sql`: anon read of client PII, open writes, default-admin | **Open: fix separately (needs your go)** |
| 13 Oct 2026 | Recommended stack: Capacitor + React/TS + Supabase | Proposed |
