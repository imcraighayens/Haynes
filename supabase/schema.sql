-- e.Volt loan dashboard — optional Supabase schema.
-- Run this in the Supabase SQL editor, then set VITE_SUPABASE_URL and
-- VITE_SUPABASE_ANON_KEY in your .env to switch the app from local sample
-- data to live data.

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

-- For a quick demo you can enable public read access (tighten before production):
alter table clients enable row level security;
alter table loans enable row level security;
alter table ledger enable row level security;
alter table logs enable row level security;
alter table team enable row level security;

create policy "public read" on clients for select using (true);
create policy "public read" on loans for select using (true);
create policy "public read" on ledger for select using (true);
create policy "public read" on logs for select using (true);
create policy "public read" on team for select using (true);
