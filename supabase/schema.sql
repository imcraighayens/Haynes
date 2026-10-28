-- ════════════════════════════════════════════════════════════════════════════
-- LEDGER by Ecoloans — Supabase schema
-- ════════════════════════════════════════════════════════════════════════════
--
-- HOW TO RUN
--   Supabase dashboard → SQL Editor → paste this whole file → Run.
--   The script is idempotent: safe to run again after changes.
--
-- FIRST USER
--   1. Authentication → Providers → Email: turn OFF "Allow new users to sign
--      up" so nobody can self-register.
--   2. Authentication → Users → Add user (email + password, tick
--      "Auto-confirm").
--   3. Add their team row so the console knows their name and role:
--
--        insert into public.employees (id, name, email, role, active, approval_limit, created_at)
--        values ('e1', 'Craig Moatshe', 'craig@ecoloans.co.za', 'admin', true, 50000, now());
--
--      Nobody can read or write anything until they have an active employees
--      row: there is no "first sign-in becomes admin" shortcut, because
--      Supabase allows public sign-up by default and the anon key ships in
--      the website.
--   4. Every further person needs BOTH a Supabase Auth user and an employees
--      row with the same email (roles: admin, manager, agent, collections,
--      auditor). Disabling them in Ledger › Employees removes their access.
--
-- SECURITY MODEL
--   • RLS is on for every table. There is no anon access at all.
--   • Only signed-in users who are active employees (is_staff()) can read or
--     write. A signed-in user who is not on the team sees nothing.
--   • Only admins (is_admin()) can change employees or settings, so nobody
--     can raise their own role.
--   • Nothing is ever hard-deleted: there are no delete policies, and a
--     trigger blocks DELETE on the lending tables. Records are archived with
--     deleted_at (NCA s170 / FICA retention: 5 years).
--   • audit_log is append-only: rows can be re-sent unchanged (idempotent
--     uploads) but never altered.
--
-- COLUMN NAMES
--   Columns are the snake_case form of the TypeScript fields in
--   src/domain/types.ts (src/store/remote.ts converts). Nested values
--   (schedule, expenses, contract, contract_clauses) are jsonb.
--   There are deliberately no foreign keys between tables: a single bad row
--   in an imported book must not block the rest of the upload. The app only
--   creates loans for clients that exist.
--
-- MIGRATING FROM e.VOLT
--   e.Volt used tables named clients / loans / ledger / logs / team with
--   camelCase columns. Those clash with this schema. Before running, either
--   drop them (if the data is already exported) or rename them out of the
--   way — uncomment this block:
--
--   alter table if exists public.clients rename to evolt_clients;
--   alter table if exists public.loans   rename to evolt_loans;
--   alter table if exists public.ledger  rename to evolt_ledger;
--   alter table if exists public.logs    rename to evolt_logs;
--   alter table if exists public.team    rename to evolt_team;
--
--   Then bring the book in through Ledger › Data › Import (prototype book or
--   a LEDGER JSON export).
-- ════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────── Tables ─────────────────────────────

create table if not exists public.employees (
  id              text primary key,
  name            text not null,
  email           text not null unique,
  role            text not null default 'agent' check (role in ('admin', 'manager', 'agent', 'collections', 'auditor')),
  active          boolean not null default true,
  approval_limit  numeric(14,2) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text
);

create table if not exists public.clients (
  id            text primary key,
  ref           text not null,
  name          text not null,
  id_number     text,            -- SA ID: POPIA special personal information
  dob           date,
  email         text,
  phone         text,
  address       text,
  city          text,
  province      text,
  employment    text,
  employer      text,
  job_title     text,
  tenure        text,
  net_salary    numeric(14,2) not null default 0,
  gross_salary  numeric(14,2) not null default 0,
  other_income  numeric(14,2) not null default 0,
  expenses      jsonb not null default '{"rent":0,"transport":0,"groceries":0,"otherDebt":0,"other":0}'::jsonb,
  bank          text,
  branch_code   text,
  account_no    text,
  account_type  text,
  officer_id    text,
  score         integer not null default 0,
  blocked       boolean not null default false,
  contract      jsonb not null default '{"no":"","signedOn":null,"signature":null}'::jsonb,
  created_at    timestamptz not null default now(),
  created_by    text,
  retain_until  date,            -- FICA / NCA: 5 years after last transaction
  deleted_at    timestamptz,     -- soft delete only
  updated_at    timestamptz not null default now(),
  updated_by    text
);

create table if not exists public.loans (
  id                 text primary key,
  ref                text not null,
  client_id          text not null,
  application_id     text,
  principal          numeric(14,2),               -- null when not recorded (bank-report loans)
  principal_derived  boolean not null default false,
  return_rate_pct    numeric(7,3) not null default 35,
  instalment_amount  numeric(14,2) not null,      -- return per instalment
  collection_fee     numeric(14,2) not null default 0,
  schedule           jsonb not null default '[]'::jsonb,  -- ISO dates, earliest first
  instalments_paid   integer not null default 0,
  prior_instalments  integer not null default 0,
  status             text not null default 'issued' check (status in ('issued', 'overdue', 'paid', 'settled_early', 'written_off')),
  status_at          timestamptz,
  mandate_id         text,
  contract_ref       text,                         -- DebiCheck contract reference (DCPRD…)
  paid_dates         jsonb not null default '[]'::jsonb,  -- actual collection date per instalment
  purpose            text not null default 'Personal',
  issued_on          date,
  issued_by          text,
  officer_id         text,
  created_at         timestamptz not null default now(),
  written_off_at     timestamptz,
  write_off_reason   text,
  deleted_at         timestamptz,
  updated_at         timestamptz not null default now(),
  updated_by         text
);

create table if not exists public.applications (
  id              text primary key,
  ref             text not null,
  client_id       text,
  name            text not null,
  phone           text,
  email           text,
  id_number       text,
  employer        text,
  job_title       text,
  net_income      numeric(14,2) not null default 0,
  bank            text,
  amount          numeric(14,2) not null,
  term_months     integer not null default 1,
  purpose         text not null default 'Personal',
  source          text not null default 'Walk-in',
  status          text not null default 'new' check (status in ('new', 'reviewing', 'approved', 'declined')),
  decline_reason  text,
  decided_by      text,
  decided_at      timestamptz,
  loan_id         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text
);

-- The logbook. Append-only.
create table if not exists public.audit_log (
  id          text primary key,
  at          timestamptz not null default now(),
  type        text not null,
  ref         text not null default '—',
  customer    text not null default '—',
  amount      numeric(14,2) not null default 0,
  "by"        text not null,
  comment     text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.petty_cash (
  id          text primary key,
  date        date not null,
  amount      numeric(14,2) not null,
  category    text not null default 'other' check (category in ('travel', 'office', 'airtime', 'meals', 'advance', 'other')),
  purpose     text not null,
  borrower    text not null default '',
  notes       text not null default '',
  status      text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REPAID', 'DECLINED')),
  "by"        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.expenses (
  id          text primary key,
  name        text not null,
  amount      numeric(14,2) not null default 0,   -- per month
  deleted_at  timestamptz,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.bank_tx (
  id          text primary key,
  at          timestamptz not null default now(),
  type        text not null check (type in ('in', 'out')),
  amount      numeric(14,2) not null,
  ref         text not null default '—',
  label       text not null default '',
  "by"        text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Single row (id = 'org') holding organisation settings.
create table if not exists public.settings (
  id                       text primary key default 'org' check (id = 'org'),
  org_name                 text not null default 'Ecoloans',
  org_legal_name           text not null default 'Ecoloans (Pty) Ltd',
  ncr_reg_no               text not null default '',
  company_reg_no           text not null default '',
  tagline                  text not null default '',
  address                  text not null default '',
  contact_email            text not null default '',
  contact_phone            text not null default '',
  website                  text not null default '',
  default_return_rate_pct  numeric(7,3) not null default 35,
  default_collection_fee   numeric(14,2) not null default 0,
  protection_fee           numeric(14,2) not null default 0,
  bank_opening_balance     numeric(14,2),
  bank_opening_at          timestamptz,
  mask_pii                 boolean not null default true,
  contract_intro           text not null default '',
  contract_clauses         jsonb not null default '[]'::jsonb,
  updated_at               timestamptz not null default now(),
  updated_by               text
);

-- Columns added after the first release (safe to re-run).
alter table public.loans add column if not exists contract_ref text;
alter table public.loans add column if not exists paid_dates   jsonb not null default '[]'::jsonb;
alter table public.settings add column if not exists company_reg_no text not null default '';
alter table public.settings add column if not exists tagline        text not null default '';
alter table public.settings add column if not exists address        text not null default '';
alter table public.settings add column if not exists contact_email  text not null default '';
alter table public.settings add column if not exists contact_phone  text not null default '';
alter table public.settings add column if not exists website        text not null default '';

-- ───────────────────────────── Indexes ─────────────────────────────

create index if not exists loans_client_idx       on public.loans (client_id);
create index if not exists loans_mandate_idx      on public.loans (mandate_id);
create index if not exists loans_status_idx       on public.loans (status) where deleted_at is null;
create index if not exists clients_id_number_idx  on public.clients (id_number);
create index if not exists audit_log_at_idx       on public.audit_log (at desc);
create index if not exists bank_tx_at_idx         on public.bank_tx (at desc);
create index if not exists employees_email_idx    on public.employees (lower(email));

-- ───────────────────────────── Access helper ─────────────────────────────

-- True for a signed-in, active team member. No bootstrap: the first admin's
-- employees row is inserted from the SQL editor (see FIRST USER above).
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.employees e
    where lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and e.active
  );
$$;

-- True for a signed-in, active admin.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.employees e
    where lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and e.active and e.role = 'admin'
  );
$$;

revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ───────────────────────────── Integrity triggers ─────────────────────────────

-- Lending records are archived (deleted_at), never removed.
create or replace function public.block_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard delete is not allowed on %. Archive the row by setting deleted_at instead.', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists clients_no_delete on public.clients;
create trigger clients_no_delete before delete on public.clients for each row execute function public.block_hard_delete();
drop trigger if exists loans_no_delete on public.loans;
create trigger loans_no_delete before delete on public.loans for each row execute function public.block_hard_delete();
drop trigger if exists audit_log_no_delete on public.audit_log;
create trigger audit_log_no_delete before delete on public.audit_log for each row execute function public.block_hard_delete();
drop trigger if exists bank_tx_no_delete on public.bank_tx;
create trigger bank_tx_no_delete before delete on public.bank_tx for each row execute function public.block_hard_delete();

-- Logbook rows may be re-sent unchanged (idempotent upload) but never edited.
create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
as $$
begin
  if (new.at, new.type, new.ref, new.customer, new.amount, new."by", new.comment)
     is distinct from (old.at, old.type, old.ref, old.customer, old.amount, old."by", old.comment) then
    raise exception 'The logbook is append-only — entry % cannot be changed.', old.id
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only before update on public.audit_log for each row execute function public.audit_log_append_only();

-- ───────────────────────────── Row Level Security ─────────────────────────────
-- Staff can select / insert / update. No delete policies anywhere.

do $$
declare
  t text;
begin
  foreach t in array array['employees', 'clients', 'loans', 'applications', 'audit_log', 'petty_cash', 'expenses', 'bank_tx', 'settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);

    execute format('drop policy if exists "staff read" on public.%I', t);
    execute format('drop policy if exists "staff insert" on public.%I', t);
    execute format('drop policy if exists "staff update" on public.%I', t);

    execute format('create policy "staff read" on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('create policy "staff insert" on public.%I for insert to authenticated with check (public.is_staff())', t);
    execute format('create policy "staff update" on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end;
$$;

-- Only admins change the team (roles, approval limits) and org settings,
-- so nobody can raise their own role.
do $$
declare
  t text;
begin
  foreach t in array array['employees', 'settings']
  loop
    execute format('drop policy if exists "staff insert" on public.%I', t);
    execute format('drop policy if exists "staff update" on public.%I', t);
    execute format('drop policy if exists "admin insert" on public.%I', t);
    execute format('drop policy if exists "admin update" on public.%I', t);
    execute format('create policy "admin insert" on public.%I for insert to authenticated with check (public.is_admin())', t);
    execute format('create policy "admin update" on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end;
$$;

-- Signed-in users must be able to look up their own team row to learn their
-- role, even before an admin has finished setting the team up.
drop policy if exists "read own employee row" on public.employees;
create policy "read own employee row" on public.employees
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Remove the e.Volt-era policies if this database ran the old schema.
-- (Harmless when they do not exist.)
do $$
declare
  t text;
begin
  foreach t in array array['clients', 'loans']
  loop
    execute format('drop policy if exists "read all" on public.%I', t);
    execute format('drop policy if exists "write auth" on public.%I', t);
    execute format('drop policy if exists "demo all" on public.%I', t);
  end loop;
end;
$$;
