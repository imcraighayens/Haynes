-- Users / Borrowers
create table users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  id_number text unique not null,
  phone text,
  email text unique,
  password_hash text,
  credit_limit numeric(10,2) default 0,
  available_credit numeric(10,2) default 0,
  mandate_active boolean default false,
  mandate_ref text,
  bank_name text,
  account_number text,
  branch_code text,
  debit_date int default 25,
  member_since date default current_date,
  created_at timestamptz default now()
);

-- Applications
create table applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  status text default 'pending' check (status in ('pending','approved','declined','review')),
  ai_credit_offer numeric(10,2),
  monthly_income numeric(10,2),
  payday int,
  documents_verified boolean default false,
  admin_note text,
  doc_statement_url text,
  doc_payslip_url text,
  doc_id_url text,
  created_at timestamptz default now()
);

-- Loans
create table loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  application_id uuid references applications(id),
  amount numeric(10,2) not null,
  interest_rate numeric(5,4) default 0.35,
  interest numeric(10,2),
  total_due numeric(10,2),
  debit_date date,
  status text default 'active' check (status in ('active','settled','defaulted')),
  mandate_ref text,
  contract_id text unique,
  contract_url text,
  created_at timestamptz default now()
);

-- Mandates
create table mandates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  nupay_mandate_id text,
  bank_name text,
  account_number text,
  branch_code text,
  debit_date int default 25,
  status text default 'pending' check (status in ('pending','active','cancelled','failed')),
  authorised_at timestamptz,
  created_at timestamptz default now()
);

-- Transactions
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references loans(id),
  loan_id uuid references loans(id),
  type text check (type in ('credit','debit','contract','mandate')),
  amount numeric(10,2),
  description text,
  created_at timestamptz default now()
);

-- Indexes
create index on applications(status);
create index on loans(user_id, status);
create index on transactions(user_id);
