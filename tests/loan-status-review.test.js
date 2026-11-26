// The three console paths and the acknowledgement migration, checked as source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261110103000_ledger_attention.sql', import.meta.url), 'utf8');
const paidCheck = readFileSync(new URL('../supabase/migrations/20261126120000_loans_paid_status_check.sql', import.meta.url), 'utf8');
const diagnostics = readFileSync(new URL('../supabase/diagnostics/loan-status-audit-mismatch.sql', import.meta.url), 'utf8');

test('loan edit, bulk write-off, and pay-next go through /loan-status', () => {
  assert.match(html, /if\(!unchanged\) this\.commitLoanStatus\(mLoanRaw\.id, next, kind/);
  assert.match(html, /writeOffs\.forEach\(w=>this\.commitLoanStatus\(w\.id, 'written_off'/);
  assert.match(html, /nextInstalmentStep\(nx\.l, nx\.of\)/);
  assert.match(html, /instalmentsPaid: step\.instalmentsPaid/);
  assert.doesNotMatch(html, /setLoanStatus\(nx\.l\.id,'paid'/);
  assert.match(html, /ledAllowPaid/);
  assert.match(html, /statusChoices\(loan\)/);
});

test('bulk mark-paid sends one instalment step instead of a bare paid status', () => {
  assert.match(html, /nextInstalmentStep\(n\.loan, total\)/);
  assert.match(html, /instalmentsPaid:step\.instalmentsPaid/);
  assert.match(html, /requestId:n\.loan\.id\+':bulk:'\+step\.instalmentsPaid/);
  assert.match(html, /Recorded one instalment on /);
});

test('the paid-status check migration is additive, NOT VALID, and not applied here', () => {
  assert.match(paidCheck, /NOT APPLIED/);
  assert.match(paidCheck, /Ledger Bot review/);
  assert.match(paidCheck, /loans_paid_has_count_and_date/);
  assert.match(paidCheck, /not valid/i);
  assert.match(paidCheck, /if not exists/);
  assert.equal(paidCheck.toLowerCase().includes('validate constraint'), false);
  assert.equal(paidCheck.toLowerCase().includes('update public.loans'), false);
});

test('the acknowledgement migration adds an idempotent loan foreign key and is not applied here', () => {
  assert.match(migration, /ledger_attention_loan_id_fkey/);
  assert.match(migration, /references public\.loans \(id\)/);
  assert.match(migration, /if not exists/);
  assert.match(diagnostics, /NOT RUN/);
  assert.match(diagnostics, /^--\s*delete from public\.audit_log/im);
});
