-- Quik1 <-> LEDGER bridge: additive only. Nothing existing is altered beyond two new nullable/
-- defaulted columns on applications. No changes to fee/NCR columns, is_staff/is_admin, existing
-- policies or triggers.

begin;

-- applications: decision blob the customer app reads + free-form meta (surplus, docs, raw extras)
alter table public.applications
  add column if not exists meta jsonb not null default '{}'::jsonb,
  add column if not exists decision jsonb;

-- Full-state backup written by the console's native "Supabase book" feature (via /api/ledger).
create table if not exists public.ledger_book (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Customer sign-ups from the Quik1 app (auto-approved by the bridge).
create table if not exists public.q1_signups (
  id text primary key,
  status text not null default 'Pending review',
  name text not null,
  id_number text,
  phone text,
  email text,
  employment text,
  employer text,
  income numeric default 0,
  payday text,
  reviewer text default 'applications@ecoloans.co.za',
  decided_at timestamptz,
  decided_by text,
  note text default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Service requests (e.g. "New account") raised in the Quik1 app.
create table if not exists public.q1_requests (
  id text primary key,
  type text not null,
  detail text default '',
  name text default '',
  "to" text default '',
  status text not null default 'New',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Repayment confirmations the app polls (key 'app' today).
create table if not exists public.q1_repayments (
  key text primary key,
  ok boolean not null default true,
  "by" text default 'Admin',
  at timestamptz not null default now()
);

-- Helpful indexes for the bridge's hot queries (idempotent).
create index if not exists applications_source_status_created_idx
  on public.applications (source, status, created_at desc);
create index if not exists q1_signups_created_idx on public.q1_signups (created_at desc);
create index if not exists q1_requests_created_idx on public.q1_requests (created_at desc);

-- RLS: staff may read; admins may write the book. The server uses the service role and the anon
-- role gets nothing, exactly like the existing tables.
alter table public.ledger_book   enable row level security;
alter table public.q1_signups    enable row level security;
alter table public.q1_requests   enable row level security;
alter table public.q1_repayments enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ledger_book' and policyname = 'staff read') then
    create policy "staff read" on public.ledger_book for select to authenticated using (public.is_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ledger_book' and policyname = 'admin write') then
    create policy "admin write" on public.ledger_book for all to authenticated
      using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'q1_signups' and policyname = 'staff read') then
    create policy "staff read" on public.q1_signups for select to authenticated using (public.is_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'q1_requests' and policyname = 'staff read') then
    create policy "staff read" on public.q1_requests for select to authenticated using (public.is_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'q1_repayments' and policyname = 'staff read') then
    create policy "staff read" on public.q1_repayments for select to authenticated using (public.is_staff());
  end if;
end $$;

commit;
