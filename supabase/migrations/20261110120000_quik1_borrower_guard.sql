-- Quik1 borrower devices, one-time codes, attempt log, and encrypted SA ID.
-- Additive. Do not run this from the app. Apply it in the SQL editor after
-- 20261105_quik1_borrower_auth.sql and 20261106_quik1_borrower_app.sql.
-- It does not copy those tables. anon and authenticated get no access.
-- id_ciphertext is AES-256-GCM (v1.<iv>.<tag>.<body>). The key is not in the database.
-- code_hash and token_hash are hashes. The SMS code and the device token are not stored.

begin;

alter table public.q1_borrowers
  add column if not exists id_ciphertext text;

alter table public.q1_borrowers
  drop constraint if exists q1_borrowers_id_ciphertext_fmt;

alter table public.q1_borrowers
  add constraint q1_borrowers_id_ciphertext_fmt
  check (
    id_ciphertext is null
    or (char_length(id_ciphertext) between 40 and 400 and id_ciphertext like 'v1.%')
  );

create table if not exists public.q1_devices (
  id text primary key,
  borrower_id text not null references public.q1_borrowers (id),
  token_hash text not null unique,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint q1_devices_token_hash_hex check (token_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists q1_devices_borrower_idx
  on public.q1_devices (borrower_id);

create table if not exists public.q1_otp_challenges (
  id text primary key,
  borrower_id text not null references public.q1_borrowers (id),
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint q1_otp_code_hash_len check (char_length(code_hash) between 20 and 200)
);

create index if not exists q1_otp_borrower_idx
  on public.q1_otp_challenges (borrower_id, created_at desc);

create table if not exists public.q1_auth_attempts (
  id text primary key,
  borrower_id text,
  kind text not null,
  ip_hash text not null,
  created_at timestamptz not null default now(),
  constraint q1_auth_attempts_kind check (kind in ('pin', 'otp')),
  constraint q1_auth_attempts_ip_hash_hex check (ip_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists q1_auth_attempts_ip_created_idx
  on public.q1_auth_attempts (ip_hash, created_at desc);

create index if not exists q1_auth_attempts_borrower_created_idx
  on public.q1_auth_attempts (borrower_id, created_at desc);

alter table public.q1_devices enable row level security;
alter table public.q1_otp_challenges enable row level security;
alter table public.q1_auth_attempts enable row level security;

alter table public.q1_devices force row level security;
alter table public.q1_otp_challenges force row level security;
alter table public.q1_auth_attempts force row level security;

revoke all on table public.q1_devices from public, anon, authenticated;
revoke all on table public.q1_otp_challenges from public, anon, authenticated;
revoke all on table public.q1_auth_attempts from public, anon, authenticated;

comment on column public.q1_borrowers.id_ciphertext is
  'AES-256-GCM ciphertext of an SA ID. The key is QUIK1_ID_KEY and is not stored here.';
comment on table public.q1_devices is
  'Recognised Quik1 device. token_hash is SHA-256 of the httpOnly cookie. The token is not stored.';
comment on table public.q1_otp_challenges is
  'SMS one-time code for an unrecognised device. code_hash is scrypt. The code is not stored.';
comment on table public.q1_auth_attempts is
  'Failed PIN and OTP attempts. ip_hash is not a raw address. No PIN or code is stored.';

commit;
