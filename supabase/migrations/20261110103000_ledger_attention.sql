-- Staff acknowledgements for the Ledger "accounts need attention" popup.
-- One row per staff email and loan. marker is the overdue episode
-- (status, first missed due date, and the loan's status_at). When that
-- episode changes, the stored marker no longer matches and the popup returns.
--
-- Apply this file once in the Supabase SQL editor for ledger-ecoloans.
-- Do not run it from the app. Until the table exists, Ledger keeps the
-- acknowledgement in that browser for the signed-in staff email and the
-- book still loads.

create table if not exists public.ledger_attention (
  id text primary key,
  staff_email text not null,
  loan_id text not null,
  marker text not null,
  acknowledged_at timestamptz not null default now(),
  unique (staff_email, loan_id)
);

create index if not exists ledger_attention_staff_idx
  on public.ledger_attention (staff_email);

-- Points the acknowledgement at the loan. Its own step so running this file
-- again, after the table already exists, does not fail and does not rewrite rows.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ledger_attention_loan_id_fkey'
      and conrelid = 'public.ledger_attention'::regclass
  ) then
    alter table public.ledger_attention
      add constraint ledger_attention_loan_id_fkey
      foreign key (loan_id) references public.loans (id);
  end if;
end $$;

alter table public.ledger_attention enable row level security;

revoke all on table public.ledger_attention from public;
revoke all on table public.ledger_attention from anon;
revoke all on table public.ledger_attention from authenticated;
