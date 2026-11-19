-- Recorded from ledger-ecoloans migration 20261107165938 (quik1_ai), applied 2026-11-07.
-- Statement body is the one stored in supabase_migrations.schema_migrations.
-- It redefines public.quik1_submit_application and grants anon EXECUTE again.
-- That grant is closed by 20261109163000_revoke_quik1_anon_execute.sql.
-- quik1-ai edge function source is not in this repo. supabase/config.toml sets verify_jwt = true.
-- Already applied on production. Do not run this file again there: doing so re-opens anon.

-- Quik1 · AI document checks + Q1 chat throttle (source: loopcredit/app/db/002_quik1_ai.sql)
-- Touches only schema quik1 and public.quik1_* functions. AI output is advisory; a human assessor decides (NCA s81, POPIA s71).

create table if not exists quik1.doc_assessments (
  id                 uuid primary key default extensions.gen_random_uuid(),
  kind               text not null check (kind in ('bank_statement','payslip','id_document')),
  file_name          text not null default '' check (char_length(file_name) <= 120),
  file_sha256        text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  result             jsonb not null
                       check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 8000),
  model              text check (model is null or char_length(model) <= 80),
  source             text not null default 'server' check (source = 'server'),
  key_hash           text check (key_hash is null or key_hash ~ '^[0-9a-f]{64}$'),
  client_request_id  uuid not null unique,
  application_id     uuid references quik1.applications(id) on delete cascade,
  created_at         timestamptz not null default now()
);
alter table quik1.doc_assessments add column if not exists compared_with jsonb;
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conname = 'quik1_doc_assessments_compared_with_chk'
                    and conrelid = 'quik1.doc_assessments'::regclass) then
    alter table quik1.doc_assessments
      add constraint quik1_doc_assessments_compared_with_chk
      check (compared_with is null
             or (jsonb_typeof(compared_with) = 'object' and octet_length(compared_with::text) <= 400));
  end if;
end;
$$;
create index if not exists quik1_doc_assessments_key_created_idx on quik1.doc_assessments (key_hash, created_at);
create index if not exists quik1_doc_assessments_app_idx         on quik1.doc_assessments (application_id) where application_id is not null;
create index if not exists quik1_doc_assessments_unlinked_idx    on quik1.doc_assessments (created_at) where application_id is null;

create table if not exists quik1.ai_calls (
  id          bigint generated always as identity primary key,
  key_hash    text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  kind        text not null check (kind in ('chat','assess')),
  created_at  timestamptz not null default now()
);
create index if not exists quik1_ai_calls_key_kind_created_idx on quik1.ai_calls (key_hash, kind, created_at);
create index if not exists quik1_ai_calls_kind_created_idx     on quik1.ai_calls (kind, created_at);
create index if not exists quik1_ai_calls_created_idx          on quik1.ai_calls (created_at);

alter table quik1.doc_assessments enable row level security;
alter table quik1.ai_calls        enable row level security;
revoke all on all tables    in schema quik1 from public, anon, authenticated;
revoke all on all sequences in schema quik1 from public, anon, authenticated;

alter table quik1.applications add column if not exists doc_assessments_client jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conname = 'quik1_applications_doc_assessments_client_chk'
                    and conrelid = 'quik1.applications'::regclass) then
    alter table quik1.applications
      add constraint quik1_applications_doc_assessments_client_chk
      check (case when jsonb_typeof(doc_assessments_client) = 'array'
                  then jsonb_array_length(doc_assessments_client) <= 6
                       and octet_length(doc_assessments_client::text) <= 16000
                  else false end);
  end if;
end;
$$;

create or replace function public.quik1_ai_gate(p_key text, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent int;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' or p_kind is null or p_kind not in ('chat','assess') then
    return false;
  end if;
  if p_kind = 'assess' then
    perform pg_advisory_xact_lock(hashtextextended('quik1_ai_gate:assess', 0));
  else
    perform pg_advisory_xact_lock(hashtextextended('quik1_ai_gate:chat_all', 0));
  end if;
  delete from quik1.ai_calls where created_at < now() - interval '1 day';
  delete from quik1.doc_assessments where application_id is null and created_at < now() - interval '48 hours';
  if p_kind = 'chat' then
    select count(*) into v_recent from quik1.ai_calls
     where kind = 'chat' and created_at > now() - interval '10 minutes';
    if v_recent >= 600 then
      return false;
    end if;
    select count(*) into v_recent from quik1.ai_calls
     where key_hash = p_key and kind = 'chat' and created_at > now() - interval '10 minutes';
    if v_recent >= 30 then
      return false;
    end if;
  else
    select count(*) into v_recent from quik1.ai_calls
     where key_hash = p_key and kind = 'assess' and created_at > now() - interval '1 hour';
    if v_recent >= 12 then
      return false;
    end if;
    select count(*) into v_recent from quik1.ai_calls
     where kind = 'assess' and created_at > now() - interval '1 hour';
    if v_recent >= 60 then
      return false;
    end if;
  end if;
  insert into quik1.ai_calls (key_hash, kind) values (p_key, p_kind);
  return true;
end;
$$;

drop function if exists public.quik1_ai_store_assessment(text, text, text, jsonb, text, text, uuid);
create or replace function public.quik1_ai_store_assessment(
  p_kind text, p_file_name text, p_file_sha256 text, p_result jsonb, p_model text, p_key text, p_client_request_id uuid,
  p_compared_with jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_sha  text;
  v_kind text;
  v_cmp  jsonb;
begin
  v_cmp := case when jsonb_typeof(p_compared_with) = 'object' then
             jsonb_build_object(
               'name', left(nullif(btrim(regexp_replace(coalesce(p_compared_with->>'name', ''), '[[:cntrl:]]', '', 'g')), ''), 120),
               'id_number', case when coalesce(p_compared_with->>'id_number', '') ~ '^[0-9]{13}$'
                                 then p_compared_with->>'id_number' end)
           end;
  if p_kind is null or p_kind not in ('bank_statement','payslip','id_document') then
    raise exception 'Unknown document kind.' using errcode = '22023';
  end if;
  if p_file_sha256 is null or lower(p_file_sha256) !~ '^[0-9a-f]{64}$' then
    raise exception 'File hash is not valid.' using errcode = '22023';
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' or octet_length(p_result::text) > 8000 then
    raise exception 'Assessment result is not valid.' using errcode = '22023';
  end if;
  if p_key is not null and p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Key hash is not valid.' using errcode = '22023';
  end if;
  if p_client_request_id is null then
    raise exception 'client_request_id is required.' using errcode = '22023';
  end if;
  insert into quik1.doc_assessments (kind, file_name, file_sha256, result, model, key_hash, client_request_id, compared_with)
  values (p_kind,
          left(regexp_replace(coalesce(p_file_name, ''), '[[:cntrl:]]', '', 'g'), 120),
          lower(p_file_sha256),
          p_result,
          left(nullif(btrim(coalesce(p_model, '')), ''), 80),
          p_key,
          p_client_request_id,
          v_cmp)
  on conflict (client_request_id) do nothing
  returning id into v_id;
  if v_id is null then
    select d.id, d.file_sha256, d.kind into v_id, v_sha, v_kind
      from quik1.doc_assessments d where d.client_request_id = p_client_request_id;
    if v_sha is distinct from lower(p_file_sha256) or v_kind is distinct from p_kind then
      raise exception 'This request id was already used for another document.' using errcode = '23505';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.quik1_ai_find_assessment(p_client_request_id uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', d.id, 'kind', d.kind, 'file_sha256', d.file_sha256, 'result', d.result,
           'same_key', d.key_hash is not distinct from p_key)
    from quik1.doc_assessments d
   where d.client_request_id = p_client_request_id;
$$;

create or replace function public.quik1_submit_application(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_ref      text;
  v_token    text;
  v_status   text;
  v_crid     text;
  v_idnum    text;
  v_phone    text;
  v_email    text;
  v_bank     jsonb;
  v_acc      text;
  v_bankname text;
  v_type     text;
  v_branch   text;
  v_docs     jsonb;
  v_ai       jsonb;
  v_cons     jsonb;
  v_req      numeric;
  v_ailim    numeric;
  v_inc      numeric;
  v_exp      numeric;
  v_hdr      jsonb;
  v_src      text;
  v_src_hash text;
  v_recent   int;
  v_doc_ids  uuid[];
  v_cdocs    jsonb;
  v_linked   int := 0;
  v_unmatched int := 0;
  v_name_key text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid application.' using errcode = '22023';
  end if;

  delete from quik1.doc_assessments where application_id is null and created_at < now() - interval '48 hours';
  if octet_length((p - 'doc_assessments_client' - 'doc_assessment_ids')::text) > 20000
     or octet_length(p::text) > 40000 then
    raise exception 'Application is too large.' using errcode = '22023';
  end if;

  v_idnum := regexp_replace(coalesce(p->>'id_number', ''), '[^0-9]', '', 'g');
  if v_idnum !~ '^[0-9]{13}$' then
    raise exception 'ID number must be 13 digits.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('quik1_submit:' || v_idnum, 0));

  v_crid := case when coalesce(p->>'client_request_id', '') ~ '^[A-Za-z0-9-]{8,64}$' then p->>'client_request_id' end;
  if v_crid is not null then
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    update quik1.applications
       set status_token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'), updated_at = now()
     where client_request_id = v_crid and id_number = v_idnum
    returning id, ref, status into v_id, v_ref, v_status;
    if found then
      insert into quik1.application_events (application_id, type, actor, detail)
      values (v_id, 'resubmitted', 'applicant', jsonb_build_object('client_request_id', v_crid));
      return jsonb_build_object('ref', v_ref, 'token', v_token, 'status', v_status, 'replayed', true);
    end if;
  end if;

  if char_length(btrim(coalesce(p->>'full_name', ''))) not between 2 and 120 then
    raise exception 'Full name is required.' using errcode = '22023';
  end if;
  v_phone := nullif(regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^\+?[0-9]{9,15}$' then
    raise exception 'Phone number is not valid.' using errcode = '22023';
  end if;
  v_email := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
  if v_email is not null and (char_length(v_email) > 254 or v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'Email address is not valid.' using errcode = '22023';
  end if;

  v_bank := case when jsonb_typeof(p->'bank') = 'object' then p->'bank' else '{}'::jsonb end;
  v_bankname := btrim(coalesce(v_bank->>'name', ''));
  if v_bankname not in ('Absa','Capitec','FNB','Nedbank','Standard Bank','TymeBank','Discovery Bank','African Bank','Investec') then
    raise exception 'Choose a supported bank.' using errcode = '22023';
  end if;
  v_acc := regexp_replace(coalesce(v_bank->>'account_no', ''), '[^0-9]', '', 'g');
  if v_acc !~ '^[0-9]{6,13}$' then
    raise exception 'Account numbers are 6 to 13 digits.' using errcode = '22023';
  end if;
  v_type := coalesce(nullif(btrim(v_bank->>'account_type'), ''), 'Savings');
  if v_type not in ('Savings','Cheque','Transmission') then
    raise exception 'Unknown account type.' using errcode = '22023';
  end if;
  v_branch := nullif(regexp_replace(coalesce(v_bank->>'branch_code', ''), '[^0-9]', '', 'g'), '');
  if v_branch is not null and v_branch !~ '^[0-9]{6}$' then
    raise exception 'Branch codes are 6 digits.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(v_bank->>'holder', ''))) not between 2 and 120 then
    raise exception 'Account holder is required.' using errcode = '22023';
  end if;

  v_req   := case when coalesce(p->>'requested_limit', '')  ~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' then (p->>'requested_limit')::numeric end;
  v_ailim := case when coalesce(p->>'ai_limit', '')         ~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' then (p->>'ai_limit')::numeric end;
  v_inc   := case when coalesce(p->>'net_income', '')       ~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' then (p->>'net_income')::numeric end;
  v_exp   := case when coalesce(p->>'monthly_expenses', '') ~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' then (p->>'monthly_expenses')::numeric end;
  if (coalesce(p->>'net_income', '') <> '' and v_inc is null)
     or (coalesce(p->>'monthly_expenses', '') <> '' and v_exp is null) then
    raise exception 'Income and expenses must be rand amounts below R 10 million.' using errcode = '22023';
  end if;
  if v_req   is not null and v_req   > 3500 then v_req   := 3500; end if;
  if v_ailim is not null and v_ailim > 3500 then v_ailim := 3500; end if;
  if (v_inc is not null and v_inc > 10000000) or (v_exp is not null and v_exp > 10000000) then
    raise exception 'Income and expenses must be below R 10 million.' using errcode = '22023';
  end if;

  v_cons := case when jsonb_typeof(p->'consents') = 'object' then p->'consents' else '{}'::jsonb end;
  if v_cons->'credit_check' is distinct from 'true'::jsonb or v_cons->'declaration' is distinct from 'true'::jsonb then
    raise exception 'Please accept the credit check and the declaration.' using errcode = '22023';
  end if;
  v_cons := jsonb_build_object('credit_check', true, 'declaration', true, 'accepted_at', now());

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', left(coalesce(d->>'kind', ''), 40),
           'name', left(coalesce(d->>'name', ''), 120),
           'size', case when coalesce(d->>'size', '') ~ '^[0-9]{1,10}$' then (d->>'size')::bigint end)), '[]'::jsonb)
    into v_docs
    from (select d from jsonb_array_elements(case when jsonb_typeof(p->'documents') = 'array' then p->'documents' else '[]'::jsonb end) as e(d)
          where jsonb_typeof(d) = 'object' limit 10) s;

  v_ai := case when jsonb_typeof(p->'ai_summary') = 'object' and octet_length((p->'ai_summary')::text) <= 4000
               then p->'ai_summary' else '{}'::jsonb end;

  v_doc_ids := array(
    select (x #>> '{}')::uuid
      from jsonb_array_elements(case when jsonb_typeof(p->'doc_assessment_ids') = 'array'
                                     then p->'doc_assessment_ids' else '[]'::jsonb end) with ordinality as e(x, n)
     where jsonb_typeof(x) = 'string'
       and (x #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     order by n
     limit 6);

  select coalesce(jsonb_agg(t.d order by t.n), '[]'::jsonb)
    into v_cdocs
    from (select s.d, s.n, sum(octet_length(s.d::text) + 2) over (order by s.n) as running
            from (select (x - 'source' - 'assessment_id') || jsonb_build_object('source', 'client_unverified') as d, n
                    from jsonb_array_elements(case when jsonb_typeof(p->'doc_assessments_client') = 'array'
                                                   then p->'doc_assessments_client' else '[]'::jsonb end) with ordinality as e(x, n)
                   where jsonb_typeof(x) = 'object' and octet_length(x::text) <= 3000
                   order by n
                   limit 6) s) t
   where t.running <= 15900;

  begin
    v_hdr := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    v_hdr := '{}'::jsonb;
  end;
  v_src := coalesce(nullif(btrim(split_part(coalesce(v_hdr->>'x-forwarded-for', ''), ',', 1)), ''),
                    nullif(btrim(coalesce(v_hdr->>'cf-connecting-ip', '')), ''));
  v_src_hash := case when v_src is not null then encode(extensions.digest('quik1-src-v1:' || v_src, 'sha256'), 'hex') end;
  if v_src_hash is not null then
    select count(*) into v_recent from quik1.applications
     where client_src_hash = v_src_hash and created_at > now() - interval '10 minutes';
    if v_recent >= 5 then
      raise exception 'Too many applications from this connection. Try again in a few minutes.' using errcode = 'P0001';
    end if;
    select count(*) into v_recent from quik1.applications
     where id_number = v_idnum and client_src_hash = v_src_hash and created_at > now() - interval '1 hour';
    if v_recent >= 3 then
      raise exception 'Too many applications for this ID number. Try again in an hour.' using errcode = 'P0001';
    end if;
  end if;
  select count(*) into v_recent from quik1.applications
   where id_number = v_idnum and created_at > now() - interval '1 day';
  if v_recent >= 10 then
    raise exception 'Too many applications for this ID number today. Please contact Quik1.' using errcode = 'P0001';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_ref   := 'QK-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYMM') || '-'
             || nextval('quik1.application_seq')::text;

  insert into quik1.applications (
    ref, client_request_id, full_name, id_number, id_checksum_ok, phone, email,
    employment, employer, tenure, net_income, monthly_expenses,
    requested_limit, ai_limit, ai_summary,
    bank_name, bank_branch_code, bank_account_type, bank_holder, bank_account_no,
    documents, consents, status_token_hash, client_src_hash,
    doc_assessments_client)
  values (
    v_ref, v_crid, left(btrim(p->>'full_name'), 120), v_idnum, quik1.sa_id_checksum_ok(v_idnum), v_phone, v_email,
    left(nullif(btrim(p->>'employment'), ''), 60), left(nullif(btrim(p->>'employer'), ''), 120), left(nullif(btrim(p->>'tenure'), ''), 60),
    v_inc, v_exp,
    v_req, v_ailim, v_ai,
    v_bankname, v_branch, v_type, left(btrim(v_bank->>'holder'), 120), v_acc,
    v_docs, v_cons, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_src_hash,
    v_cdocs)
  returning id into v_id;

  if coalesce(cardinality(v_doc_ids), 0) > 0 then
    v_name_key := lower(regexp_replace(coalesce(p->>'full_name', ''), '[^[:alnum:]]+', '', 'g'));
    update quik1.doc_assessments d
       set application_id = v_id, key_hash = null
     where d.id = any(v_doc_ids)
       and d.application_id is null
       and d.created_at > now() - interval '24 hours'
       and v_name_key <> ''
       and lower(regexp_replace(coalesce(d.compared_with->>'name', ''), '[^[:alnum:]]+', '', 'g')) = v_name_key
       and (d.compared_with->>'id_number' is null or d.compared_with->>'id_number' = v_idnum);
    get diagnostics v_linked = row_count;
    select count(*) into v_unmatched
      from quik1.doc_assessments d
     where d.id = any(v_doc_ids)
       and d.application_id is null
       and d.created_at > now() - interval '24 hours';
  end if;

  insert into quik1.application_events (application_id, type, actor, detail)
  values (v_id, 'submitted', 'applicant',
          jsonb_build_object('channel', 'app',
                             'doc_checks_server', v_linked,
                             'doc_checks_unmatched', v_unmatched,
                             'doc_checks_client', jsonb_array_length(v_cdocs)));

  return jsonb_build_object('ref', v_ref, 'token', v_token, 'status', 'received',
                            'doc_checks_linked', v_linked);
end;
$$;

create or replace function public.quik1_staff_applications(p_status text default null, p_limit int default 200)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  return query
    select (to_jsonb(a) - 'status_token_hash' - 'client_src_hash' - 'client_request_id')
           || jsonb_build_object('events', coalesce((
                select jsonb_agg(jsonb_build_object('at', e.at, 'type', e.type, 'actor', e.actor, 'detail', e.detail) order by e.at, e.id)
                  from quik1.application_events e where e.application_id = a.id), '[]'::jsonb))
           || jsonb_build_object('doc_assessments', coalesce((
                select jsonb_agg(jsonb_build_object(
                         'id', d.id, 'kind', d.kind, 'file_name', d.file_name, 'source', d.source,
                         'model', d.model, 'created_at', d.created_at, 'result', d.result,
                         'compared_with', case when d.compared_with is not null then jsonb_build_object(
                             'name', d.compared_with->>'name',
                             'id_last4', right(d.compared_with->>'id_number', 4)) end)
                       order by d.created_at, d.id)
                  from quik1.doc_assessments d where d.application_id = a.id), '[]'::jsonb))
           || jsonb_build_object('doc_assessments_client', coalesce(a.doc_assessments_client, '[]'::jsonb))
      from quik1.applications a
     where p_status is null or a.status = p_status
     order by a.created_at desc
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

revoke all on function public.quik1_submit_application(jsonb)       from public, anon, authenticated;
revoke all on function public.quik1_staff_applications(text, int)   from public, anon, authenticated;
grant execute on function public.quik1_submit_application(jsonb)    to anon, authenticated;
grant execute on function public.quik1_staff_applications(text, int) to authenticated;

revoke all on function public.quik1_ai_gate(text, text)                                        from public, anon, authenticated;
revoke all on function public.quik1_ai_store_assessment(text, text, text, jsonb, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.quik1_ai_find_assessment(uuid, text)                             from public, anon, authenticated;
grant execute on function public.quik1_ai_gate(text, text)                                        to service_role;
grant execute on function public.quik1_ai_store_assessment(text, text, text, jsonb, text, text, uuid, jsonb) to service_role;
grant execute on function public.quik1_ai_find_assessment(uuid, text)                             to service_role;
