# Quik1: compliance checklist for counsel

This is what the build does today and what still needs a decision or sign-off before real lending. It is not legal advice. Its purpose is to make counsel's review fast. ✅ means built. ⚠️ means a decision or action is open.

## National Credit Act / NCR

| Item | Status |
|---|---|
| **Pricing vs Reg. 42 caps.** The design charges a flat 35% on any term. On 1-month short-term credit this appears to exceed interest 5%/month (3% repeat) + initiation R165 + 10% above R1 000 (max R1 050) + service fee R60/month. | ⚠️ **Counsel.** Pricing is data (`products`: `charge_bps`, `initiation_fee_cents`, `monthly_service_fee_cents` per term). Changing it is a config change. Every row is marked `compliance_status = 'pending_counsel'`. |
| **"One flat fee, no initiation or service fee" copy** (login screen, assistant). | ⚠️ May conflict with the itemised cost disclosure. The copy lives in the design and can be changed through `design/overrides.mjs`. |
| **Pre-agreement statement and quote** (Form 20.2 for small agreements). | ⚠️ Not yet a separate document. The offer screen and agreement sheet show principal, charge, total, instalments and first collection. Counsel to confirm the format. A PDF can be generated from `drawdowns`. |
| **Affordability assessment (Reg. 23A).** | ✅ 3 months of statements + proof of income + surplus-income ratio (instalment ≤ 50% of surplus), enforced server-side (`submit_application`). ⚠️ Statement *verification* is a placeholder (filename rules) until a statement-parsing provider is contracted. ⚠️ Repeat borrowers are re-assessed against statements up to 90 days old. Counsel to confirm. |
| **Credit bureau check.** | ✅ Consent captured at sign-up (`consents.credit_check`). ⚠️ No bureau integration yet (Phase 2). |
| **Reckless lending.** Limits grow only as charges are repaid (base doubles up to R8 000). One open loan per customer. | ✅ Enforced in the database. |
| **NCR registration number displayed.** | ⚠️ Placeholder `NCRCP00000` in `app_config.lender`. |
| **Early settlement without penalty.** | ✅ |
| **Debt counselling / hardship route.** | ✅ The assistant is instructed to route hardship to Help and mention free debt counselling. ⚠️ Add a written hardship procedure for staff. |

## FICA

| Item | Status |
|---|---|
| Identity: SA ID number with checksum, name, phone ownership (SMS code), ID document photo | ✅ ID photo upload. ⚠️ No liveness or Home Affairs verification yet (Phase 2 provider). The design's profile says "Checked with Home Affairs", which is **not true yet**. Change the copy or integrate before go-live. |
| Staff approve every new account before borrowing | ✅ Sign-up queue in the back office. |
| Record keeping ≥ 5 years | ✅ Append-only `audit_log`. Documents in private storage. ⚠️ Set a backup/retention policy on the Supabase project. |
| Sanctions / PEP screening | ⚠️ Not built. |

## POPIA

| Item | Status |
|---|---|
| Consent records (credit check, terms and privacy, debit order) with versions | ✅ `consents` |
| Least access: customers see only their own data, anon sees nothing, staff by role | ✅ RLS, tested in CI (`supabase/tests/lending.test.sql`) |
| No personal data stored on the device by the app | ✅ (session token only; native: Preferences) |
| **Cross-border transfer**: Supabase hosting (EU/UK) and the AI assistant (Anthropic, US) | ⚠️ Disclose in the privacy policy and record s72 basis. The assistant sends only the customer's own account summary and messages. |
| Assistant transcripts retained 90 days, OTPs 1 day | ✅ `purge_expired()` (schedule with pg_cron) |
| Information Officer registered, PAIA manual | ⚠️ |

## Payments

| Item | Status |
|---|---|
| DebiCheck mandate before payout | ✅ Enforced (`accept_offer` requires an approved mandate covering the full amount owed). ⚠️ Mock provider in pilot. Needs a PSP contract (Phase 2). |
| Payouts | ✅ Held in pilot (`payouts.status = held_pilot`). ⚠️ Payout provider and account verification (AVS) before go-live. Bank details editing in the app is not yet saved server-side for this reason. |

## Other regulatory exposure in the delivered design

- **"Quik1 Save — Earn interest on money you put aside"** (Accounts screen). Taking deposits needs a banking licence. In the app this only sends a request to Help, but the copy advertises a product Quik1 can't offer. ⚠️ Remove or reword before launch.
- **Quik1 Credit card** (card number, freeze, replace) and **BillOn** promotions. These are not real products. ⚠️ Hide or reword before launch.
- **App stores.** See PRD §0.1. Google Play and Apple both reject loans repayable in full within 60 days. Apple also caps APR at 36%.
