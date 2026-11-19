-- Recorded from ledger-ecoloans migration 20261107094307 (loop_applications), applied 2026-11-07.
-- Statement body is the one stored in supabase_migrations.schema_migrations.
-- It grants anon EXECUTE on public.loop_submit_application(jsonb) and
-- public.loop_application_status(text, text).
-- That grant is closed by 20261109163000_revoke_quik1_anon_execute.sql.
-- Already applied on production. Do not run this file again there: doing so re-opens anon.

-- Loop (EcoLoans (Pty) Ltd t/a Loop) · customer limit applications. ADDITIVE ONLY:
-- private schema `loop` (RLS on, no policies, no grants) + four public.loop_* RPCs.
-- Source: loopcredit/app/db/001_loop_applications.sql (reviewed + dry-run tested Nov 2026).
create schema if not exists loop;
revoke all on schema loop from public, anon, authenticated;
create sequence if not exists loop.application_seq start with 1001;
revoke all on sequence loop.application_seq from public, anon, authenticated;
create table if not exists loop.applications (
  id                 uuid primary key default extensions.gen_random_uuid(),
  ref                text not null unique,
  client_request_id  text unique check (client_request_id is null or client_request_id ~ '^[A-Za-z0-9-]{8,64}$'),
  status             text not null default 'received'
                       check (status in ('received','reviewing','approved','adjusted','declined','withdrawn')),
  channel            text not null default 'app' check (channel in ('app','admin')),
  full_name          text not null check (char_length(full_name) between 2 and 120),
  id_number          text not null check (id_number ~ '^[0-9]{13}$'),
  id_checksum_ok     boolean not null,
  phone              text check (phone is null or phone ~ '^\+?[0-9]{9,15}$'),
  email              text check (email is null or (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  employment         text check (employment is null or char_length(employment) <= 60),
  employer           text check (employer   is null or char_length(employer)   <= 120),
  tenure             text check (tenure     is null or char_length(tenure)     <= 60),
  net_income         numeric(12,2) check (net_income       is null or net_income       between 0 and 10000000),
  monthly_expenses   numeric(12,2) check (monthly_expenses is null or monthly_expenses between 0 and 10000000),
  requested_limit    numeric(12,2) check (requested_limit is null or requested_limit between 0 and 3500),
  ai_limit           numeric(12,2) check (ai_limit        is null or ai_limit        between 0 and 3500),
  ai_source          text not null default 'client_unverified' check (ai_source in ('client_unverified','server')),
  ai_summary         jsonb not null default '{}'::jsonb
                       check (jsonb_typeof(ai_summary) = 'object' and octet_length(ai_summary::text) <= 4000),
  approved_limit     numeric(12,2) check (approved_limit  is null or approved_limit  between 0 and 3500),
  bank_name          text not null,
  bank_branch_code   text check (bank_branch_code is null or bank_branch_code ~ '^[0-9]{6}$'),
  bank_account_type  text not null check (bank_account_type in ('Savings','Cheque','Transmission')),
  bank_holder        text not null check (char_length(bank_holder) between 2 and 120),
  bank_account_no    text not null check (bank_account_no ~ '^[0-9]{6,13}$'),
  bank_last4         text generated always as (right(bank_account_no, 4)) stored,
  documents          jsonb not null default '[]'::jsonb check (jsonb_typeof(documents) = 'array'),
  consents           jsonb not null default '{}'::jsonb check (jsonb_typeof(consents)  = 'object'),
  status_token_hash  text not null,
  client_src_hash    text,
  decided_by         text,
  decided_at         timestamptz,
  decision_note      text check (decision_note    is null or char_length(decision_note)    <= 500),
  customer_message   text check (customer_message is null or char_length(customer_message) <= 300),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists loop_applications_status_created_idx on loop.applications (status, created_at desc);
create index if not exists loop_applications_idnum_created_idx  on loop.applications (id_number, created_at desc);
create index if not exists loop_applications_created_idx        on loop.applications (created_at desc);
create index if not exists loop_applications_src_created_idx    on loop.applications (client_src_hash, created_at desc);
create table if not exists loop.application_events (
  id              bigint generated always as identity primary key,
  application_id  uuid not null references loop.applications(id),
  at              timestamptz not null default now(),
  type            text not null,
  actor           text not null,
  detail          jsonb not null default '{}'::jsonb
);
create index if not exists loop_application_events_app_idx on loop.application_events (application_id, at, id);
alter table loop.applications       enable row level security;
alter table loop.application_events enable row level security;
revoke all on all tables in schema loop from public, anon, authenticated;
create or replace function loop.sa_id_checksum_ok(p text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when p is null or p !~ '^[0-9]{13}$' then false
    else (
      select sum(
               case when (13 - i) % 2 = 1
                    then (case when substr(p, i, 1)::int * 2 > 9
                               then substr(p, i, 1)::int * 2 - 9
                               else substr(p, i, 1)::int * 2 end)
                    else substr(p, i, 1)::int end
             ) % 10 = 0
      from generate_series(1, 13) as g(i)
    )
  end;
$$;
revoke all on function loop.sa_id_checksum_ok(text) from public, anon, authenticated;
create or replace function public.loop_submit_application(p jsonb)
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
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid application.' using errcode = '22023';
  end if;
  if octet_length(p::text) > 20000 then
    raise exception 'Application is too large.' using errcode = '22023';
  end if;
  v_idnum := regexp_replace(coalesce(p->>'id_number', ''), '[^0-9]', '', 'g');
  if v_idnum !~ '^[0-9]{13}$' then
    raise exception 'ID number must be 13 digits.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('loop_submit:' || v_idnum, 0));
  v_crid := case when coalesce(p->>'client_request_id', '') ~ '^[A-Za-z0-9-]{8,64}$' then p->>'client_request_id' end;
  if v_crid is not null then
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    update loop.applications
       set status_token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'), updated_at = now()
     where client_request_id = v_crid and id_number = v_idnum
    returning id, ref, status into v_id, v_ref, v_status;
    if found then
      insert into loop.application_events (application_id, type, actor, detail)
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
  begin
    v_hdr := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    v_hdr := '{}'::jsonb;
  end;
  v_src := coalesce(nullif(btrim(split_part(coalesce(v_hdr->>'x-forwarded-for', ''), ',', 1)), ''),
                    nullif(btrim(coalesce(v_hdr->>'cf-connecting-ip', '')), ''));
  v_src_hash := case when v_src is not null then encode(extensions.digest('loop-src-v1:' || v_src, 'sha256'), 'hex') end;
  if v_src_hash is not null then
    select count(*) into v_recent from loop.applications
     where client_src_hash = v_src_hash and created_at > now() - interval '10 minutes';
    if v_recent >= 5 then
      raise exception 'Too many applications from this connection. Try again in a few minutes.' using errcode = 'P0001';
    end if;
    select count(*) into v_recent from loop.applications
     where id_number = v_idnum and client_src_hash = v_src_hash and created_at > now() - interval '1 hour';
    if v_recent >= 3 then
      raise exception 'Too many applications for this ID number. Try again in an hour.' using errcode = 'P0001';
    end if;
  end if;
  select count(*) into v_recent from loop.applications
   where id_number = v_idnum and created_at > now() - interval '1 day';
  if v_recent >= 10 then
    raise exception 'Too many applications for this ID number today. Please contact Loop.' using errcode = 'P0001';
  end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_ref   := 'LP-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYMM') || '-'
             || nextval('loop.application_seq')::text;
  insert into loop.applications (
    ref, client_request_id, full_name, id_number, id_checksum_ok, phone, email,
    employment, employer, tenure, net_income, monthly_expenses,
    requested_limit, ai_limit, ai_summary,
    bank_name, bank_branch_code, bank_account_type, bank_holder, bank_account_no,
    documents, consents, status_token_hash, client_src_hash)
  values (
    v_ref, v_crid, left(btrim(p->>'full_name'), 120), v_idnum, loop.sa_id_checksum_ok(v_idnum), v_phone, v_email,
    left(nullif(btrim(p->>'employment'), ''), 60), left(nullif(btrim(p->>'employer'), ''), 120), left(nullif(btrim(p->>'tenure'), ''), 60),
    v_inc, v_exp,
    v_req, v_ailim, v_ai,
    v_bankname, v_branch, v_type, left(btrim(v_bank->>'holder'), 120), v_acc,
    v_docs, v_cons, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_src_hash)
  returning id into v_id;
  insert into loop.application_events (application_id, type, actor, detail)
  values (v_id, 'submitted', 'applicant', jsonb_build_object('channel', 'app'));
  return jsonb_build_object('ref', v_ref, 'token', v_token, 'status', 'received');
end;
$$;
create or replace function public.loop_application_status(p_ref text, p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'ref', a.ref, 'status', a.status, 'approved_limit', a.approved_limit,
           'customer_message', a.customer_message, 'decided_at', a.decided_at)
    from loop.applications a
   where a.ref = p_ref
     and p_token is not null and char_length(p_token) = 48
     and a.status_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;
create or replace function public.loop_staff_applications(p_status text default null, p_limit int default 200)
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
                  from loop.application_events e where e.application_id = a.id), '[]'::jsonb))
      from loop.applications a
     where p_status is null or a.status = p_status
     order by a.created_at desc
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;
create or replace function public.loop_staff_decide(
  p_id uuid, p_decision text, p_limit numeric default null, p_note text default null, p_customer_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := coalesce(nullif(auth.jwt() ->> 'email', ''), 'staff');
  v_row   loop.applications;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('reviewing','approved','adjusted','declined','withdrawn') then
    raise exception 'Unknown decision.' using errcode = '22023';
  end if;
  if p_decision in ('approved','adjusted') and (p_limit is null or p_limit <= 0 or p_limit > 3500) then
    raise exception 'Approved limit must be between R 1 and R 3,500.' using errcode = '22023';
  end if;
  update loop.applications
     set status           = p_decision,
         approved_limit   = case when p_decision in ('approved','adjusted') then round(p_limit, 2)
                                 when p_decision = 'declined' then 0
                                 else approved_limit end,
         decision_note    = case when p_note is null then decision_note else left(p_note, 500) end,
         customer_message = case when p_customer_message is null then customer_message else left(p_customer_message, 300) end,
         decided_by       = case when p_decision = 'reviewing' then decided_by else v_actor end,
         decided_at       = case when p_decision = 'reviewing' then decided_at else now() end,
         updated_at       = now()
   where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  insert into loop.application_events (application_id, type, actor, detail)
  values (p_id, p_decision, v_actor,
          jsonb_build_object('limit', p_limit, 'note', left(p_note, 500), 'customer_message', left(p_customer_message, 300)));
  return to_jsonb(v_row) - 'status_token_hash' - 'client_src_hash' - 'client_request_id';
end;
$$;
revoke all on function public.loop_submit_application(jsonb)                        from public, anon, authenticated;
revoke all on function public.loop_application_status(text, text)                 from public, anon, authenticated;
revoke all on function public.loop_staff_applications(text, int)                  from public, anon, authenticated;
revoke all on function public.loop_staff_decide(uuid, text, numeric, text, text)  from public, anon, authenticated;
grant execute on function public.loop_submit_application(jsonb)                     to anon, authenticated;
grant execute on function public.loop_application_status(text, text)              to anon, authenticated;
grant execute on function public.loop_staff_applications(text, int)               to authenticated;
grant execute on function public.loop_staff_decide(uuid, text, numeric, text, text) to authenticated;
