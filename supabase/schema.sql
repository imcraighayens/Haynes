-- e.Volt loan dashboard — Supabase schema.
-- Run this in the Supabase SQL editor, then set VITE_SUPABASE_URL and
-- VITE_SUPABASE_ANON_KEY in your .env to switch the app from local sample
-- data to live data.
--
-- This script is idempotent: safe to run more than once.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists clients (
  id text primary key,
  name text not null,
  phone text,
  email text,
  "idNumber" text,
  address text,
  notes text,
  "createdAt" date default now()
);

create table if not exists loans (
  id text primary key,
  "clientId" text references clients(id) on delete cascade,
  "clientName" text not null,
  amount numeric not null,
  "interestRate" numeric not null default 0.35,
  "returnAmount" numeric not null,
  status text not null default 'issued',
  "issuedDate" date not null,
  "dueDate" date not null,
  "paidDate" date
);

create table if not exists ledger (
  id text primary key,
  date date not null,
  type text not null,
  description text not null,
  amount numeric not null,
  reference text
);

create table if not exists logs (
  id text primary key,
  date timestamptz not null default now(),
  actor text not null,
  action text not null,
  detail text not null
);

create table if not exists team (
  id text primary key,
  name text not null,
  email text not null,
  role text not null default 'agent',
  active boolean not null default true
);

create index if not exists loans_client_idx on loans ("clientId");
create index if not exists ledger_ref_idx on ledger (reference);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security (PRODUCTION-SAFE)
--
-- Anyone may READ (the dashboard hydrates with the anon key), but only a
-- signed-in Supabase Auth user may WRITE. The app uses real email/password
-- auth, so the user's JWT is attached to every write automatically.
--
-- To open writes to the anon key as well (quick prototyping, no login), see the
-- commented "DEMO" block at the bottom of this file.
-- ─────────────────────────────────────────────────────────────────────────────
alter table clients enable row level security;
alter table loans   enable row level security;
alter table ledger  enable row level security;
alter table logs    enable row level security;
alter table team    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['clients','loans','ledger','logs','team'] loop
    execute format('drop policy if exists "demo all"  on %I', t);
    execute format('drop policy if exists "read all"  on %I', t);
    execute format('drop policy if exists "write auth" on %I', t);
    execute format('create policy "read all"  on %I for select using (true)', t);
    execute format('create policy "write auth" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed data — the real active loan book (matches the app's offline seed).
-- Safe to re-run: on conflict the rows are upserted.
-- ─────────────────────────────────────────────────────────────────────────────
insert into clients (id, name, phone, email, "idNumber", address, "createdAt") values
  ('c1', 'Lovuyo Khoza',               '+27 82 145 9920', 'lovuyo.k@mail.com',   '9001125...', 'Soweto, JHB',    '2025-11-02'),
  ('c2', 'Keabetswe Moatshe',          '+27 73 882 1140', 'kea.m@mail.com',      null,         'Pretoria North', '2025-11-14'),
  ('c4', 'Viginia Morola',             '+27 81 220 4456', 'v.morola@mail.com',   null,         'Tembisa',        '2025-10-20'),
  ('c5', 'Nkele Moagi',                '+27 72 551 0098', 'nkele.m@mail.com',    null,         'Katlehong',      '2026-01-09'),
  ('c6', 'Nokuthula Patricia Montsho', '+27 83 410 7765', 'patricia.m@mail.com', null,         'Vosloorus',      '2026-01-18')
on conflict (id) do update set
  name = excluded.name, phone = excluded.phone, email = excluded.email,
  "idNumber" = excluded."idNumber", address = excluded.address;

insert into loans (id, "clientId", "clientName", amount, "interestRate", "returnAmount", status, "issuedDate", "dueDate") values
  ('l1', 'c1', 'Lovuyo Khoza',               12000, 0.35, 16200, 'issued', '2026-05-26', '2026-06-25'),
  ('l2', 'c2', 'Keabetswe Moatshe',           9000, 0.35, 12150, 'issued', '2026-05-31', '2026-06-30'),
  ('l4', 'c4', 'Viginia Morola',              2000, 0.35,  2700, 'issued', '2026-05-31', '2026-06-30'),
  ('l5', 'c4', 'Viginia Morola',              5000, 0.35,  6750, 'issued', '2026-05-16', '2026-06-15'),
  ('l6', 'c5', 'Nkele Moagi',                 4000, 0.35,  5400, 'issued', '2026-05-26', '2026-06-25'),
  ('l7', 'c6', 'Nokuthula Patricia Montsho',  3000, 0.35,  4050, 'issued', '2026-05-26', '2026-06-25')
on conflict (id) do nothing;

insert into ledger (id, date, type, description, amount, reference) values
  ('led-cap1',   '2025-10-01', 'capital',    'Initial capital injection',          50000, 'CAP-001'),
  ('led-pc1',    '2026-05-10', 'petty_cash', 'Office airtime & data',               -350, 'PC-014'),
  ('led-pc2',    '2026-05-22', 'petty_cash', 'Transport — client visit',            -220, 'PC-015'),
  ('led-out-l1', '2026-05-26', 'loan_out',   'Loan disbursed — Lovuyo Khoza',     -12000, 'L1'),
  ('led-out-l2', '2026-05-31', 'loan_out',   'Loan disbursed — Keabetswe Moatshe', -9000, 'L2'),
  ('led-out-l4', '2026-05-31', 'loan_out',   'Loan disbursed — Viginia Morola',    -2000, 'L4'),
  ('led-out-l5', '2026-05-16', 'loan_out',   'Loan disbursed — Viginia Morola',    -5000, 'L5'),
  ('led-out-l6', '2026-05-26', 'loan_out',   'Loan disbursed — Nkele Moagi',       -4000, 'L6'),
  ('led-out-l7', '2026-05-26', 'loan_out',   'Loan disbursed — Nokuthula Patricia Montsho', -3000, 'L7')
on conflict (id) do nothing;

insert into team (id, name, email, role, active) values
  ('t1', 'Ecoloan Dev',          'ecoakcess@mail.com', 'admin',   true),
  ('t2', 'Naledi Mthembu',       'naledi@evolt.co.za', 'manager', true),
  ('t3', 'Kabelo Pretorius',     'kabelo@evolt.co.za', 'agent',   true),
  ('t5', 'Auditor (read-only)',  'audit@evolt.co.za',  'viewer',  true)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- DEMO (optional): run this to ALSO allow the anon key to write, so the app
-- works without anyone logging in. INSECURE — only for throwaway prototypes.
--
--   do $$
--   declare t text;
--   begin
--     foreach t in array array['clients','loans','ledger','logs','team'] loop
--       execute format('drop policy if exists "write auth" on %I', t);
--       execute format('create policy "demo all" on %I for all to anon, authenticated using (true) with check (true)', t);
--     end loop;
--   end $$;
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Creating the first admin login
--
-- Supabase Auth users are separate from the `team` table above. To create your
-- admin account, either:
--   1. Supabase Dashboard → Authentication → Users → "Add user" (set email +
--      password, mark email confirmed), OR
--   2. enable email signups and sign up once, then disable open signups.
--
-- The app derives a user's display name and role by matching their login email
-- against the `team` table. Add a matching row so the role is correct, e.g.:
--
--   insert into team (id, name, email, role, active)
--   values ('admin-1', 'Your Name', 'you@example.com', 'admin', true)
--   on conflict (id) do nothing;
--
-- If no team row matches, the app defaults the user to the 'admin' role.
-- ─────────────────────────────────────────────────────────────────────────────
