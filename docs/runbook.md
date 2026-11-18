# Ledger runbook

No ad-hoc reloads, TRUNCATE, or bulk DELETE on production by any bot, agent or person. Data fixes are single-row, audited, through the app's save path or a reviewed migration, with Craig's go for client or loan data.

`replace_book` is the only full book reload in this repo. It archives loans by setting `deleted_at`. It is refused when `NODE_ENV` is `production` or the host is `quik1ledger.com`, `www.quik1ledger.com`, or `ecoloans-six.vercel.app`. There is no SQL `TRUNCATE` script.

`supabase/migrations/20261111070000_book_protect.sql` revokes `TRUNCATE` and `DELETE` on the 13 book tables from `PUBLIC`, `anon`, `authenticated`, and `service_role`. `postgres` keeps both. Ledger Bot applies that file. Do not apply it by hand against production.
