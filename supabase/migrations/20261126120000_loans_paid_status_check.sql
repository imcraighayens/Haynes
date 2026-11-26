-- Protective check: status paid implies instalments_paid >= 1 and a
-- non-empty paid_dates array.
--
-- NOT APPLIED. This file is for Ledger Bot review. Do not run it in the
-- Supabase SQL editor, from CI, or from a preview deploy. Preview deploys
-- use the production database, and this change must not be applied until
-- that review accepts it.
--
-- Additive and NOT VALID: existing rows are not scanned, so a short
-- historical row does not fail the migration and the statement does not
-- rewrite data. Inserts and updates are checked. Scanning existing rows
-- is a separate later step, and this file does not do it.
--
-- The check matched the live book on 26 Nov 2026 (every paid loan already
-- had a count and a date). It does not correct rows.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loans_paid_has_count_and_date'
      and conrelid = 'public.loans'::regclass
  ) then
    alter table public.loans
      add constraint loans_paid_has_count_and_date
      check (
        status is distinct from 'paid'
        or (
          coalesce(instalments_paid, 0) >= 1
          and paid_dates is not null
          and jsonb_typeof(paid_dates) = 'array'
          and jsonb_array_length(paid_dates) >= 1
        )
      ) not valid;
  end if;
end $$;
