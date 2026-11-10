import test from 'node:test';
import assert from 'node:assert/strict';
import { firstMissedDue, overdueSince, attentionNote, attentionAmount, attentionHeading, popupKeeps, statusChoices, statusRefusal, nextInstalmentStep } from '../ledger/attention.js';

const TODAY = '2026-11-10';

test('first missed date is the earliest unpaid schedule date before today', () => {
  const loan = {
    status: 'overdue',
    schedule: ['2026-11-25', '2026-08-01', '2026-09-01'],
    paid_dates: ['2026-08-01'],
    due: '—'
  };
  assert.equal(firstMissedDue(loan, TODAY), '2026-09-01');
  assert.equal(attentionNote(loan, TODAY), 'Overdue since 1 Sep 2026');
});

test('an empty schedule uses the failed debit date, then status_at, and never a dash', () => {
  const bare = { status: 'overdue', schedule: [], paid_dates: [], due: '—', status_at: '2026-11-05T08:00:00.000Z' };
  assert.equal(overdueSince(bare, TODAY), '2026-11-05');
  assert.equal(attentionNote(bare, TODAY), 'Overdue since 5 Nov 2026');
  assert.equal(attentionNote(bare, TODAY).includes('—'), false);
  const debit = { ...bare, failedDebit: '2026-11-03', status_at: '2026-11-05T08:00:00.000Z' };
  assert.equal(attentionNote(debit, TODAY), 'Overdue since 3 Nov 2026');
  assert.equal(attentionNote({ status: 'overdue', schedule: [], due: '—' }, TODAY), 'Overdue');
});

test('the popup amount is the instalment or the arrears, not the principal', () => {
  const one = { status: 'overdue', principal: 4050, amount: 4050, instalment_amount: 4140.47, schedule: [], paid_dates: [] };
  assert.equal(attentionAmount(one, TODAY), 4140.47);
  const two = { status: 'overdue', amount: 4050, retAmt: 100, schedule: ['2026-09-01', '2026-10-01', '2026-12-01'], paid_dates: [] };
  assert.equal(attentionAmount(two, TODAY), 200);
  assert.notEqual(attentionAmount(one, TODAY), one.principal);
});

test('the popup keeps a loan until the saved status is paid or settled', () => {
  assert.equal(popupKeeps('overdue'), true);
  assert.equal(popupKeeps('duetoday'), true);
  assert.equal(popupKeeps('paid'), false);
  assert.equal(popupKeeps('settled_early'), false);
  assert.equal(popupKeeps('settled'), false);
  assert.equal(popupKeeps(''), false);
  assert.equal(attentionNote({ status: 'duetoday', due: TODAY }, TODAY), 'Due today');
  assert.equal(firstMissedDue({ schedule: ['2026-08-01'], paid_dates: [], due: '—' }, TODAY), '2026-08-01');
});

test('settled and written-off loans are not offered a paid transition', () => {
  assert.deepEqual(statusChoices('issued'), ['issued', 'duetoday', 'overdue', 'paid']);
  assert.deepEqual(statusChoices('settled_early'), ['issued', 'duetoday', 'overdue']);
  assert.equal(statusChoices('settled_early').includes('paid'), false);
  assert.deepEqual(statusChoices('written_off'), []);
  assert.equal(statusRefusal('written_off', 'paid'), 'A written-off loan cannot change status.');
  assert.equal(statusRefusal('settled_early', 'paid'), 'A settled loan cannot be marked paid.');
  assert.equal(statusRefusal('overdue', 'paid'), '');
});

test('pay next advances one instalment and marks the loan paid only on the last one', () => {
  const first = nextInstalmentStep({ paidInst: 0, dbStatus: 'overdue' }, 3);
  assert.equal(first.instalmentsPaid, 1);
  assert.equal(first.status, 'overdue');
  assert.equal(first.done, false);
  const last = nextInstalmentStep({ paidInst: 2, dbStatus: 'issued' }, 3);
  assert.equal(last.instalmentsPaid, 3);
  assert.equal(last.status, 'paid');
  assert.equal(last.done, true);
});

test('the attention heading is singular for one account', () => {
  assert.equal(attentionHeading(1), '1 account needs attention');
  assert.equal(attentionHeading(0), '0 accounts need attention');
  assert.equal(attentionHeading(2), '2 accounts need attention');
});
