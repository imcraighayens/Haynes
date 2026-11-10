-- Quik1 Face ID / fingerprint (WebAuthn platform authenticator).
-- Additive only. Do not run this from the app, and do not apply it from a deploy.
-- Apply it once in the Supabase SQL editor for ledger-ecoloans when biometric
-- sign-in should start working. Until then the API answers
-- "Biometric sign-in is not set up yet" and the PIN screen stays the way in.
--
-- A credential is the public key for one borrower on one device. The private
-- key never leaves the phone. Challenges are single use. anon and authenticated
-- get no grants. The service role is the only writer, same as q1_borrowers.

begin;

create table if not exists public.q1_webauthn_credentials (
  id text primary key,
  borrower_id text not null references public.q1_borrowers (id),
  public_key text not null,
  sign_count bigint not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint q1_webauthn_credential_id check (id ~ '^[A-Za-z0-9_-]{16,256}$'),
  constraint q1_webauthn_public_key check (char_length(public_key) between 16 and 4000),
  constraint q1_webauthn_sign_count check (sign_count >= 0)
);

create table if not exists public.q1_webauthn_challenges (
  id text primary key,
  borrower_id text not null references public.q1_borrowers (id),
  purpose text not null,
  challenge text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint q1_webauthn_purpose check (purpose in ('register', 'login')),
  constraint q1_webauthn_challenge check (challenge ~ '^[A-Za-z0-9_-]{43}$')
);

create index if not exists q1_webauthn_credentials_borrower_idx
  on public.q1_webauthn_credentials (borrower_id);

create index if not exists q1_webauthn_challenges_open_idx
  on public.q1_webauthn_challenges (borrower_id, purpose)
  where consumed_at is null;

alter table public.q1_webauthn_credentials enable row level security;
alter table public.q1_webauthn_challenges enable row level security;
alter table public.q1_webauthn_credentials force row level security;
alter table public.q1_webauthn_challenges force row level security;

revoke all on table public.q1_webauthn_credentials from public, anon, authenticated;
revoke all on table public.q1_webauthn_challenges from public, anon, authenticated;

comment on table public.q1_webauthn_credentials is
  'WebAuthn public key for a Quik1 borrower. Private keys stay on the device. Revoked when a new invite resets the PIN.';
comment on table public.q1_webauthn_challenges is
  'Single-use WebAuthn challenge. Consumed on register or login. Not a session.';

commit;
