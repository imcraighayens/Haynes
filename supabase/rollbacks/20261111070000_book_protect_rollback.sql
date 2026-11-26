-- Rollback of supabase/migrations/20261111070000_book_protect.sql.
-- This file is not in supabase/migrations. Ledger Bot does not apply it.
-- It drops the triggers, the function, and public.book_audit.
-- DELETE and TRUNCATE stay revoked.

begin;

drop trigger if exists book_protect_row on public.employees;
drop trigger if exists book_protect_row on public.clients;
drop trigger if exists book_protect_row on public.loans;
drop trigger if exists book_protect_row on public.applications;
drop trigger if exists book_protect_row on public.bank_tx;
drop trigger if exists book_protect_row on public.petty_cash;
drop trigger if exists book_protect_row on public.expenses;
drop trigger if exists book_protect_row on public.ledger_book;
drop trigger if exists book_protect_row on public.settings;
drop trigger if exists book_protect_row on public.q1_signups;
drop trigger if exists book_protect_row on public.q1_requests;
drop trigger if exists book_protect_row on public.q1_repayments;
drop trigger if exists book_protect_row on quik1.applications;

drop function if exists public.book_audit_row();
drop table if exists public.book_audit;

commit;
