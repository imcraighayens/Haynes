import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountFromLoans, isSettledStatus } from '../../api/_lib/quik1-book.js';

test('available is largest historical principal minus full open principal', () => {
  const account = accountFromLoans([
    { id: 'l1', ref: 'ECL-1', principal: 3000, status: 'paid', instalments_paid: 1, return_rate_pct: 35 },
    { id: 'l2', ref: 'ECL-2', principal: 1000, status: 'issued', instalments_paid: 2, return_rate_pct: 35, schedule: ['2026-11-20'] }
  ]);
  assert.equal(account.credit_limit, 3000);
  assert.equal(account.outstanding_principal, 1000);
  assert.equal(account.outstanding_interest, 0);
  assert.equal(account.available, 2000);
  assert.equal(account.total_owed, 1000);
  assert.equal(account.next_due, '2026-11-20');
  assert.equal(account.loans.find(l => l.ref === 'ECL-2').outstanding_principal, 1000);
});

test('paid and settled_early put the original principal back into available', () => {
  const account = accountFromLoans([
    { principal: 20737.78, status: 'paid' },
    { principal: 500, status: 'settled_early' }
  ]);
  assert.equal(account.credit_limit, 20737.78);
  assert.equal(account.outstanding_principal, 0);
  assert.equal(account.available, 20737.78);
});

test('settled aliases close the loan and written_off does not', () => {
  assert.equal(isSettledStatus('pif'), true);
  assert.equal(isSettledStatus('closed'), true);
  assert.equal(isSettledStatus('settled'), true);
  assert.equal(isSettledStatus('written_off'), false);
  const account = accountFromLoans([
    { principal: 4000, status: 'written_off' },
    { principal: 1500, status: 'overdue' }
  ]);
  assert.equal(account.credit_limit, 4000);
  assert.equal(account.outstanding_principal, 5500);
  assert.equal(account.available, 0);
});

test('explicit interest is reported and does not change available', () => {
  const account = accountFromLoans([
    { principal: 1000, status: 'issued', interest: 350 }
  ]);
  assert.equal(account.outstanding_principal, 1000);
  assert.equal(account.outstanding_interest, 350);
  assert.equal(account.total_owed, 1350);
  assert.equal(account.available, 0);
  assert.equal(account.credit_limit, 1000);
});
