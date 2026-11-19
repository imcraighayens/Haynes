-- apply only after #37 review approval; backfill needs QUIK1_ID_HMAC_KEY
--
-- Adds only public.clients.id_hmac and public.clients.phone_hmac, their
-- hex checks, and one partial unique index. Safe to re-run. Nothing else
-- on clients is changed. No key and no backfill in this file.
--
-- scripts/backfill-client-hmac.js fills existing rows. It is dry-run unless
-- --commit is passed, and it refuses to run without QUIK1_ID_HMAC_KEY.
-- Do not run this from the app.

begin;

alter table public.clients
  add column if not exists id_hmac text;

alter table public.clients
  add column if not exists phone_hmac text;

alter table public.clients
  drop constraint if exists clients_id_hmac_hex;

alter table public.clients
  add constraint clients_id_hmac_hex
  check (id_hmac is null or id_hmac ~ '^[0-9a-f]{64}$');

alter table public.clients
  drop constraint if exists clients_phone_hmac_hex;

alter table public.clients
  add constraint clients_phone_hmac_hex
  check (phone_hmac is null or phone_hmac ~ '^[0-9a-f]{64}$');

create unique index if not exists clients_id_phone_hmac_uidx
  on public.clients (id_hmac, phone_hmac)
  where id_hmac is not null and phone_hmac is not null and deleted_at is null;

comment on column public.clients.id_hmac is
  'HMAC-SHA256 of an SA ID under QUIK1_ID_HMAC_KEY. Not an unsalted hash.';

comment on column public.clients.phone_hmac is
  'HMAC-SHA256 of a normalised cellphone under QUIK1_ID_HMAC_KEY, prefixed so it cannot collide with an ID HMAC.';

commit;
