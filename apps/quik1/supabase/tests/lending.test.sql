-- End-to-end lending rules + Row Level Security, as real roles.
-- Every check raises on failure; psql runs with ON_ERROR_STOP.
\set ON_ERROR_STOP 1
\o /dev/null

create or replace function pg_temp.eq(actual anyelement, expected anyelement, what text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL %: expected %, got %', what, expected, actual; end if;
end $$;

-- run `stmt`, require it to fail with a message containing `fragment`
create or replace function pg_temp.fails(stmt text, fragment text, what text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL %: expected error containing "%", but it succeeded', what, fragment;
exception when others then
  if sqlerrm like 'FAIL %' then raise; end if;
  if position(fragment in sqlerrm) = 0 then raise exception 'FAIL %: expected "%", got "%"', what, fragment, sqlerrm; end if;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- ── fixtures (as the owner) ──────────────────────────────────────────────────
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-0000000000c0'), ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c2');
insert into customers (id, full_name, id_number, phone, email, income_cents, status) values
  ('00000000-0000-0000-0000-00000000000a', 'Thandi Mokoena', '9204125084083', '+27824319077', 'thandi@example.com', 1500000, 'approved'),
  ('00000000-0000-0000-0000-00000000000b', 'Sipho Dlamini', '8801015009087', '+27731234567', 'sipho@example.com', 900000, 'pending_review');
insert into customer_secrets (customer_id, pin_hash) values ('00000000-0000-0000-0000-00000000000a', 'x');
insert into staff (user_id, name, role) values
  ('00000000-0000-0000-0000-0000000000c0', 'Viewer', 'viewer'),
  ('00000000-0000-0000-0000-0000000000c1', 'Officer', 'credit_officer'),
  ('00000000-0000-0000-0000-0000000000c2', 'Admin', 'admin');

-- ── anon sees nothing ────────────────────────────────────────────────────────
set role anon;
select pg_temp.fails('select * from customers', 'permission denied', 'anon cannot read customers');
select pg_temp.fails('select my_snapshot()', 'permission denied', 'anon cannot call my_snapshot');
select pg_temp.fails('select * from app_config', 'permission denied', 'anon cannot read config');
reset role;

-- ── customer A: isolation ────────────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.eq((select count(*) from customers), 1::bigint, 'A sees only own customer row');
select pg_temp.eq((select full_name from customers), 'Thandi Mokoena', 'A sees self');
select pg_temp.fails($$update customers set status = 'approved', base_amount_cents = 800000$$, 'permission denied', 'A cannot write own status/limits');
select pg_temp.fails($$insert into loans (customer_id, term_months, principal_cents, charge_cents, total_cents, first_due_date) values (auth.uid(), 1, 1, 1, 2, now())$$, 'permission denied', 'A cannot insert loans');
select pg_temp.fails('select * from customer_secrets', 'permission denied', 'A cannot read PIN hashes');
select pg_temp.fails('select * from otp_challenges', 'permission denied', 'A cannot read OTPs');
select pg_temp.eq((select count(*) from audit_log), 0::bigint, 'A cannot read audit log');
select pg_temp.fails($$select customer_headroom('00000000-0000-0000-0000-00000000000b')$$, 'permission denied', 'A cannot probe others limits');

-- support chat: as self only
insert into support_messages (customer_id, sender, body) values (auth.uid(), 'customer', 'Can I pay off early?');
select pg_temp.fails($$insert into support_messages (customer_id, sender, body) values (auth.uid(), 'agent', 'spoofed')$$, 'row-level security', 'A cannot post as an agent');
select pg_temp.fails($$insert into support_messages (customer_id, sender, body) values ('00000000-0000-0000-0000-00000000000b', 'customer', 'x')$$, 'row-level security', 'A cannot post into B thread');

-- storage: own folder only
insert into storage.objects (bucket_id, name) values ('documents', '00000000-0000-0000-0000-00000000000a/stmt-july.pdf');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('documents', '00000000-0000-0000-0000-00000000000b/x.pdf')$$, 'row-level security', 'A cannot upload into B folder');

-- ── pricing ──────────────────────────────────────────────────────────────────
select pg_temp.eq((select total from quote(250000, 1)), 337500::bigint, 'R2 500 at 35% = R3 375');
select pg_temp.eq((select instalment from quote(300000, 3)), 135000::bigint, 'R3 000 over 3 months = R1 350/month');

-- ── application without documents is declined ────────────────────────────────
select pg_temp.eq((select verdict from submit_application(100000, 1, 'Groceries', 1500000, 800000)), 'declined', 'no documents → declined');
select pg_temp.fails($$select submit_application(100000, 3, 'Groceries', 1500000, 800000)$$, 'TERM_LOCKED', 'longer terms locked for new customers');
select pg_temp.fails($$select submit_application(900000, 1, 'Groceries', 1500000, 800000)$$, 'AMOUNT_OUT_OF_RANGE', 'above R8 000 refused');
select pg_temp.fails($$select register_document('bank_statement', 0, '00000000-0000-0000-0000-00000000000b/x.pdf', 'x.pdf')$$, 'PATH_NOT_OWNED', 'cannot register another customer file');

-- documents: the design's checks, server-side
select pg_temp.eq((select check_state from register_document('bank_statement', 0, '00000000-0000-0000-0000-00000000000a/s0.pdf', 'june-statement.pdf')), 'fail'::check_state, 'wrong month rejected');
select pg_temp.eq((select check_state from register_document('bank_statement', 0, '00000000-0000-0000-0000-00000000000a/s0.png', 'Screenshot 2026.png')), 'fail'::check_state, 'screenshot rejected');
select register_document('bank_statement', 0, '00000000-0000-0000-0000-00000000000a/s0.pdf', 'july.pdf');
select register_document('bank_statement', 1, '00000000-0000-0000-0000-00000000000a/s1.pdf', 'june.pdf');
select register_document('bank_statement', 2, '00000000-0000-0000-0000-00000000000a/s2.pdf', 'may.pdf');
select register_document('proof_of_income', 0, '00000000-0000-0000-0000-00000000000a/p.pdf', 'payslip.pdf');
select pg_temp.eq((select my_snapshot() -> 'documents' ->> 'statements'), 'true', 'three statements verified');

-- ── approve → mandate → accept ───────────────────────────────────────────────
create temp table t_app as select * from submit_application(250000, 1, 'Groceries', 1500000, 800000);
select pg_temp.eq((select verdict from t_app), 'approved', 'documents + affordable → approved');
select pg_temp.eq((select offer_cents from t_app), 100000::bigint, 'first loan capped at R1 000');
select pg_temp.fails(format('select accept_offer(%L, false)', (select id from t_app)), 'TERMS_NOT_ACCEPTED', 'must accept terms');
select pg_temp.fails(format('select accept_offer(%L, true)', (select id from t_app)), 'ID_REQUIRED', 'ID document required before payout');
select register_document('id_document', 0, '00000000-0000-0000-0000-00000000000a/id.jpg', 'id-front.jpg');
select pg_temp.fails(format('select accept_offer(%L, true)', (select id from t_app)), 'MANDATE_REQUIRED', 'debit order required before payout');
select pg_temp.eq((select status from sign_agreement((select id from t_app))), 'approved'::mandate_status, 'pilot mandate approved by mock');
select pg_temp.eq((select max_amount_cents from debit_mandates where status = 'approved'), 135000::bigint, 'mandate covers R1 350');
select pg_temp.eq((select total_cents from accept_offer((select id from t_app), true)), 135000::bigint, 'loan total R1 350');
select pg_temp.eq((select status from payouts), 'held_pilot'::payout_status, 'pilot holds the payout — no money moves');
select pg_temp.fails(format('select accept_offer(%L, true)', (select id from t_app)), 'NOT_APPROVED', 'an offer is accepted once');
select pg_temp.eq((select my_snapshot() -> 'activeLoan' ->> 'total'), '1350.00', 'snapshot shows the loan in rands');
select pg_temp.eq((select (my_snapshot() ->> 'mandateSigned')::boolean), true, 'snapshot shows mandate');
reset role;

-- ── customer B cannot see or touch A's loan; pending accounts cannot borrow ──
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.eq((select count(*) from loans), 0::bigint, 'B sees no loans');
select pg_temp.eq((select count(*) from support_messages), 0::bigint, 'B sees no chat');
select pg_temp.eq((select count(*) from storage.objects), 0::bigint, 'B sees no files');
select pg_temp.fails(format('select accept_offer(%L, true)', (select id from t_app)), 'APPLICATION_NOT_FOUND', 'B cannot accept A offer');
select pg_temp.fails($$select submit_application(100000, 1, 'Rent', 900000, 500000)$$, 'ACCOUNT_NOT_APPROVED', 'pending account cannot apply');
reset role;

-- ── settle → growth ──────────────────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.eq((select status from request_settlement()), 'paid'::collection_status, 'mock collection paid');
select pg_temp.eq((select status from loans), 'settled'::loan_status, 'loan settled');
select pg_temp.eq((select interest_paid_cents from customers), 35000::bigint, 'charge banked toward growth');
select pg_temp.eq((select jsonb_array_length(my_snapshot() -> 'closedLoans')), 1, 'closed loan in snapshot');
select pg_temp.eq((select (my_snapshot() ->> 'mandateSigned')::boolean), false, 'next loan needs a new debit order');
select pg_temp.eq((select (my_snapshot() ->> 'headroom')::numeric), 1000.00, 'headroom back to base R1 000');
reset role;

-- ── staff roles ──────────────────────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c0', false);
select pg_temp.eq((select count(*) from customers), 2::bigint, 'viewer reads customers');
select pg_temp.fails($$select staff_review_customer('00000000-0000-0000-0000-00000000000b', true)$$, 'FORBIDDEN', 'viewer cannot approve accounts');
select pg_temp.eq((select count(*) from audit_log), 0::bigint, 'viewer cannot read audit log');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select pg_temp.eq((select status from staff_review_customer('00000000-0000-0000-0000-00000000000b', true, 'ID checked')), 'approved'::customer_status, 'officer approves account');
update products set charge_bps = 1000;
select pg_temp.eq((select min(charge_bps) from products), 3500, 'officer cannot change pricing (update matches no rows)');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
select pg_temp.eq((select count(*) > 10 from audit_log), true, 'admin reads audit log');
select pg_temp.fails('update audit_log set action = $$x$$', 'permission denied', 'audit log cannot be edited');
reset role;
select pg_temp.fails('delete from audit_log', 'append-only', 'audit log cannot be deleted, even by owner');

\o
\echo 'lending.test.sql: all checks passed'
