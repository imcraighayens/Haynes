-- Quik1 devices, new-device checks, attempt log, and encrypted SA ID.
--
-- Depends on, and must be applied after:
--   1. supabase/migrations/20261105_quik1_borrower_auth.sql
--      (public.q1_borrowers, public.q1_invites, public.q1_sessions)
--   2. supabase/migrations/20261106_quik1_borrower_app.sql
--      (support messages and the private document bucket; not referenced here,
--      but it belongs in the borrower sequence before this file)
-- This file does not recreate those tables. Do not run it from the app.
-- If public.q1_borrowers is missing, the script stops with a clear error.
--
-- id_ciphertext is AES-256-GCM, versioned (v1.<iv>.<tag>.<body>, later v2…).
-- id_hmac is HMAC-SHA256 under a separate key. The ID itself is not stored.
-- Email link tokens are stored only as hashes.
-- q1_auth_attempts.expires_at is the POPIA retention mark (90 days).
-- Purge from the SQL editor, as the table owner:
--   select public.q1_purge_auth_attempts();
-- The app does not call that function.

begin;

do $$
begin
  if to_regclass('public.q1_borrowers') is null then
    raise exception
      'Stop. Apply 20261105_quik1_borrower_auth.sql (and then 20261106_quik1_borrower_app.sql) before 20261110120000_quik1_borrower_guard.sql. public.q1_borrowers does not exist.';
  end if;
end $$;

alter table public.q1_borrowers
  add column if not exists id_ciphertext text;

alter table public.q1_borrowers
  add column if not exists id_hmac text;

alter table public.q1_borrowers
  drop constraint if exists q1_borrowers_id_ciphertext_fmt;

alter table public.q1_borrowers
  add constraint q1_borrowers_id_ciphertext_fmt
  check (
    id_ciphertext is null
    or (char_length(id_ciphertext) between 20 and 500 and id_ciphertext like 'v%.%')
  );

alter table public.q1_borrowers
  drop constraint if exists q1_borrowers_id_hmac_hex;

alter table public.q1_borrowers
  add constraint q1_borrowers_id_hmac_hex
  check (id_hmac is null or id_hmac ~ '^[0-9a-f]{64}$');

create unique index if not exists q1_borrowers_id_hmac_uidx
  on public.q1_borrowers (id_hmac)
  where id_hmac is not null;

revoke all on table public.q1_borrowers from public, anon, authenticated;

create table if not exists public.q1_devices (
  id text primary key,
  borrower_id text not null references public.q1_borrowers (id),
  token_hash text not null unique,
  last_seen_at timestamptz,
  expires_at timestamptz not null default (now() + interval '90 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint q1_devices_token_hash_hex check (token_hash ~ '^[0-9a-f]{64}$')
);

alter table public.q1_devices
  add column if not exists expires_at timestamptz;

update public.q1_devices
  set expires_at = created_at + interval '90 days'
  where expires_at is null;

alter table public.q1_devices
  alter column expires_at set default (now() + interval '90 days');

alter table public.q1_devices
  alter column expires_at set not null;

create index if not exists q1_devices_borrower_idx
  on public.q1_devices (borrower_id);

create table if not exists public.q1_otp_challenges (
  id text primary key,
  borrower_id text not null references public.q1_borrowers (id),
  channel text not null default 'email',
  token_hash text not null,
  device_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint q1_otp_channel check (channel = 'email'),
  constraint q1_otp_token_hash_hex check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint q1_otp_device_hash_hex check (device_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists q1_otp_borrower_idx
  on public.q1_otp_challenges (borrower_id, created_at desc);

-- One outstanding email link per borrower. now() cannot appear in an index
-- predicate, so expiry is enforced by the app and by consumed_at.
create unique index if not exists q1_otp_one_open
  on public.q1_otp_challenges (borrower_id)
  where consumed_at is null;

create table if not exists public.q1_auth_attempts (
  id text primary key,
  borrower_id text,
  kind text not null,
  ip_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  constraint q1_auth_attempts_kind check (kind = 'pin'),
  constraint q1_auth_attempts_ip_hash_hex check (ip_hash ~ '^[0-9a-f]{64}$')
);

alter table public.q1_auth_attempts
  add column if not exists expires_at timestamptz;

update public.q1_auth_attempts
  set expires_at = created_at + interval '90 days'
  where expires_at is null;

alter table public.q1_auth_attempts
  alter column expires_at set default (now() + interval '90 days');

alter table public.q1_auth_attempts
  alter column expires_at set not null;

create index if not exists q1_auth_attempts_ip_created_idx
  on public.q1_auth_attempts (ip_hash, created_at desc);

create index if not exists q1_auth_attempts_borrower_created_idx
  on public.q1_auth_attempts (borrower_id, created_at desc);

create index if not exists q1_auth_attempts_expires_idx
  on public.q1_auth_attempts (expires_at);

alter table public.q1_devices enable row level security;
alter table public.q1_otp_challenges enable row level security;
alter table public.q1_auth_attempts enable row level security;

alter table public.q1_devices force row level security;
alter table public.q1_otp_challenges force row level security;
alter table public.q1_auth_attempts force row level security;

revoke all on table public.q1_devices from public, anon, authenticated;
revoke all on table public.q1_otp_challenges from public, anon, authenticated;
revoke all on table public.q1_auth_attempts from public, anon, authenticated;

create or replace function public.q1_purge_auth_attempts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.q1_auth_attempts where expires_at < now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.q1_purge_auth_attempts() from public, anon, authenticated;

comment on column public.q1_borrowers.id_ciphertext is
  'Versioned AES-256-GCM ciphertext of an SA ID, bound to this borrower. The key is not stored here.';
comment on column public.q1_borrowers.id_hmac is
  'HMAC-SHA256 of the SA ID under QUIK1_ID_HMAC_KEY. Used to reject a duplicate. Not an unsalted hash.';
comment on table public.q1_devices is
  'Recognised Quik1 device. token_hash is SHA-256 of the httpOnly cookie. expires_at is the server TTL. The token is not stored.';
comment on table public.q1_otp_challenges is
  'One outstanding email link for a new device. token_hash is SHA-256 of the link token. The token is not stored.';
comment on table public.q1_auth_attempts is
  'Failed PIN attempts. ip_hash is not a raw address. expires_at is the retention mark. Purge with q1_purge_auth_attempts().';

commit;
