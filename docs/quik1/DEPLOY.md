# Quik1: deploying

Everything below is done by you (or whoever holds the accounts). Steps marked ⚠️ cost money, go out under the business's name, or can't be undone.

## 1. Supabase (database, auth, storage, functions)

1. ⚠️ Create a Supabase project. Supabase has no South African region, so choose **EU (Frankfurt) or London**. Record the cross-border transfer in the POPIA register (see COMPLIANCE.md).
2. Install the Supabase CLI. Then, from `apps/quik1`:
   ```bash
   supabase link --project-ref <ref>
   supabase db push                      # applies supabase/migrations/*
   supabase functions deploy auth --no-verify-jwt
   supabase functions deploy assistant
   ```
3. Under **Auth → Providers**, turn **off** public sign-ups for email and phone (`supabase/config.toml` sets the same). Customers sign up through `functions/auth`. Staff are created by an admin.
4. Set the function secrets:
   ```bash
   supabase secrets set \
     QUIK1_OTP_PEPPER="$(openssl rand -hex 32)" \
     QUIK1_ALLOWED_ORIGINS="capacitor://localhost,https://localhost,https://app.quik1.co.za" \
     QUIK1_SMS_PROVIDER=clickatell CLICKATELL_API_KEY=... \
     ANTHROPIC_API_KEY=...
   ```
   - For a closed pilot without SMS, use `QUIK1_SMS_PROVIDER=mock` and `QUIK1_DEV_EXPOSE_OTP=true`. The app then shows the code on screen.
   - **Never** set that pair on a public build.
5. Retention job. Enable `pg_cron`, then run:
   `select cron.schedule('quik1-retention', '17 2 * * *', 'select purge_expired()');`
6. Edit the config rows. ⚠️ These change live lending behaviour:
   ```sql
   update app_config set value = jsonb_set(value, '{ncr_number}', '"NCRCP12345"') where key = 'lender';
   -- pricing (after counsel): update products set charge_bps = ..., initiation_fee_cents = ..., monthly_service_fee_cents = ...;
   -- going live (after counsel + provider contracts): update app_config set value = '{"enabled":false,...}' where key = 'pilot';
   ```

## 2. Staff accounts (back office)

1. In **Auth → Users**, add a user with an email and a strong password, and mark them confirmed.
2. Run `insert into staff (user_id, name, role) values ('<auth user id>', 'Name', 'credit_officer');`
   Roles: `viewer` < `support` < `credit_officer` < `admin`.
3. The back office is at `https://<web host>/admin.html`.

## 3. Web app (PWA) and back office

```bash
cd apps/quik1
cp .env.example .env      # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (anon key is public by design; RLS protects data)
npm ci && npm run build   # → dist/ (index.html = app, admin.html = back office)
```
- Host `dist/` on Netlify, Vercel or similar, as a **separate site** from e.Volt. Rewrite unknown paths to `/index.html`.
- Serve it over HTTPS on your own domain. The service worker and Face ID both need HTTPS.

## 4. Android (Google Play): held until the product qualifies (PRD §0.1)

```bash
npm run build && npx cap sync android && npx cap open android
```
1. ⚠️ Create the release keystore and store it safely. Losing it means you can never update the app.
2. Build a signed **AAB** in Android Studio (Build → Generate Signed Bundle).
3. ⚠️ Play Console needs:
   - the personal loans declaration (the 60-day rule, max APR, representative example)
   - a privacy policy URL
   - the Data safety form (phone, ID number, financial info, photos, all encrypted in transit)
   - a demo account for review

## 5. iOS (App Store): held until the product qualifies (PRD §0.1)

Needs a Mac with Xcode 16+.
```bash
npm run build && npx cap sync ios && npx cap open ios
```
1. ⚠️ Set the bundle id `za.co.quik1.app`, your Team, and signing.
2. The Face ID, camera and photo-library usage strings are already in `Info.plist`. Review the wording.
3. ⚠️ App Store Connect needs:
   - privacy nutrition labels
   - the guideline 3.2.2(ix) loan disclosures (max APR, due date)
   - a review demo account

## 6. e.Volt (separate app, same repo)

The repo-root dashboard's `supabase/schema.sql` now only lets signed-in team members see data. ⚠️ **Re-run it in that project's SQL editor** to close the public read on the live database. Make sure everyone who needs access has a row in `team` first.
