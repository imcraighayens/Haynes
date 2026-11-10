-- Quik1 borrower sign-in. Additive only. Do not run this from the app.
-- Apply it once in the Supabase SQL editor for ledger-ecoloans (project ref from SUPABASE_URL).
--
-- Borrowers are rows in this project, not auth.users. The sign-up trigger
-- auth_signup_allowlist refuses any email that is not an active employee, and
-- clients usually have no email or phone. Nothing here weakens that trigger,
-- and nothing reads an ID number.
--
-- The service role (Vercel functions) is the only writer. anon and authenticated
-- get no grants and no policies. RLS is forced so a grant added later still
-- denies rows until a policy exists.

begin;

create table if not exists public.q1_borrowers (
  id text primary key,
  client_id text not null unique references public.clients (id),
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint q1_borrowers_pin_hash_len check (char_length(pin_hash) between 4 and 200),
  constraint q1_borrowers_attempts_nonneg check (failed_attempts >= 0 and failed_attempts <= 20)
);

create table if not exists public.q1_invites (
  id text primary key,
  client_id text not null references public.clients (id),
  code_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text,
  constraint q1_invites_code_hash_hex check (code_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.q1_sessions (
  id text primary key,
  borrower_id text not null references public.q1_borrowers (id),
  client_id text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- One unused invite per client. Reissue revokes the previous open row first.
create unique index if not exists q1_invites_one_open
  on public.q1_invites (client_id)
  where redeemed_at is null and revoked_at is null;

create index if not exists q1_invites_client_created_idx
  on public.q1_invites (client_id, created_at desc);

create index if not exists q1_sessions_borrower_idx
  on public.q1_sessions (borrower_id);

alter table public.q1_borrowers enable row level security;
alter table public.q1_invites enable row level security;
alter table public.q1_sessions enable row level security;

alter table public.q1_borrowers force row level security;
alter table public.q1_invites force row level security;
alter table public.q1_sessions force row level security;

revoke all on table public.q1_borrowers from public, anon, authenticated;
revoke all on table public.q1_invites from public, anon, authenticated;
revoke all on table public.q1_sessions from public, anon, authenticated;

comment on table public.q1_borrowers is
  'Quik1 borrower identity bound to one Ledger client. pin_hash is scrypt only.';
comment on table public.q1_invites is
  'Single-use staff invite. code_hash is SHA-256 of the code. The code is not stored.';
comment on table public.q1_sessions is
  'Server session for a borrower. Revoked on logout, a new sign-in, or a reset invite.';

commit;
