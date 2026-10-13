-- Lending rules, enforced server-side. These mirror the delivered design's
-- client logic (estimate/assess/headroom/regrade/starRating in design/logic.js)
-- so the app and the server always agree — but the server is the authority.

create or replace function lim(k text) returns bigint
language sql stable security definer set search_path = public as $$
  select (config('limits') ->> k)::bigint
$$;

create or replace function pilot(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((config('pilot') ->> k)::boolean, false)
$$;

-- The collection date: the day before salary day, this month if still ahead, else next month.
create or replace function next_due_date(from_ts timestamptz default now()) returns date
language plpgsql stable set search_path = public as $$
declare
  today date := (from_ts at time zone 'Africa/Johannesburg')::date;
  d date := make_date(extract(year from today)::int, extract(month from today)::int, (lim('salary_day') - 1)::int);
begin
  if d <= today then d := (d + interval '1 month')::date; end if;
  return d;
end $$;

create or replace function active_loan(cid uuid) returns loans
language sql stable security definer set search_path = public as $$
  select * from loans where customer_id = cid and status = 'active'
$$;

-- Design: growth target is the base; earned once, kept for good.
create or replace function customer_grown(c customers) returns boolean
language sql stable as $$
  select c.graduated or c.interest_paid_cents >= greatest(c.base_amount_cents, 50000)
$$;

-- Design starRating(): 1 + on-time + min(2, settled) + (≥50% of growth target)
create or replace function customer_stars(cid uuid) returns int
language sql stable security definer set search_path = public as $$
  select least(5, greatest(1,
           1
           + case when exists (select 1 from debit_mandates m where m.customer_id = c.id and m.status = 'approved')
                    or exists (select 1 from loans l where l.customer_id = c.id and l.status = 'active') then 1 else 0 end
           + least(2, (select count(*) from loans l where l.customer_id = c.id and l.status = 'settled')::int)
           + case when c.interest_paid_cents * 100 >= greatest(c.base_amount_cents, 50000) * 50 then 1 else 0 end))
  from customers c where c.id = cid
$$;

create or replace function terms_unlocked(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select customer_stars(cid) >= 5
$$;

-- Design headroom(): the most principal the customer may draw now.
create or replace function customer_headroom(cid uuid) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  c customers;
  l loans;
  base bigint;
begin
  select * into c from customers where id = cid;
  if c.id is null or c.status <> 'approved' then return 0; end if;
  if c.base_amount_cents = 0 then
    -- first loan: capped by the first-loan limit (or a credit officer's offer)
    return lim('first_loan_cap_cents');
  end if;
  base := least(lim('max_principal_cents'), greatest(50000, c.base_amount_cents));
  l := active_loan(cid);
  if l.id is null then return base; end if;
  if not customer_grown(c) then return 0; end if;
  return greatest(0, ((base - l.principal_cents) / 10000) * 10000);
end $$;

-- Design regrade(): each time banked charges reach the base, the base doubles (to the max).
create or replace function regrade(cid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  c customers;
  base bigint; paid bigint; up boolean := false;
begin
  select * into c from customers where id = cid for update;
  base := greatest(c.base_amount_cents, 50000);
  paid := c.interest_paid_cents;
  while base < lim('max_principal_cents') and paid >= base loop
    paid := paid - base;
    base := least(lim('max_principal_cents'), base * 2);
    up := true;
  end loop;
  if up then
    update customers set base_amount_cents = base, interest_paid_cents = paid, graduated = true where id = cid;
  end if;
  return up;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Documents
-- ─────────────────────────────────────────────────────────────────────────────
-- Placeholder verifier, same rules as the design's checkStatement(): file type,
-- and screenshots/edited files rejected. Replace with a statement-parsing
-- provider before real lending (PRD Phase 2). Marked as such on every row.
create or replace function register_document(p_kind document_kind, p_slot int, p_path text, p_file_name text)
returns documents
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  months text[] := array['July', 'June', 'May'];
  low text := lower(p_file_name);
  other text;
  d documents;
  st check_state := 'ok';
  reason text;
begin
  if uid is null or not exists (select 1 from customers where id = uid) then raise exception 'NOT_A_CUSTOMER'; end if;
  if split_part(p_path, '/', 1) <> uid::text then raise exception 'PATH_NOT_OWNED'; end if;
  if p_kind = 'bank_statement' then
    select m into other from unnest(months) with ordinality as t(m, i) where i - 1 <> p_slot and low like '%' || lower(m) || '%' limit 1;
    if other is not null then st := 'fail'; reason := 'Wrong month — this looks like ' || other; end if;
  end if;
  if st = 'ok' and low !~ '\.(pdf|png|jpe?g|heic)$' then st := 'fail'; reason := 'Unreadable file type'; end if;
  if st = 'ok' and low ~ '(screenshot|whats|edit)' then st := 'fail'; reason := 'Not an official statement'; end if;
  insert into documents (customer_id, kind, slot, storage_path, file_name, check_state, check_reason, checked_by)
  values (uid, p_kind, p_slot, p_path, p_file_name, st, reason, 'mock-filename-check')
  returning * into d;
  return d;
end $$;

-- latest check per (kind, slot)
create or replace function documents_ok(cid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with latest as (
    select distinct on (kind, slot) kind, slot, check_state, created_at
    from documents where customer_id = cid order by kind, slot, created_at desc
  )
  select jsonb_build_object(
    'statements', (select count(*) from latest where kind = 'bank_statement' and slot between 0 and 2 and check_state = 'ok' and created_at > now() - interval '90 days') = 3,
    'proof', exists (select 1 from latest where kind = 'proof_of_income' and check_state = 'ok'),
    'id', exists (select 1 from latest where kind = 'id_document' and check_state = 'ok'))
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Applications
-- ─────────────────────────────────────────────────────────────────────────────
-- Design assess(): affordability on surplus income, statements + proof verified.
create or replace function submit_application(p_amount_cents bigint, p_term int, p_purpose text, p_income_cents bigint, p_expenses_cents bigint)
returns applications
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c customers;
  q record;
  docs jsonb;
  repeat_borrower boolean;
  income bigint; expenses bigint; spare bigint;
  ratio numeric; flags jsonb := '[]';
  verdict text; offer bigint; headroom bigint;
  a applications;
begin
  select * into c from customers where id = uid;
  if c.id is null then raise exception 'NOT_A_CUSTOMER'; end if;
  if c.status <> 'approved' then raise exception 'ACCOUNT_NOT_APPROVED'; end if;
  if p_amount_cents < lim('min_principal_cents') or p_amount_cents > lim('max_principal_cents') then raise exception 'AMOUNT_OUT_OF_RANGE'; end if;
  if p_term <> 1 and not terms_unlocked(uid) then raise exception 'TERM_LOCKED'; end if;
  if coalesce(trim(p_purpose), '') = '' then raise exception 'PURPOSE_REQUIRED'; end if;

  select * into q from quote(p_amount_cents, p_term);
  if q.product_id is null then raise exception 'NO_PRODUCT_FOR_TERM'; end if;

  repeat_borrower := c.base_amount_cents > 0;
  headroom := customer_headroom(uid);
  docs := documents_ok(uid);
  income := coalesce(nullif(p_income_cents, 0), c.income_cents);
  expenses := coalesce(nullif(p_expenses_cents, 0), round(income * 0.7)::bigint);
  spare := greatest(0, income - expenses);
  ratio := case when spare > 0 then q.instalment::numeric / spare else 1 end;

  if not (docs ->> 'statements')::boolean then flags := flags || '"Bank statement not verified"'; end if;
  if not repeat_borrower and not (docs ->> 'proof')::boolean then flags := flags || '"Proof of income not verified"'; end if;
  if ratio > 0.5 then flags := flags || '"Instalment above half of surplus income"'; end if;
  if income < lim('min_income_cents') then flags := flags || '"Income below minimum"'; end if;
  if repeat_borrower and p_amount_cents > headroom then flags := flags || '"Above available limit"'; end if;

  if jsonb_array_length(flags) = 0 then
    verdict := 'approved';
    offer := least(p_amount_cents, headroom);
  elsif (docs ->> 'statements')::boolean and (repeat_borrower or (docs ->> 'proof')::boolean) then
    verdict := 'referred';   -- a credit officer decides
    offer := null;
  else
    verdict := 'declined';
    offer := null;
  end if;

  insert into applications (customer_id, amount_cents, term_months, purpose, income_cents, expenses_cents, status, verdict, offer_cents, flags, affordability)
  values (uid, p_amount_cents, p_term, trim(p_purpose), income, expenses, verdict::application_status, verdict, offer, flags,
          round((1 - least(1, ratio)) * 100)::int)
  returning * into a;
  return a;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Agreement + debit order (DebiCheck)
-- ─────────────────────────────────────────────────────────────────────────────
-- The mandate must cover everything that will be owed: the open loan plus the
-- offer being accepted (or just the open loan when approving from the loan sheet).
create or replace function sign_agreement(p_application_id uuid default null)
returns debit_mandates
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  a applications;
  l loans;
  owed bigint;
  m debit_mandates;
begin
  if not exists (select 1 from customers where id = uid and status = 'approved') then raise exception 'ACCOUNT_NOT_APPROVED'; end if;
  l := active_loan(uid);
  owed := coalesce(l.total_cents, 0);
  if p_application_id is not null then
    select * into a from applications where id = p_application_id and customer_id = uid and status = 'approved';
    if a.id is null then raise exception 'NOT_APPROVED'; end if;
    owed := owed + (select total from quote(a.offer_cents, a.term_months));
  end if;
  if owed = 0 then raise exception 'NOTHING_TO_COLLECT'; end if;
  insert into consents (customer_id, kind, version) values (uid, 'debit_order', 'debicheck-v1');
  update debit_mandates set status = 'cancelled' where customer_id = uid and status in ('pending', 'approved');
  -- Pilot: the mock provider approves at once. Live: the provider calls back
  -- (functions/payments-webhook) when the customer approves in their banking app.
  insert into debit_mandates (customer_id, status, provider, max_amount_cents, approved_at)
  values (uid,
          case when pilot('mock_mandates') then 'approved'::mandate_status else 'pending' end,
          case when pilot('mock_mandates') then 'mock-debicheck' else 'debicheck' end,
          owed,
          case when pilot('mock_mandates') then now() end)
  returning * into m;
  return m;
end $$;

create or replace function mandate_covers(cid uuid, amount bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from debit_mandates where customer_id = cid and status = 'approved' and max_amount_cents >= amount)
$$;

-- Accept an approved offer: creates the loan (or a drawdown on the open loan).
create or replace function accept_offer(p_application_id uuid, p_terms_accepted boolean)
returns loans
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  a applications;
  c customers;
  q record;
  l loans;
  d drawdowns;
  docs jsonb;
begin
  select * into a from applications where id = p_application_id and customer_id = uid for update;
  if a.id is null then raise exception 'APPLICATION_NOT_FOUND'; end if;
  if a.status <> 'approved' or a.offer_cents is null then raise exception 'NOT_APPROVED'; end if;
  if a.decided_at is null and a.created_at < now() - interval '24 hours' then raise exception 'OFFER_EXPIRED'; end if;
  if not coalesce(p_terms_accepted, false) then raise exception 'TERMS_NOT_ACCEPTED'; end if;
  select * into c from customers where id = uid for update;

  if c.base_amount_cents = 0 then
    docs := documents_ok(uid);
    if not (docs ->> 'statements')::boolean then raise exception 'STATEMENTS_REQUIRED'; end if;
    if not (docs ->> 'proof')::boolean then raise exception 'PROOF_REQUIRED'; end if;
    if not (docs ->> 'id')::boolean then raise exception 'ID_REQUIRED'; end if;
  elsif a.offer_cents > customer_headroom(uid) and a.decided_by is null then
    raise exception 'ABOVE_LIMIT';
  end if;

  select * into q from quote(a.offer_cents, a.term_months);
  l := active_loan(uid);
  if not mandate_covers(uid, coalesce(l.total_cents, 0) + q.total) then raise exception 'MANDATE_REQUIRED'; end if;

  if l.id is null then
    insert into loans (customer_id, term_months, principal_cents, charge_cents, total_cents, first_due_date)
    values (uid, a.term_months, q.principal, q.charge, q.total, next_due_date())
    returning * into l;
  else
    update loans set principal_cents = principal_cents + q.principal, charge_cents = charge_cents + q.charge, total_cents = total_cents + q.total
    where id = l.id returning * into l;
  end if;

  insert into drawdowns (loan_id, application_id, product_id, principal_cents, charge_cents, total_cents, charge_bps, purpose, agreement_version)
  values (l.id, a.id, q.product_id, q.principal, q.charge, q.total, q.charge_bps, a.purpose, 'quik1-credit-agreement-v1')
  returning * into d;

  insert into payouts (drawdown_id, amount_cents, status, provider)
  values (d.id, q.principal, case when pilot('hold_payouts') then 'held_pilot'::payout_status else 'pending' end,
          case when pilot('hold_payouts') then null else 'payout-provider' end);

  update applications set status = 'accepted' where id = a.id;
  if c.base_amount_cents = 0 then update customers set base_amount_cents = q.principal where id = uid; end if;
  return l;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Settlement
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function apply_collection_paid(p_collection_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  col collections; l loans; paid bigint;
begin
  update collections set status = 'paid', paid_at = now() where id = p_collection_id and status = 'submitted' returning * into col;
  if col.id is null then return; end if;
  select * into l from loans where id = col.loan_id for update;
  select coalesce(sum(amount_cents), 0) into paid from collections where loan_id = l.id and status = 'paid';
  if paid >= l.total_cents and l.status = 'active' then
    update loans set status = 'settled', settled_at = now() where id = l.id;
    update customers set interest_paid_cents = interest_paid_cents + l.charge_cents where id = l.customer_id;
    perform regrade(l.customer_id);
    -- the next loan needs a fresh debit order (design: mandateSigned resets on settle)
    update debit_mandates set status = 'cancelled' where customer_id = l.customer_id and status = 'approved';
  end if;
end $$;

create or replace function request_settlement() returns collections
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  l loans; owed bigint; col collections;
begin
  l := active_loan(uid);
  if l.id is null then raise exception 'NO_ACTIVE_LOAN'; end if;
  if not exists (select 1 from debit_mandates where customer_id = uid and status = 'approved') then raise exception 'MANDATE_REQUIRED'; end if;
  select l.total_cents - coalesce(sum(amount_cents) filter (where status = 'paid'), 0) into owed from collections where loan_id = l.id;
  insert into collections (loan_id, amount_cents, provider)
  values (l.id, owed, case when pilot('mock_collections') then 'mock-debicheck' else 'debicheck' end)
  returning * into col;
  if pilot('mock_collections') then
    perform apply_collection_paid(col.id);
    select * into col from collections where id = col.id;
  end if;
  return col;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Profile
-- ─────────────────────────────────────────────────────────────────────────────
-- Name, ID number and phone are identity — changed only by staff after checks.
create or replace function update_profile(p_email text, p_photo_path text default null) returns customers
language plpgsql security definer set search_path = public as $$
declare c customers;
begin
  if p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'BAD_EMAIL'; end if;
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> auth.uid()::text then raise exception 'PATH_NOT_OWNED'; end if;
  update customers set email = p_email, photo_path = coalesce(p_photo_path, photo_path) where id = auth.uid() returning * into c;
  if c.id is null then raise exception 'NOT_A_CUSTOMER'; end if;
  return c;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Snapshot — everything the app hydrates from, in the shapes the design uses (rands)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function rands(cents bigint) returns numeric language sql immutable as $$ select round(coalesce(cents, 0) / 100.0, 2) $$;
create or replace function za_date(ts timestamptz) returns text language sql immutable as $$
  select to_char(ts at time zone 'Africa/Johannesburg', 'FMDD FMMonth')
$$;

create or replace function my_snapshot() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c customers;
  l loans;
  r jsonb;
begin
  select * into c from customers where id = uid;
  if c.id is null then return null; end if;
  l := active_loan(uid);
  r := jsonb_build_object(
    'status', c.status,
    'ref', c.ref,
    'photoPath', c.photo_path,
    'profile', jsonb_build_object(
      'name', c.full_name,
      'idnum', substr(c.id_number, 1, 7) || ' ' || substr(c.id_number, 8, 3) || ' ' || substr(c.id_number, 11, 3),
      'email', c.email,
      'mobile', '+27 ' || substr(c.phone, 4, 2) || ' ' || substr(c.phone, 6, 3) || ' ' || substr(c.phone, 9, 4),
      'bank', coalesce(c.bank_label, 'Bank account on file')),
    'baseAmount', rands(c.base_amount_cents),
    'interestPaid', rands(c.interest_paid_cents),
    'graduated', c.graduated,
    'stars', customer_stars(uid),
    'headroom', rands(customer_headroom(uid)),
    'mandateSigned', mandate_covers(uid, coalesce(l.total_cents, 1)),
    'dueDate', next_due_date(),
    'activeLoan', case when l.id is null then null else jsonb_build_object(
      'id', l.id, 'ref', l.ref,
      'a', rands(l.principal_cents), 'total', rands(l.total_cents), 'term', l.term_months,
      'monthly', round(l.total_cents / 100.0 / l.term_months, 2),
      'dueDate', l.first_due_date,
      'draws', (select coalesce(jsonb_agg(jsonb_build_object(
                  'a', rands(d.principal_cents), 'total', rands(d.total_cents), 'date', za_date(d.signed_at),
                  'ref', d.ref, 'term', l.term_months, 'rate', d.charge_bps / 10000.0, 'purpose', d.purpose,
                  'signedAt', (extract(epoch from d.signed_at) * 1000)::bigint) order by d.signed_at), '[]')
                from drawdowns d where d.loan_id = l.id)) end,
    'closedLoans', (select coalesce(jsonb_agg(jsonb_build_object(
                  'a', rands(x.principal_cents), 'total', rands(x.total_cents), 'term', x.term_months, 'ref', x.ref,
                  'date', za_date(x.created_at),
                  'settledOn', to_char(x.settled_at at time zone 'Africa/Johannesburg', 'FMDD FMMonth YYYY')) order by x.settled_at), '[]')
                from loans x where x.customer_id = uid and x.status = 'settled'),
    'chat', (select coalesce(jsonb_agg(jsonb_build_object('from', case when m.sender = 'customer' then 'me' else 'them' end, 'text', m.body) order by m.created_at), '[]')
                from support_messages m where m.customer_id = uid),
    'documents', documents_ok(uid),
    'latestApplication', (select to_jsonb(x) - 'customer_id' from applications x where x.customer_id = uid order by created_at desc limit 1));
  return r;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Staff actions
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function staff_review_customer(p_customer_id uuid, p_approve boolean, p_note text default null) returns customers
language plpgsql security definer set search_path = public as $$
declare c customers;
begin
  if not is_staff('credit_officer') then raise exception 'FORBIDDEN'; end if;
  update customers set status = case when p_approve then 'approved'::customer_status else 'declined' end, status_note = p_note
  where id = p_customer_id and status = 'pending_review' returning * into c;
  if c.id is null then raise exception 'NOT_PENDING'; end if;
  return c;
end $$;

create or replace function staff_decide_application(p_application_id uuid, p_approve boolean, p_offer_cents bigint default null) returns applications
language plpgsql security definer set search_path = public as $$
declare a applications;
begin
  if not is_staff('credit_officer') then raise exception 'FORBIDDEN'; end if;
  if p_approve and (p_offer_cents is null or p_offer_cents < lim('min_principal_cents') or p_offer_cents > lim('max_principal_cents')) then
    raise exception 'BAD_OFFER';
  end if;
  update applications
     set status = case when p_approve then 'approved'::application_status else 'declined' end,
         verdict = case when p_approve then 'approved' else 'declined' end,
         offer_cents = case when p_approve then p_offer_cents end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_application_id and status in ('submitted', 'referred')
   returning * into a;
  if a.id is null then raise exception 'NOT_DECIDABLE'; end if;
  return a;
end $$;

create or replace function staff_reply(p_customer_id uuid, p_body text) returns support_messages
language plpgsql security definer set search_path = public as $$
declare m support_messages;
begin
  if not is_staff('support') then raise exception 'FORBIDDEN'; end if;
  insert into support_messages (customer_id, sender, agent_id, body) values (p_customer_id, 'agent', auth.uid(), p_body) returning * into m;
  return m;
end $$;
