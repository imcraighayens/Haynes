-- Protect the Ledger book from bulk loss.
-- Ledger Bot applies this file after review. The app does not. Do not run it
-- against production from a laptop. It revokes privileges and adds objects.
-- It does not rewrite, delete, or truncate rows, and it does not drop or
-- alter existing columns or the existing *_no_delete triggers.
--
-- 13 tables. LIVE_TABLE in ledger/ledjaa-db.js maps users, clients, loans,
-- and applications onto employees, clients, loans, and applications.
-- The other nine are the payment, audit, signup, and Quik1 application
-- tables the migrations and the ledger snapshot already use.
--   public.employees          TRUNCATE + DELETE revoked. No delete path.
--   public.clients            TRUNCATE + DELETE revoked. App soft-deletes.
--   public.loans              TRUNCATE + DELETE revoked. App soft-deletes.
--   public.applications       TRUNCATE + DELETE revoked. No delete path.
--   public.audit_log          TRUNCATE + DELETE revoked. Append-only. No row trigger.
--   public.bank_tx            TRUNCATE + DELETE revoked. Append-only payments.
--   public.petty_cash         TRUNCATE + DELETE revoked. No delete path.
--   public.expenses           TRUNCATE + DELETE revoked. App soft-deletes.
--   public.ledger_book        TRUNCATE + DELETE revoked. No delete path.
--   public.q1_signups         TRUNCATE + DELETE revoked. No delete path.
--   public.q1_requests        TRUNCATE + DELETE revoked. No delete path.
--   public.q1_repayments      TRUNCATE + DELETE revoked. No delete path.
--   quik1.applications        TRUNCATE + DELETE revoked. No delete path.
-- Revoke is from PUBLIC, anon, authenticated, service_role, and any other
-- grantee except postgres. SELECT, INSERT, and UPDATE are left as they are.
--
-- public.audit_log is the staff feed. A trigger on it is omitted so this
-- audit cannot recurse. Row images go to public.book_audit.

begin;

do $guard$
declare
  sch text;
  rel text;
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    raise exception
      'Stop. anon, authenticated, and service_role must exist before book privileges can be revoked.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception
      'Stop. % must be superuser or BYPASSRLS so the audit trigger can write public.book_audit.',
      current_user;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'service_role' and (rolsuper or rolbypassrls)
  ) then
    raise exception
      'Stop. service_role must be superuser or BYPASSRLS to read public.book_audit under forced RLS.';
  end if;

  for sch, rel in
    select t.sch, t.rel
    from (values
      ('public', 'employees'),
      ('public', 'clients'),
      ('public', 'loans'),
      ('public', 'applications'),
      ('public', 'audit_log'),
      ('public', 'bank_tx'),
      ('public', 'petty_cash'),
      ('public', 'expenses'),
      ('public', 'ledger_book'),
      ('public', 'q1_signups'),
      ('public', 'q1_requests'),
      ('public', 'q1_repayments'),
      ('quik1', 'applications')
    ) as t(sch, rel)
  loop
    if to_regclass(format('%I.%I', sch, rel)) is null then
      raise exception 'Stop. %.% does not exist. Refusing 20261111070000_book_protect.sql.', sch, rel;
    end if;
  end loop;
end
$guard$;

do $revoke$
declare
  sch text;
  rel text;
  acl_row record;
  role_name text;
begin
  for sch, rel in
    select t.sch, t.rel
    from (values
      ('public', 'employees'),
      ('public', 'clients'),
      ('public', 'loans'),
      ('public', 'applications'),
      ('public', 'audit_log'),
      ('public', 'bank_tx'),
      ('public', 'petty_cash'),
      ('public', 'expenses'),
      ('public', 'ledger_book'),
      ('public', 'q1_signups'),
      ('public', 'q1_requests'),
      ('public', 'q1_repayments'),
      ('quik1', 'applications')
    ) as t(sch, rel)
  loop
    execute format(
      'revoke truncate, delete on table %I.%I from public, anon, authenticated, service_role cascade',
      sch, rel
    );
    for acl_row in
      select (e).grantee as grantee, (e).privilege_type as privilege_type
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join lateral pg_catalog.aclexplode(c.relacl) as e
      where n.nspname = sch
        and c.relname = rel
        and (e).privilege_type in ('DELETE', 'TRUNCATE')
    loop
      if acl_row.grantee = 0 then
        execute format('revoke %s on table %I.%I from public cascade', acl_row.privilege_type, sch, rel);
        continue;
      end if;
      role_name := pg_catalog.pg_get_userbyid(acl_row.grantee);
      if role_name is null or role_name = 'postgres' then
        continue;
      end if;
      execute format(
        'revoke %s on table %I.%I from %I cascade',
        acl_row.privilege_type, sch, rel, role_name
      );
    end loop;
  end loop;
end
$revoke$;

create table if not exists public.book_audit (
  id bigserial,
  table_name text not null,
  op text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  row_id text,
  changed_at timestamptz not null default now(),
  actor text default current_user,
  old jsonb,
  new jsonb,
  constraint book_audit_pkey primary key (id)
);

create index if not exists book_audit_row_idx
  on public.book_audit (table_name, row_id, changed_at desc);

alter table public.book_audit enable row level security;
alter table public.book_audit force row level security;

revoke all on table public.book_audit from public, anon, authenticated, service_role;
grant select, insert on table public.book_audit to service_role;

do $seq$
declare
  seq_schema text;
  seq_name text;
begin
  select n.nspname, c.relname into seq_schema, seq_name
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.oid = pg_catalog.pg_get_serial_sequence('public.book_audit', 'id')::regclass;
  if seq_name is null then
    raise exception 'book protect: book_audit.id has no sequence';
  end if;
  execute format('revoke all on sequence %I.%I from public, anon, authenticated, service_role', seq_schema, seq_name);
  execute format('grant usage, select on sequence %I.%I to service_role', seq_schema, seq_name);
end
$seq$;

create schema if not exists audit;
revoke all on schema audit from public, anon, authenticated, service_role;

create or replace function audit.book_audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_id text;
  v_actor text;
begin
  if tg_op = 'INSERT' then
    v_new := pg_catalog.to_jsonb(new);
    v_old := null;
    v_id := coalesce(v_new ->> 'id', v_new ->> 'key');
  elsif tg_op = 'UPDATE' then
    v_old := pg_catalog.to_jsonb(old);
    v_new := pg_catalog.to_jsonb(new);
    v_id := coalesce(v_new ->> 'id', v_new ->> 'key', v_old ->> 'id', v_old ->> 'key');
  elsif tg_op = 'DELETE' then
    v_old := pg_catalog.to_jsonb(old);
    v_new := null;
    v_id := coalesce(v_old ->> 'id', v_old ->> 'key');
  else
    raise exception 'book_audit_row refuses %', tg_op using errcode = '42501';
  end if;

  v_actor := coalesce(
    nullif(pg_catalog.btrim(coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), ''::text)), ''::text),
    session_user::text
  );

  insert into public.book_audit (table_name, op, row_id, actor, old, new)
  values (tg_table_schema || '.' || tg_table_name, tg_op, v_id, v_actor, v_old, v_new);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function audit.book_audit_row() from public, anon, authenticated, service_role;

do $triggers$
declare
  sch text;
  rel text;
begin
  for sch, rel in
    select t.sch, t.rel
    from (values
      ('public', 'employees'),
      ('public', 'clients'),
      ('public', 'loans'),
      ('public', 'applications'),
      ('public', 'bank_tx'),
      ('public', 'petty_cash'),
      ('public', 'expenses'),
      ('public', 'ledger_book'),
      ('public', 'q1_signups'),
      ('public', 'q1_requests'),
      ('public', 'q1_repayments'),
      ('quik1', 'applications')
    ) as t(sch, rel)
  loop
    execute format('drop trigger if exists book_protect_row on %I.%I', sch, rel);
    execute format(
      'create trigger book_protect_row after insert or update or delete on %I.%I for each row execute function audit.book_audit_row()',
      sch, rel
    );
  end loop;
end
$triggers$;

comment on table public.book_audit is
  'Row images for the Ledger book. public.audit_log is not triggered. Forced RLS, no policies. postgres owns it. service_role may select and insert.';

comment on function audit.book_audit_row() is
  'Security definer trigger. search_path is empty. EXECUTE is revoked from the API roles.';

commit;
