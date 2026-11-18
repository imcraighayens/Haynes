-- Quik1 email sign-in, ID plus cellphone, and Face ID passkeys.
--
-- File only. Do not run this from the app, and do not apply it from a deploy.
-- Depends on, and must be applied after:
--   supabase/migrations/20261110120000_quik1_borrower_guard.sql
-- This file does not edit that migration. The attempt log's expires_at was
-- described there as a POPIA retention mark. Here it is a 90-day retention mark.
-- If public.q1_borrowers or the guard tables are missing, the script stops.
--
-- anon and authenticated get no grants. RLS is forced. The service role is
-- the only writer, same as q1_borrowers.

begin;

do $$
begin
  if to_regclass('public.q1_borrowers') is null
     or to_regclass('public.q1_devices') is null
     or to_regclass('public.q1_otp_challenges') is null
     or to_regclass('public.q1_auth_attempts') is null then
    raise exception
      'Stop. Apply 20261110120000_quik1_borrower_guard.sql before 20261110143000_quik1_signin.sql. A required Quik1 table does not exist.';
  end if;
end $$;

alter table public.q1_otp_challenges
  add column if not exists purpose text;

update public.q1_otp_challenges
  set purpose = 'device'
  where purpose is null;

alter table public.q1_otp_challenges
  alter column purpose set default 'device';

alter table public.q1_otp_challenges
  alter column purpose set not null;

alter table public.q1_otp_challenges
  drop constraint if exists q1_otp_purpose;

alter table public.q1_otp_challenges
  add constraint q1_otp_purpose
  check (purpose in ('device', 'signin'));

alter table public.q1_auth_attempts
  add column if not exists subject_hash text;

alter table public.q1_auth_attempts
  drop constraint if exists q1_auth_attempts_subject_hex;

alter table public.q1_auth_attempts
  add constraint q1_auth_attempts_subject_hex
  check (subject_hash is null or subject_hash ~ '^[0-9a-f]{64}$');

alter table public.q1_auth_attempts
  drop constraint if exists q1_auth_attempts_kind;

alter table public.q1_auth_attempts
  add constraint q1_auth_attempts_kind
  check (kind in ('pin', 'email', 'id_phone', 'passkey'));

create index if not exists q1_auth_attempts_subject_created_idx
  on public.q1_auth_attempts (subject_hash, kind, created_at desc)
  where subject_hash is not null;

comment on table public.q1_auth_attempts is
  'Sign-in attempts. ip_hash is not a raw address. expires_at is the 90-day retention mark. Purge with q1_purge_auth_attempts().';

create table if not exists public.q1_webauthn_credentials (
  id text primary key,
  borrower_id text not null references public.q1_borrowers (id),
  public_key text not null,
  sign_count bigint not null default 0,
  device_id text references public.q1_devices (id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint q1_webauthn_credential_id check (id ~ '^[A-Za-z0-9_-]{16,256}$'),
  constraint q1_webauthn_public_key check (char_length(public_key) between 16 and 4000),
  constraint q1_webauthn_sign_count check (sign_count >= 0)
);

alter table public.q1_webauthn_credentials
  add column if not exists device_id text;

create table if not exists public.q1_webauthn_challenges (
  id text primary key,
  borrower_id text not null references public.q1_borrowers (id),
  purpose text not null,
  challenge_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint q1_webauthn_purpose check (purpose in ('register', 'login')),
  constraint q1_webauthn_challenge_hash check (challenge_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists q1_webauthn_credentials_borrower_idx
  on public.q1_webauthn_credentials (borrower_id);

-- One open challenge per borrower and purpose. A new challenge retires the previous one first.
create unique index if not exists q1_webauthn_one_open
  on public.q1_webauthn_challenges (borrower_id, purpose)
  where consumed_at is null;

alter table public.q1_webauthn_credentials enable row level security;
alter table public.q1_webauthn_challenges enable row level security;

alter table public.q1_webauthn_credentials force row level security;
alter table public.q1_webauthn_challenges force row level security;

revoke all on table public.q1_webauthn_credentials from public, anon, authenticated;
revoke all on table public.q1_webauthn_challenges from public, anon, authenticated;

comment on table public.q1_webauthn_credentials is
  'WebAuthn public key for a Quik1 borrower. Private keys stay on the device. device_id links the key to a recognised phone. Staff reset-device sets revoked_at. The PIN is not changed.';

comment on table public.q1_webauthn_challenges is
  'Single-use WebAuthn challenge. challenge_hash is SHA-256 of the challenge. The challenge is not stored. Consumed on register or login. Not a session.';

commit;
