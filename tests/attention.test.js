import test from 'node:test';
import assert from 'node:assert/strict';
import { firstMissedDue, overdueMarker, attentionNote, attentionHeading, ackHolds } from '../ledger/attention.js';

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

test('an overdue loan with no date does not render a dash', () => {
  const loan = { status: 'overdue', schedule: [], paid_dates: [], due: '—', status_at: '2026-10-02T08:00:00.000Z' };
  assert.equal(firstMissedDue(loan, TODAY), '');
  assert.equal(attentionNote(loan, TODAY), 'Overdue — no due date on file');
  assert.equal(overdueMarker(loan, TODAY), 'overdue||2026-10-02T08:00:00.000Z');
});

test('a console label due date is used when the schedule is empty', () => {
  const loan = { status: 'overdue', sched: [], due: '2 Oct 2026', paidDates: [] };
  assert.equal(firstMissedDue(loan, TODAY), '2026-10-02');
  assert.equal(attentionNote(loan, TODAY), 'Overdue since 2 Oct 2026');
});

test('acknowledgement holds until the overdue episode changes', () => {
  const loan = { id: 'l_synth', status: 'overdue', schedule: [], due: '—', status_at: '2026-10-02T08:00:00.000Z' };
  const marker = overdueMarker(loan, TODAY);
  assert.equal(ackHolds(marker, loan, TODAY), true);
  assert.equal(ackHolds(true, loan, TODAY), false);
  assert.equal(ackHolds(marker, { ...loan, status: 'paid' }, TODAY), false);
  assert.equal(ackHolds(marker, { ...loan, status_at: '2026-11-01T08:00:00.000Z' }, TODAY), false);
  assert.equal(attentionNote({ status: 'duetoday', due: TODAY }, TODAY), 'Due today');
});

test('the attention heading is singular for one account', () => {
  assert.equal(attentionHeading(1), '1 account needs attention');
  assert.equal(attentionHeading(0), '0 accounts need attention');
  assert.equal(attentionHeading(2), '2 accounts need attention');
});
