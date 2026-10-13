-- Quik1 core schema.
--
-- Principles
--   * Money is integer cents (bigint). Never floats.
--   * Customers never write money, status or decision columns directly. Every
--     state change goes through a SECURITY DEFINER function that re-checks the
--     rules server-side (the app's own checks are UX only).
--   * Row Level Security on every table. anon sees nothing.
--   * audit_log is append-only and written by triggers.
--   * Pricing lives in `products`, not code. The seeded 35% flat charge is the
--     delivered design's number and is flagged pending compliance review
--     (see docs/quik1/PRD.md §0.2).

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Config
-- ─────────────────────────────────────────────────────────────────────────────
create table app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into app_config (key, value) values
  ('lender', '{"name":"Quik1","ncr_number":"NCRCP00000","support_email":"applications@ecoloans.co.za"}'),
  -- Closed pilot: no real money moves. Payouts are held, collections and
  -- debit-order approvals use the mock provider. Flip only after counsel signs off.
  ('pilot', '{"enabled":true,"mock_mandates":true,"mock_collections":true,"hold_payouts":true}'),
  ('limits', '{"max_principal_cents":800000,"min_principal_cents":50000,"first_loan_cap_cents":100000,"min_income_cents":300000,"salary_day":25}'),
  ('ai', '{"enabled":true,"model":"claude-haiku-5-5","max_tokens":400,"retention_days":90}');

-- ─────────────────────────────────────────────────────────────────────────────
-- Staff
-- ─────────────────────────────────────────────────────────────────────────────
create type staff_role as enum ('viewer', 'support', 'credit_officer', 'admin');

create table staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  role staff_role not null default 'viewer',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function staff_role_of(uid uuid) returns staff_role
language sql stable security definer set search_path = public as $$
  select role from staff where user_id = uid and active
$$;

-- true when the caller is active staff with at least `min_role`
create or replace function is_staff(min_role staff_role default 'viewer') returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(staff_role_of(auth.uid()) >= min_role, false)
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Customers
-- ─────────────────────────────────────────────────────────────────────────────
create type customer_status as enum ('pending_review', 'approved', 'declined', 'suspended');

create table customers (
  id uuid primary key references auth.users (id) on delete cascade,
  ref text not null unique default ('SU-' || (2041 + floor(random() * 900000))::bigint),
  full_name text not null,
  id_number text not null unique check (id_number ~ '^\d{13}$'),
  phone text not null unique check (phone ~ '^\+27\d{9}$'),
  email text not null,
  employment text,
  employer text,
  income_cents bigint not null default 0 check (income_cents >= 0),
  payday text,
  bank_label text,
  photo_path text,
  status customer_status not null default 'pending_review',
  status_note text,
  -- growth mechanic (design: base starts at the first loan, doubles as paid charges reach it)
  base_amount_cents bigint not null default 0,
  interest_paid_cents bigint not null default 0,
  graduated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Secrets the app never reads: PIN hash and lockout. Service role only.
create table customer_secrets (
  customer_id uuid primary key references customers (id) on delete cascade,
  pin_hash text not null,
  pin_failures int not null default 0,
  locked_until timestamptz
);

create type consent_kind as enum ('credit_check', 'terms_privacy', 'debit_order', 'ai_assistant', 'marketing');

create table consents (
  id bigint generated always as identity primary key,
  customer_id uuid not null references customers (id) on delete cascade,
  kind consent_kind not null,
  version text not null,
  granted boolean not null default true,
  created_at timestamptz not null default now()
);

-- Devices that completed SMS verification; PIN login is only allowed on these.
create table devices (
  id bigint generated always as identity primary key,
  customer_id uuid not null references customers (id) on delete cascade,
  device_hash text not null,
  label text,
  verified_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked boolean not null default false,
  unique (customer_id, device_hash)
);

-- SMS one-time codes (hashed). Service role only.
create table otp_challenges (
  id bigint generated always as identity primary key,
  phone text not null,
  code_hash text not null,
  purpose text not null default 'login',
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_phone_idx on otp_challenges (phone, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Products (pricing)
-- ─────────────────────────────────────────────────────────────────────────────
create table products (
  id text primary key,
  term_months int not null check (term_months between 1 and 6),
  -- flat charge on principal, basis points (3500 = 35%)
  charge_bps int not null check (charge_bps >= 0),
  initiation_fee_cents bigint not null default 0,
  monthly_service_fee_cents bigint not null default 0,
  active boolean not null default true,
  compliance_status text not null default 'pending_counsel',
  notes text,
  unique (term_months, active)
);

insert into products (id, term_months, charge_bps, notes) values
  ('flat-1m', 1, 3500, 'Delivered design: one flat 35%. Appears to exceed NCA Reg 42 caps for 1-month terms — PRD §0.2.'),
  ('flat-2m', 2, 3500, 'Delivered design: one flat 35%.'),
  ('flat-3m', 3, 3500, 'Delivered design: one flat 35%.'),
  ('flat-6m', 6, 3500, 'Delivered design: one flat 35%.');

create or replace function config(k text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from app_config where key = k
$$;

-- Price a principal for a term. Single source of truth for every amount the app shows.
create or replace function quote(principal_cents bigint, term_months int)
returns table (product_id text, principal bigint, charge bigint, total bigint, instalment bigint, charge_bps int)
language sql stable security definer set search_path = public as $$
  select p.id,
         principal_cents,
         round(principal_cents * p.charge_bps / 10000.0)::bigint + p.initiation_fee_cents + p.monthly_service_fee_cents * p.term_months,
         principal_cents + round(principal_cents * p.charge_bps / 10000.0)::bigint + p.initiation_fee_cents + p.monthly_service_fee_cents * p.term_months,
         ceil((principal_cents + round(principal_cents * p.charge_bps / 10000.0)::bigint + p.initiation_fee_cents + p.monthly_service_fee_cents * p.term_months)::numeric / p.term_months)::bigint,
         p.charge_bps
  from products p
  where p.term_months = quote.term_months and p.active
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Applications, documents, decisions
-- ─────────────────────────────────────────────────────────────────────────────
create type application_status as enum ('submitted', 'approved', 'referred', 'declined', 'accepted', 'withdrawn', 'expired');

create table applications (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('AP-' || (1085 + floor(random() * 900000))::bigint),
  customer_id uuid not null references customers (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  term_months int not null,
  purpose text not null,
  income_cents bigint not null default 0,
  expenses_cents bigint not null default 0,
  status application_status not null default 'submitted',
  verdict text,
  offer_cents bigint,
  flags jsonb not null default '[]',
  affordability int,
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index applications_customer_idx on applications (customer_id, created_at desc);

create type document_kind as enum ('bank_statement', 'proof_of_income', 'id_document', 'photo');
create type check_state as enum ('checking', 'ok', 'fail');

create table documents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  kind document_kind not null,
  slot int not null default 0,              -- statement month index (0 = most recent)
  storage_path text not null,
  file_name text not null,
  check_state check_state not null default 'checking',
  check_reason text,
  checked_by text,                          -- provider name, e.g. 'mock-statement-check'
  created_at timestamptz not null default now()
);
create index documents_customer_idx on documents (customer_id, kind, slot, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Loans, drawdowns, mandates, payouts, collections
-- ─────────────────────────────────────────────────────────────────────────────
create sequence loan_ref_seq start 84214;

create type loan_status as enum ('active', 'settled', 'written_off', 'cancelled');

create table loans (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('QK-' || nextval('loan_ref_seq')),
  customer_id uuid not null references customers (id) on delete cascade,
  term_months int not null,
  principal_cents bigint not null,
  charge_cents bigint not null,
  total_cents bigint not null,
  first_due_date date not null,
  status loan_status not null default 'active',
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
-- one open loan per customer (top-ups are drawdowns on it)
create unique index loans_one_active on loans (customer_id) where status = 'active';

create table drawdowns (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('QK-' || nextval('loan_ref_seq')),
  loan_id uuid not null references loans (id) on delete cascade,
  application_id uuid references applications (id),
  product_id text not null references products (id),
  principal_cents bigint not null,
  charge_cents bigint not null,
  total_cents bigint not null,
  charge_bps int not null,
  purpose text,
  agreement_version text not null,
  signed_at timestamptz not null default now()
);

create type mandate_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table debit_mandates (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  status mandate_status not null default 'pending',
  provider text not null,
  provider_ref text,
  max_amount_cents bigint not null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create type payout_status as enum ('held_pilot', 'pending', 'sent', 'failed');

create table payouts (
  id uuid primary key default gen_random_uuid(),
  drawdown_id uuid not null references drawdowns (id) on delete cascade,
  amount_cents bigint not null,
  status payout_status not null,
  provider text,
  provider_ref text,
  created_at timestamptz not null default now()
);

create type collection_status as enum ('submitted', 'paid', 'failed');

create table collections (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references loans (id) on delete cascade,
  amount_cents bigint not null,
  status collection_status not null default 'submitted',
  provider text not null,
  provider_ref text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Support chat, assistant history, requests
-- ─────────────────────────────────────────────────────────────────────────────
create table support_messages (
  id bigint generated always as identity primary key,
  customer_id uuid not null references customers (id) on delete cascade,
  sender text not null check (sender in ('customer', 'agent', 'system')),
  agent_id uuid references auth.users (id),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index support_customer_idx on support_messages (customer_id, created_at);

create table ai_messages (
  id bigint generated always as identity primary key,
  customer_id uuid not null references customers (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit (append-only)
-- ─────────────────────────────────────────────────────────────────────────────
create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'
);

create or replace function audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_no_update before update or delete on audit_log for each row execute function audit_append_only();

create or replace function audit(action text, entity text, entity_id text, detail jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor, action, entity, entity_id, detail) values (auth.uid(), action, entity, entity_id, detail)
$$;

create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor, action, entity, entity_id, detail)
  values (auth.uid(), lower(tg_op), tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id', ''),
          case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
               when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['customers','applications','loans','drawdowns','debit_mandates','payouts','collections','products','app_config','staff','documents','consents'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', t || '_audit', t);
  end loop;
end $$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger customers_touch before update on customers for each row execute function touch_updated_at();
