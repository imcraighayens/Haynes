// The three console paths and the acknowledgement migration, checked as source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261110103000_ledger_attention.sql', import.meta.url), 'utf8');
const diagnostics = readFileSync(new URL('../supabase/diagnostics/loan-status-audit-mismatch.sql', import.meta.url), 'utf8');

test('loan edit, bulk write-off, and pay-next go through /loan-status', () => {
  assert.match(html, /if\(!unchanged\)\{\s*const ok=await this\.commitLoanStatus\(mLoanRaw\.id, next, kind/);
  assert.match(html, /writeOffs\.map\(w=>this\.commitLoanStatus\(w\.id, 'written_off'/);
  assert.match(html, /nextInstalmentStep\(nx\.l, nx\.of\)/);
  assert.match(html, /instalmentsPaid: step\.instalmentsPaid/);
  assert.doesNotMatch(html, /setLoanStatus\(nx\.l\.id,'paid'/);
  assert.match(html, /ledAllowPaid/);
  assert.match(html, /statusChoices\(loan\)/);
  assert.match(html, /statusAlreadySaved\(loan, next\)/);
  assert.match(html, /if\(!ok\)\{ this\.setState\(p=>\(\{loans:p\.loans\.map\(l=>l\.id===before\.id\?before:l\)\}\)\)/);
  assert.match(html, /Could not save the loan status/);
  assert.doesNotMatch(html, /delete patch\.principal; delete patch\.instalment/);
  assert.match(html, /delete patch\.status; delete patch\.instalments_paid/);
});

test('the acknowledgement migration adds an idempotent loan foreign key and is not applied here', () => {
  assert.match(migration, /ledger_attention_loan_id_fkey/);
  assert.match(migration, /references public\.loans \(id\)/);
  assert.match(migration, /if not exists/);
  assert.match(diagnostics, /NOT RUN/);
  assert.match(diagnostics, /^--\s*delete from public\.audit_log/im);
});
