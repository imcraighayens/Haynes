-- NOT APPLIED BY DEFAULT.
-- Do not move this file into supabase/migrations. Ledger Bot does not apply it.
-- Restores DELETE and TRUNCATE on the 14 book tables to anon, authenticated,
-- and service_role. Run it only after a human asks for those privileges back.

begin;

grant delete, truncate on table public.employees to anon, authenticated, service_role;
grant delete, truncate on table public.clients to anon, authenticated, service_role;
grant delete, truncate on table public.loans to anon, authenticated, service_role;
grant delete, truncate on table public.applications to anon, authenticated, service_role;
grant delete, truncate on table public.audit_log to anon, authenticated, service_role;
grant delete, truncate on table public.bank_tx to anon, authenticated, service_role;
grant delete, truncate on table public.petty_cash to anon, authenticated, service_role;
grant delete, truncate on table public.expenses to anon, authenticated, service_role;
grant delete, truncate on table public.ledger_book to anon, authenticated, service_role;
grant delete, truncate on table public.settings to anon, authenticated, service_role;
grant delete, truncate on table public.q1_signups to anon, authenticated, service_role;
grant delete, truncate on table public.q1_requests to anon, authenticated, service_role;
grant delete, truncate on table public.q1_repayments to anon, authenticated, service_role;
grant delete, truncate on table quik1.applications to anon, authenticated, service_role;

commit;
