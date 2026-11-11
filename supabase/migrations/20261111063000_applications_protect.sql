-- Protect public.applications and quik1.applications from bulk loss.
-- Ledger Bot applies this file after review. The app does not. Do not run it
-- from a laptop against production, and do not point it at a live connection
-- from CI. It changes privileges and adds objects. It does not rewrite,
-- delete, or truncate application rows, and it does not drop or alter
-- existing columns.
--
-- public.audit_log is the staff activity feed (id, at, type, ref, customer,
-- amount, by, comment) returned by GET /api/ledger/state. It has no old/new
-- images. Writing application rows into it would publish Quik1 ID numbers and
-- bank details into that feed and would mean altering an existing table.
-- Row history goes to a new public.applications_audit instead.
--
-- DELETE and TRUNCATE are revoked from every grantee except postgres and the
-- table owner. No path in ledger/, quik1/, api/, or scripts/ deletes either
-- table. The service-role client has no remove() method. TRUNCATE is revoked
-- as well because a row trigger does not see it.
--
-- The audit table forces RLS and has no policies. anon and authenticated have
-- no grants. postgres and service_role are the only readers the grants allow,
-- and both need BYPASSRLS (true on Supabase) because forced RLS with no
-- policy would otherwise hide every row, including from the table owner.
-- The trigger function is security definer so a writer who cannot see the
-- audit table can still leave a row. It lives in schema audit, which is not
-- exposed to the Data API. search_path is empty. EXECUTE is revoked from the
-- API roles; the trigger fires without it.

begin;

do $guard$
begin
  if to_regclass('public.applications') is null then
    raise exception
      'Stop. public.applications does not exist. Refusing to apply 20261111063000_applications_protect.sql.';
  end if;
  if to_regclass('quik1.applications') is null then
    raise exception
      'Stop. Apply 20261107111340_quik1_applications.sql before 20261111063000_applications_protect.sql. quik1.applications does not exist.';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    raise exception
      'Stop. anon, authenticated, and service_role must exist before application privileges can be revoked.';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = current_user
      and (rolsuper or rolbypassrls)
  ) then
    raise exception
      'Stop. % must be superuser or BYPASSRLS. The audit table forces RLS with no policies, and the trigger function runs as its owner.',
      current_user;
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
      and (rolsuper or rolbypassrls)
  ) then
    raise exception
      'Stop. service_role must be superuser or BYPASSRLS so it can read public.applications_audit under forced RLS with no policies.';
  end if;
end
$guard$;

do $revoke$
declare
  sch text;
  rel text;
  owner_oid oid;
  owner_name text;
  acl_row record;
  role_name text;
begin
  raise notice 'applications protect: DELETE and TRUNCATE stay with postgres and with each table owner';

  for sch, rel in
    select t.sch, t.rel
    from (values ('public', 'applications'), ('quik1', 'applications')) as t(sch, rel)
  loop
    select c.relowner, o.rolname
      into owner_oid, owner_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_roles o on o.oid = c.relowner
    where n.nspname = sch
      and c.relname = rel;

    if owner_oid is null then
      raise exception 'applications protect: %.% disappeared during revoke', sch, rel;
    end if;

    execute format(
      'revoke truncate, delete on table %I.%I from public, anon, authenticated, service_role cascade',
      sch, rel
    );
    raise notice 'applications protect: revoked DELETE, TRUNCATE on %.% from public, anon, authenticated, service_role', sch, rel;

    for acl_row in
      select (e).grantee as grantee, (e).privilege_type as privilege_type
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join lateral pg_catalog.aclexplode(c.relacl) as e
      where n.nspname = sch
        and c.relname = rel
        and (e).privilege_type in ('DELETE', 'TRUNCATE')
    loop
      if acl_row.privilege_type not in ('DELETE', 'TRUNCATE') then
        continue;
      end if;
      if acl_row.grantee = owner_oid then
        continue;
      end if;
      if acl_row.grantee = 0 then
        execute format(
          'revoke %s on table %I.%I from public cascade',
          acl_row.privilege_type, sch, rel
        );
        raise notice 'applications protect: revoked % on %.% from public', acl_row.privilege_type, sch, rel;
        continue;
      end if;

      role_name := pg_catalog.pg_get_userbyid(acl_row.grantee);
      if role_name is null or role_name = 'postgres' or role_name = owner_name then
        continue;
      end if;

      execute format(
        'revoke %s on table %I.%I from %I cascade',
        acl_row.privilege_type, sch, rel, role_name
      );
      raise notice 'applications protect: revoked % on %.% from %', acl_row.privilege_type, sch, rel, role_name;
    end loop;
  end loop;
end
$revoke$;

create table if not exists public.applications_audit (
  id bigserial,
  table_name text not null,
  op text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  row_id text,
  changed_at timestamptz not null default now(),
  actor text default current_user,
  old jsonb,
  new jsonb,
  constraint applications_audit_pkey primary key (id)
);

create index if not exists applications_audit_row_idx
  on public.applications_audit (table_name, row_id, changed_at desc);

alter table public.applications_audit enable row level security;
alter table public.applications_audit force row level security;

revoke all on table public.applications_audit from public, anon, authenticated, service_role;
grant select, insert on table public.applications_audit to service_role;

do $seq$
declare
  seq_schema text;
  seq_name text;
begin
  select n.nspname, c.relname
    into seq_schema, seq_name
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.oid = pg_catalog.pg_get_serial_sequence('public.applications_audit', 'id')::regclass;

  if seq_name is null then
    raise exception 'applications protect: applications_audit.id has no sequence';
  end if;

  execute format(
    'revoke all on sequence %I.%I from public, anon, authenticated, service_role',
    seq_schema, seq_name
  );
  execute format(
    'grant usage, select on sequence %I.%I to service_role',
    seq_schema, seq_name
  );
end
$seq$;

create schema if not exists audit;
revoke all on schema audit from public, anon, authenticated, service_role;

create or replace function audit.applications_audit_row()
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
  -- current_user inside this function is the owner, because it is security
  -- definer. PostgREST's role is the JWT claim; a SQL session's role is
  -- session_user. The column default stays current_user for a direct insert
  -- that omits actor.
  if tg_op = 'INSERT' then
    v_new := pg_catalog.to_jsonb(new);
    v_old := null;
    v_id := v_new ->> 'id';
  elsif tg_op = 'UPDATE' then
    v_old := pg_catalog.to_jsonb(old);
    v_new := pg_catalog.to_jsonb(new);
    v_id := coalesce(v_new ->> 'id', v_old ->> 'id');
  elsif tg_op = 'DELETE' then
    v_old := pg_catalog.to_jsonb(old);
    v_new := null;
    v_id := v_old ->> 'id';
  else
    raise exception 'applications_audit_row refuses %', tg_op
      using errcode = '42501';
  end if;

  -- coalesce and nullif are SQL expressions, not pg_catalog functions.
  -- current_user here would be the function owner, so it is not the actor.
  v_actor := coalesce(
    nullif(pg_catalog.btrim(coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), ''::text)), ''::text),
    session_user::text
  );

  insert into public.applications_audit (table_name, op, row_id, actor, old, new)
  values (tg_table_schema || '.' || tg_table_name, tg_op, v_id, v_actor, v_old, v_new);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function audit.applications_audit_row() from public, anon, authenticated, service_role;

drop trigger if exists applications_protect_row on public.applications;
create trigger applications_protect_row
  after insert or update or delete
  on public.applications
  for each row
  execute function audit.applications_audit_row();

drop trigger if exists applications_protect_row on quik1.applications;
create trigger applications_protect_row
  after insert or update or delete
  on quik1.applications
  for each row
  execute function audit.applications_audit_row();

comment on table public.applications_audit is
  'Row images for public.applications and quik1.applications. Forced RLS, no policies. Grants: postgres (owner) and service_role (select, insert).';

comment on function audit.applications_audit_row() is
  'Security definer audit trigger in an unexposed schema. search_path is empty. EXECUTE is revoked from the API roles.';

commit;
