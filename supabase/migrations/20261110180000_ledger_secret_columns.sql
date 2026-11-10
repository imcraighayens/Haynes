-- Ledger ID numbers and bank account numbers: columns only.
--
-- Adds ciphertext, HMAC and last-4 mask columns. It does not encrypt, copy,
-- or clear any existing plaintext. That needs QUIK1_ID_KEY and QUIK1_BANK_KEY,
-- which do not belong in SQL. Run scripts/backfill-ledger-secrets.js after
-- this file, dry-run first. The order is in DEPLOY.md.
--
-- Apply once in the Supabase SQL editor. Do not run it from the app.
-- Safe to run twice. public.clients and public.applications must already exist.
-- quik1.applications and loop.applications are altered only when they exist.
-- No grants are added. Existing row security is left as it is.

begin;

do $$
begin
  if to_regclass('public.clients') is null then
    raise exception
      'Stop. public.clients does not exist, so ledger secret columns cannot be added.';
  end if;
  if to_regclass('public.applications') is null then
    raise exception
      'Stop. public.applications does not exist. Apply the ledger bridge before this file.';
  end if;
end $$;

-- public.clients: SA ID and the debit-order account number.
alter table public.clients add column if not exists id_ciphertext text;
alter table public.clients add column if not exists id_hmac text;
alter table public.clients add column if not exists id_last4 text;
alter table public.clients add column if not exists account_ciphertext text;
alter table public.clients add column if not exists account_hmac text;
alter table public.clients add column if not exists account_last4 text;

alter table public.clients drop constraint if exists clients_id_ciphertext_fmt;
alter table public.clients add constraint clients_id_ciphertext_fmt
  check (id_ciphertext is null or (char_length(id_ciphertext) between 20 and 500 and id_ciphertext like 'v%.%'));
alter table public.clients drop constraint if exists clients_id_hmac_hex;
alter table public.clients add constraint clients_id_hmac_hex
  check (id_hmac is null or id_hmac ~ '^[0-9a-f]{64}$');
alter table public.clients drop constraint if exists clients_id_last4_fmt;
alter table public.clients add constraint clients_id_last4_fmt
  check (id_last4 is null or id_last4 ~ '^[0-9]{4}$');
alter table public.clients drop constraint if exists clients_account_ciphertext_fmt;
alter table public.clients add constraint clients_account_ciphertext_fmt
  check (account_ciphertext is null or (char_length(account_ciphertext) between 20 and 500 and account_ciphertext like 'v%.%'));
alter table public.clients drop constraint if exists clients_account_hmac_hex;
alter table public.clients add constraint clients_account_hmac_hex
  check (account_hmac is null or account_hmac ~ '^[0-9a-f]{64}$');
alter table public.clients drop constraint if exists clients_account_last4_fmt;
alter table public.clients add constraint clients_account_last4_fmt
  check (account_last4 is null or account_last4 ~ '^[0-9]{4}$');

create unique index if not exists clients_id_hmac_uidx
  on public.clients (id_hmac)
  where id_hmac is not null;
create index if not exists clients_id_number_pending_idx
  on public.clients (id)
  where id_number is not null;
create index if not exists clients_account_no_pending_idx
  on public.clients (id)
  where account_no is not null;

comment on column public.clients.id_ciphertext is
  'Versioned AES-256-GCM of id_number, bound to this client. The key is not stored here. Plaintext stays until the node backfill clears it.';
comment on column public.clients.id_hmac is
  'HMAC-SHA256 of a valid SA ID under QUIK1_ID_HMAC_KEY. Duplicate clients are rejected. Not an unsalted hash.';
comment on column public.clients.id_last4 is
  'Last four digits of the ID. Safe to show. Not enough to reconstruct the ID.';
comment on column public.clients.account_ciphertext is
  'Versioned AES-256-GCM of account_no under QUIK1_BANK_KEY, bound to this client.';
comment on column public.clients.account_hmac is
  'HMAC-SHA256 of the account digits under QUIK1_BANK_HMAC_KEY. Not unique: the same account may be named twice.';
comment on column public.clients.account_last4 is
  'Last four digits of the account number.';

-- public.applications: older application rows. The same person may apply more
-- than once, so id_hmac is not unique here.
alter table public.applications add column if not exists id_ciphertext text;
alter table public.applications add column if not exists id_hmac text;
alter table public.applications add column if not exists id_last4 text;

alter table public.applications drop constraint if exists applications_id_ciphertext_fmt;
alter table public.applications add constraint applications_id_ciphertext_fmt
  check (id_ciphertext is null or (char_length(id_ciphertext) between 20 and 500 and id_ciphertext like 'v%.%'));
alter table public.applications drop constraint if exists applications_id_hmac_hex;
alter table public.applications add constraint applications_id_hmac_hex
  check (id_hmac is null or id_hmac ~ '^[0-9a-f]{64}$');
alter table public.applications drop constraint if exists applications_id_last4_fmt;
alter table public.applications add constraint applications_id_last4_fmt
  check (id_last4 is null or id_last4 ~ '^[0-9]{4}$');

create index if not exists applications_id_number_pending_idx
  on public.applications (id)
  where id_number is not null;

comment on column public.applications.id_ciphertext is
  'Versioned AES-256-GCM of id_number, bound to this application row.';
comment on column public.applications.id_hmac is
  'HMAC-SHA256 of a valid SA ID under QUIK1_ID_HMAC_KEY. Not unique on this table.';
comment on column public.applications.id_last4 is
  'Last four digits of the application ID number.';

-- Sign-ups no longer accept an ID. Leftover plaintext is still sealed by the backfill.
do $$
begin
  if to_regclass('public.q1_signups') is null then
    raise exception
      'Stop. public.q1_signups does not exist. Apply 20261029_quik1_bridge.sql before this file.';
  end if;
end $$;

alter table public.q1_signups add column if not exists id_ciphertext text;
alter table public.q1_signups add column if not exists id_hmac text;
alter table public.q1_signups add column if not exists id_last4 text;

alter table public.q1_signups drop constraint if exists q1_signups_id_ciphertext_fmt;
alter table public.q1_signups add constraint q1_signups_id_ciphertext_fmt
  check (id_ciphertext is null or (char_length(id_ciphertext) between 20 and 500 and id_ciphertext like 'v%.%'));
alter table public.q1_signups drop constraint if exists q1_signups_id_hmac_hex;
alter table public.q1_signups add constraint q1_signups_id_hmac_hex
  check (id_hmac is null or id_hmac ~ '^[0-9a-f]{64}$');
alter table public.q1_signups drop constraint if exists q1_signups_id_last4_fmt;
alter table public.q1_signups add constraint q1_signups_id_last4_fmt
  check (id_last4 is null or id_last4 ~ '^[0-9]{4}$');

create index if not exists q1_signups_id_number_pending_idx
  on public.q1_signups (id)
  where id_number is not null;

comment on column public.q1_signups.id_ciphertext is
  'Versioned AES-256-GCM of a legacy signup ID, bound to this signup. New signups do not store an ID.';
comment on column public.q1_signups.id_hmac is
  'HMAC-SHA256 of a valid SA ID under QUIK1_ID_HMAC_KEY.';
comment on column public.q1_signups.id_last4 is
  'Last four digits of a legacy signup ID.';

-- quik1.applications and loop.applications keep a plaintext ID and account
-- number, and bank_last4 is generated from that account. A generated column
-- cannot survive clearing the account, so it becomes an ordinary mask column.
-- This block does not read or copy the account number. The node backfill
-- fills the mask and then nulls the plaintext.
do $$
declare
  sch text;
begin
  foreach sch in array array['quik1', 'loop']
  loop
    if to_regclass(sch || '.applications') is null then
      continue;
    end if;

    if exists (
      select 1
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = sch
        and c.relname = 'applications'
        and a.attname = 'bank_last4'
        and a.attgenerated <> ''
        and not a.attisdropped
    ) then
      execute format('alter table %I.applications drop column bank_last4', sch);
    end if;

    if not exists (
      select 1
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = sch
        and c.relname = 'applications'
        and a.attname = 'bank_last4'
        and not a.attisdropped
    ) then
      execute format('alter table %I.applications add column bank_last4 text', sch);
    end if;

    execute format('alter table %I.applications alter column id_number drop not null', sch);
    execute format('alter table %I.applications alter column bank_account_no drop not null', sch);

    execute format('alter table %I.applications add column if not exists id_ciphertext text', sch);
    execute format('alter table %I.applications add column if not exists id_hmac text', sch);
    execute format('alter table %I.applications add column if not exists id_last4 text', sch);
    execute format('alter table %I.applications add column if not exists bank_account_ciphertext text', sch);
    execute format('alter table %I.applications add column if not exists bank_account_hmac text', sch);

    execute format('alter table %I.applications drop constraint if exists applications_id_ciphertext_fmt', sch);
    execute format($f$
      alter table %I.applications add constraint applications_id_ciphertext_fmt
      check (id_ciphertext is null or (char_length(id_ciphertext) between 20 and 500 and id_ciphertext like 'v%%.%%'))
    $f$, sch);
    execute format('alter table %I.applications drop constraint if exists applications_id_hmac_hex', sch);
    execute format($f$
      alter table %I.applications add constraint applications_id_hmac_hex
      check (id_hmac is null or id_hmac ~ '^[0-9a-f]{64}$')
    $f$, sch);
    execute format('alter table %I.applications drop constraint if exists applications_id_last4_fmt', sch);
    execute format($f$
      alter table %I.applications add constraint applications_id_last4_fmt
      check (id_last4 is null or id_last4 ~ '^[0-9]{4}$')
    $f$, sch);
    execute format('alter table %I.applications drop constraint if exists applications_bank_account_ciphertext_fmt', sch);
    execute format($f$
      alter table %I.applications add constraint applications_bank_account_ciphertext_fmt
      check (bank_account_ciphertext is null or (char_length(bank_account_ciphertext) between 20 and 500 and bank_account_ciphertext like 'v%%.%%'))
    $f$, sch);
    execute format('alter table %I.applications drop constraint if exists applications_bank_account_hmac_hex', sch);
    execute format($f$
      alter table %I.applications add constraint applications_bank_account_hmac_hex
      check (bank_account_hmac is null or bank_account_hmac ~ '^[0-9a-f]{64}$')
    $f$, sch);
    execute format('alter table %I.applications drop constraint if exists applications_bank_last4_fmt', sch);
    execute format($f$
      alter table %I.applications add constraint applications_bank_last4_fmt
      check (bank_last4 is null or bank_last4 ~ '^[0-9]{4}$')
    $f$, sch);
  end loop;
end $$;

commit;
