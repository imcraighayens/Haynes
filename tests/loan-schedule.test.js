// Shared schedule reader. One reading for Ledger and Quik1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDates, readSchedule, isCollected, labelOfIso } from '../shared/loan-schedule.js';
import { remainingSchedule, accountFromLoans } from '../api/_lib/quik1-book.js';

const REMAINING = {
  id: 'l_synth_sched', ref: 'SYN-SCHED-01', status: 'issued',
  schedule: ['2026-11-25', '2026-12-24', '2027-01-25', '2027-02-25'],
  instalments_paid: 1, prior_instalments: 0, paid_dates: ['2026-10-23']
};

test('a paid date outside the schedule leaves all four dates open', () => {
  const view = readSchedule(REMAINING);
  assert.equal(view.paidInst, 1);
  assert.equal(view.instTotal, 5);
  assert.equal(view.remaining, 4);
  assert.equal(view.instNo, 2);
  assert.equal(view.due, '2026-11-25');
  assert.equal(view.nextDue, '2026-12-24');
  assert.equal(view.promotePaid, false);
  assert.deepEqual(view.open, ['2026-11-25', '2026-12-24', '2027-01-25', '2027-02-25']);
  assert.equal(labelOfIso(view.due), '25 Nov 2026');
  assert.equal(isCollected(REMAINING, '2026-11-25'), false);
  assert.equal(isCollected(REMAINING, '23 Oct 2026'), false);
});

test('Quik1 uses the same open dates for that loan', () => {
  assert.deepEqual(remainingSchedule(REMAINING), ['2026-11-25', '2026-12-24', '2027-01-25', '2027-02-25']);
  const account = accountFromLoans([REMAINING]);
  assert.equal(account.next_due, '2026-11-25');
  assert.deepEqual(account.loans[0].schedule, ['2026-11-25', '2026-12-24', '2027-01-25', '2027-02-25']);
});

test('a paid date that is still on the schedule is not open', () => {
  const loan = {
    status: 'issued', prior_instalments: 2, instalments_paid: 1,
    schedule: ['2026-09-25', '2026-10-23', '2026-11-25'],
    paid_dates: ['2026-09-25']
  };
  const view = readSchedule(loan);
  assert.equal(view.paidInst, 1);
  assert.equal(view.prior, 2);
  assert.equal(view.instNo, 4);
  assert.equal(view.instTotal, 5);
  assert.equal(view.remaining, 2);
  assert.equal(view.due, '2026-10-23');
  assert.equal(view.nextDue, '2026-11-25');
  assert.deepEqual(openDates(loan), ['2026-10-23', '2026-11-25']);
  assert.equal(isCollected(loan, '25 Sep 2026'), true);
  assert.equal(isCollected(loan, '2026-10-23'), false);
});

test('the paid count is not an index when no paid date is stored', () => {
  const loan = {
    status: 'issued', instalments_paid: 2,
    schedule: ['2026-12-25', '2026-11-25', '2027-01-25']
  };
  assert.deepEqual(openDates(loan), ['2026-11-25', '2026-12-25', '2027-01-25']);
  assert.deepEqual(remainingSchedule(loan), ['2026-11-25', '2026-12-25', '2027-01-25']);
  const view = readSchedule(loan);
  assert.equal(view.due, '2026-11-25');
  assert.equal(view.remaining, 3);
  assert.equal(view.paidAhead, 2);
  assert.equal(view.instTotal, 5);
  const overdue = readSchedule({ status: 'overdue', instalments_paid: 4, schedule: [] });
  assert.deepEqual(overdue.open, []);
  assert.equal(overdue.due, '');
  const past = { status: 'overdue', instalments_paid: 1, schedule: ['2026-01-15'] };
  assert.deepEqual(openDates(past), ['2026-01-15']);
  assert.equal(readSchedule(past).due, '2026-01-15');
});

test('a paid loan reports every stored instalment paid and does not invent a date', () => {
  const paid = readSchedule({
    status: 'paid', instalments_paid: 0,
    schedule: ['2026-03-25', '2026-04-25']
  });
  assert.equal(paid.closed, true);
  assert.equal(paid.paidInst, 2);
  assert.equal(paid.remaining, 0);
  assert.equal(paid.due, '2026-04-25');
  assert.equal(paid.nextDue, '');
  assert.deepEqual(paid.open, []);
  const empty = readSchedule({ status: 'written_off', schedule: [], instalments_paid: 0 });
  assert.equal(empty.promotePaid, false);
  assert.equal(empty.instTotal, 0);
  assert.equal(empty.due, '');
  assert.equal(openDates({ schedule: [], instalments_paid: 4 }).length, 0);
});

test('stored dates are kept in order and an unsorted list still picks the earliest open date', () => {
  const loan = { status: 'issued', schedule: ['2026-12-25', '2026-11-25'], instalments_paid: 0, paid_dates: [] };
  assert.deepEqual(readSchedule(loan).schedule, ['2026-12-25', '2026-11-25']);
  assert.equal(readSchedule(loan).due, '2026-11-25');
  assert.equal(readSchedule(null).instTotal, 0);
});
