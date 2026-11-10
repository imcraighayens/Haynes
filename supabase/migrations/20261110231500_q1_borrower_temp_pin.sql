-- apply only after review approval
-- Quik1 temporary borrower PIN. Ledger Bot applies this file. The app does not.
--
-- Depends on, and must be applied after:
--   1. supabase/migrations/20261105_quik1_borrower_auth.sql
--   2. supabase/migrations/20261110120000_quik1_borrower_guard.sql
-- Scoped to q1_* objects. Idempotent. No other tables are changed.
--
-- temp_pin_hash is a scrypt hash of a staff-set PIN. The PIN is not stored.
-- It is cleared when the borrower signs in with it. temp_pin_spent_hash keeps
-- that hash only so the replacement PIN can be refused when it is the same one.
-- pin_change_hash is SHA-256 of a 10-minute HttpOnly token, not a session.
-- q1_temp_pin_sets counts staff sets. It has no PIN column.

begin;

do $$
begin
  if to_regclass('public.q1_borrowers') is null then
    raise exception
      'Stop. Apply 20261105_quik1_borrower_auth.sql and 20261110120000_quik1_borrower_guard.sql before 20261110231500_q1_borrower_temp_pin.sql. public.q1_borrowers does not exist.';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'q1_borrowers'
      and column_name = 'device_reset_until'
  ) then
    raise exception
      'Stop. Apply 20261110120000_quik1_borrower_guard.sql before 20261110231500_q1_borrower_temp_pin.sql. public.q1_borrowers.device_reset_until does not exist.';
  end if;
end $$;

alter table public.q1_borrowers
  add column if not exists temp_pin_hash text;

alter table public.q1_borrowers
  add column if not exists temp_pin_expires_at timestamptz;

alter table public.q1_borrowers
  add column if not exists temp_pin_spent_hash text;

alter table public.q1_borrowers
  add column if not exists pin_change_hash text;

alter table public.q1_borrowers
  add column if not exists pin_change_expires_at timestamptz;

alter table public.q1_borrowers
  drop constraint if exists q1_borrowers_temp_pin_hash_len;

alter table public.q1_borrowers
  add constraint q1_borrowers_temp_pin_hash_len
  check (temp_pin_hash is null or char_length(temp_pin_hash) between 4 and 200);

alter table public.q1_borrowers
  drop constraint if exists q1_borrowers_temp_pin_spent_len;

alter table public.q1_borrowers
  add constraint q1_borrowers_temp_pin_spent_len
  check (temp_pin_spent_hash is null or char_length(temp_pin_spent_hash) between 4 and 200);

alter table public.q1_borrowers
  drop constraint if exists q1_borrowers_pin_change_hash_hex;

alter table public.q1_borrowers
  add constraint q1_borrowers_pin_change_hash_hex
  check (pin_change_hash is null or pin_change_hash ~ '^[0-9a-f]{64}$');

create index if not exists q1_borrowers_pin_change_hash_idx
  on public.q1_borrowers (pin_change_hash)
  where pin_change_hash is not null;

comment on column public.q1_borrowers.temp_pin_hash is
  'Scrypt hash of a staff-set temporary PIN. Null once the borrower has used it. The PIN is not stored.';
comment on column public.q1_borrowers.temp_pin_expires_at is
  'When temp_pin_hash stops being accepted. Set to 72 hours from the staff action.';
comment on column public.q1_borrowers.temp_pin_spent_hash is
  'Hash of the temporary PIN after it was consumed, kept only to reject the same digits as the new PIN.';
comment on column public.q1_borrowers.pin_change_hash is
  'SHA-256 of the single-purpose pin-change token. Not a session and not a PIN.';
comment on column public.q1_borrowers.pin_change_expires_at is
  'When the pin-change token stops working. About 10 minutes after the temporary PIN is accepted.';

create table if not exists public.q1_temp_pin_sets (
  id text primary key,
  client_id text not null,
  actor text not null,
  unlocked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint q1_temp_pin_sets_client_len check (char_length(client_id) between 1 and 80),
  constraint q1_temp_pin_sets_actor_len check (char_length(actor) between 1 and 120)
);

alter table public.q1_temp_pin_sets
  add column if not exists unlocked boolean not null default false;

create index if not exists q1_temp_pin_sets_actor_created_idx
  on public.q1_temp_pin_sets (actor, created_at desc);

create index if not exists q1_temp_pin_sets_client_created_idx
  on public.q1_temp_pin_sets (client_id, created_at desc);

alter table public.q1_temp_pin_sets enable row level security;
alter table public.q1_temp_pin_sets force row level security;
revoke all on table public.q1_temp_pin_sets from public, anon, authenticated;

comment on table public.q1_temp_pin_sets is
  'Staff temporary-PIN sets, for the per-staff and per-client limit. No PIN and no hash.';
comment on column public.q1_temp_pin_sets.unlocked is
  'True only when this set cleared a failed-attempt lockout. Never a PIN or a hash.';

commit;
