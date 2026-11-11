// NuPay report phase 1. Figures and references are fake. Nothing here is a real client.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  PIF, ACTIVE_HEADERS, headersFor, normHeader, detectHeaders,
  parseCsv, parseMoney, parseDate, classifyStatus, pifQuotes, withinTolerance, amountsAgree,
  maskId, maskPhone, last4, isEmptyStatusGrid, analyseText, analyseBuffer,
  reportToCsv, previewLoan, normalizeLoan, matchBadge, badgeCounts, renderReport
} from '../ledger/nupay-report.js';

const fixture = fs.readFileSync(new URL('./fixtures/nupay/fake_Active_mandate_report.csv', import.meta.url), 'utf8');
const SECRETS = ['0000000000001', '0000000000002', '0000000000003', '1000000001111', '1000000002222', '1000000003333', '0000000001', '0000000002', '0000000003', 'fake1@example.com', 'fake2@example.com', 'fake3@example.com', '000000'];

const book = {
  loans: [
    { id: 'l1', ref: 'FAKE-LN-01', contract_ref: 'FAKE-CR-0001', mandate_id: 'FAKE-M-0001', client_id: 'c1', instalment_amount: 1350, schedule: ['2026-01-25', '2026-02-25', '2026-03-25', '2026-04-25'], instalments_paid: 1, paid_dates: ['2026-01-25'], status: 'issued' },
    { id: 'l2', ref: 'FAKE-LN-02', contract_ref: 'FAKE-CR-0002', mandate_id: 'FAKE-M-0002', client_id: 'c2', instalment_amount: 1350, schedule: ['2026-01-25', '2026-02-25'], instalments_paid: 2, paid_dates: ['2026-01-25', '2026-02-25'], status: 'settled_early' },
    { id: 'l3', ref: 'FAKE-LN-03', contract_ref: 'FAKE-CR-0003', client_id: 'c3', instalment_amount: 400, schedule: ['2026-05-25'], instalments_paid: 0, paid_dates: [], status: 'written_off', deleted_at: '2026-06-01T00:00:00Z' },
    { id: 'l4', ref: 'FAKE-LN-04', contract_ref: 'FAKE-CR-0004', mandate_id: 'OTHER-M', client_id: 'c4', instalment_amount: 1350, schedule: ['2026-06-25'], instalments_paid: 0, paid_dates: [], status: 'paid' }
  ],
  clients: [
    { id: 'c1', ref: 'FAKE-CL-01', name: 'Book Client One' },
    { id: 'c2', ref: 'FAKE-CL-02', name: 'Book Client Two' },
    { id: 'c3', ref: 'FAKE-CL-03', name: 'Book Client Three', mandate_ref: 'FAKE-M-0003' },
    { id: 'c4', ref: 'FAKE-CL-04', name: 'Book Client Four' },
    { id: 'c5', ref: 'FAKE-CL-05', name: 'Book Client Five' }
  ],
  mandates: []
};

function assertNoSecrets(text) {
  for (const secret of SECRETS) assert.equal(text.includes(secret), false, secret);
}

function zipFiles(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const raw = Buffer.from(file.data);
    const comp = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(Buffer.concat([local, comp]));
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

test('header detection ignores case, spacing, and column order', () => {
  assert.equal(normHeader('  CONTRACT_REFERENCE '), 'contract reference');
  assert.equal(normHeader('Acc. Number'), 'acc number');
  assert.equal(normHeader('Mandate   ID'), 'mandate id');
  const shuffled = ['Email', 'Status', 'client reference', 'AMOUNT', 'Action Date', 'Mandate ID', 'Id', 'Contract   Reference'];
  const found = detectHeaders(shuffled);
  assert.equal(found.recognized, true);
  assert.equal(shuffled[found.fields.contractReference], 'Contract   Reference');
  assert.equal(shuffled[found.fields.mandateId], 'Mandate ID');
  assert.equal(shuffled[found.fields.clientReference], 'client reference');
  assert.equal(shuffled[found.fields.debitAmount], 'AMOUNT');
  assert.equal(shuffled[found.fields.actionDate], 'Action Date');
  assert.equal(found.fields.contractReference > found.fields.mandateId, true);
});

test('the Active mandate header is 52 columns and the other files differ where NuPay differs', () => {
  assert.equal(ACTIVE_HEADERS.length, 52);
  const header = fixture.split(/\r?\n/)[0];
  assert.deepEqual(header.split(','), ACTIVE_HEADERS);
  const maxAt = ACTIVE_HEADERS.indexOf('Max Collection Amount');
  assert.deepEqual(ACTIVE_HEADERS.slice(maxAt + 1, maxAt + 3), ['Total Contract Amount', 'Future Collections Total Amount']);
  for (const kind of ['in_active', 'pending', 'rejected', 'suspended']) {
    assert.equal(headersFor(kind).includes('Total Contract Amount'), false);
    assert.equal(headersFor(kind).includes('Future Collections Total Amount'), false);
  }
  const inactive = headersFor('in_active');
  const rejected = headersFor('rejected');
  const pending = headersFor('pending');
  assert.equal(inactive.length, 52);
  assert.equal(rejected.length, 52);
  assert.equal(pending.length, 50);
  assert.equal(headersFor('suspended').length, 50);
  assert.deepEqual(inactive.slice(inactive.indexOf('Migrated') - 2, inactive.indexOf('Migrated')), ['Status Code', 'Status Code Description']);
  assert.deepEqual(rejected.slice(rejected.indexOf('Migrated') - 2, rejected.indexOf('Migrated')), ['Rejected Reason', 'Rejected Reason Description']);
  assert.equal(detectHeaders(rejected).fields.reason, rejected.indexOf('Rejected Reason Description'));
});

test('an empty status file is a headerless row of commas and zeros', () => {
  assert.equal(isEmptyStatusGrid(parseCsv(',,,,,0,0,0')), true);
  assert.equal(isEmptyStatusGrid(parseCsv('0,0,0,0')), true);
  assert.equal(isEmptyStatusGrid(parseCsv('')), true);
  const report = analyseText(',,,,,0,0,0\n', book);
  assert.equal(report.empty, true);
  assert.equal(report.rows.length, 0);
  assert.equal(report.needsMapping, false);
});

test('CSV parsing keeps quoted commas and reads the fake Active fixture', () => {
  const quoted = parseCsv('Contract Reference,Name,Amount\n"FAKE-CR-0001","Sample, Client","1 380.16"\n');
  assert.equal(quoted[1][1], 'Sample, Client');
  assert.equal(parseMoney(quoted[1][2]), 1380.16);
  assert.equal(parseMoney('1,234'), 1234);
  assert.equal(parseMoney('1.234'), 1234);
  assert.equal(parseMoney('1.234,56'), 1234.56);
  assert.equal(parseMoney('1,234.56'), 1234.56);
  assert.equal(parseMoney('1,234.567'), null);
  assert.equal(parseMoney('1.23.45'), null);
  assert.equal(parseDate('25/02/2026'), '2026-02-25');
  assert.equal(parseDate('25 Feb 2026'), '2026-02-25');
  const lines = fixture.trim().split(/\n/);
  assert.equal(lines.length, 4);
  const report = analyseText(fixture, book);
  assert.equal(report.rows.length, 3);
  const first = report.rows[0];
  assert.equal(first.contractReference, 'FAKE-CR-0001');
  assert.equal(first.mandateId, 'FAKE-M-0001');
  assert.equal(first.clientReference, 'FAKE-CL-01');
  assert.equal(first.originalAmount, 1350);
  assert.equal(first.pifValue, 30.16);
  assert.equal(first.totalAmount, 1380.16);
  assert.equal(first.instalmentAmount, 1380.16);
  assert.equal(first.note, 'date unreadable');
  assert.equal(first.amountOk, true);
  assert.notEqual(first.outcome, 'matched');
  assert.equal(matchBadge(first).label, 'Loan found');
  assert.equal(first.how, 'contract');
  const small = report.rows[1];
  assert.equal(small.originalAmount, 400);
  assert.equal(small.pifValue, 10.93);
  assert.equal(small.outcome, 'mismatched');
  const third = report.rows[2];
  assert.equal(third.how, 'contract');
  assert.equal(third.outcome, 'mismatched');
  assert.equal(third.amountOk, false);
  assertNoSecrets(JSON.stringify(report));
  assert.equal(JSON.stringify(report).includes('fake1@example.com'), false);
});

test('PIF is 2.234 percent of the original with an R10.93 floor, both configurable', () => {
  assert.equal(PIF.rate, 0.02234);
  assert.equal(PIF.flat, 10.93);
  assert.equal(PIF.tolerance, 0.05);
  const big = pifQuotes(1350);
  assert.equal(big.usesFloor, false);
  assert.equal(big.pif, 30.16);
  assert.equal(big.debit, 1380.16);
  const small = pifQuotes(400);
  assert.equal(small.usesFloor, true);
  assert.equal(small.pif, 10.93);
  assert.equal(small.debit, 410.93);
  assert.equal(withinTolerance(1380.16, 1380.21), true);
  assert.equal(withinTolerance(1380.16, 1380.22), false);
});

test('the expected debit uses the R10.93 floor below about R489 and 2.234% above it', () => {
  const below = pifQuotes(400);
  assert.equal(below.debit, 410.93);
  assert.equal(amountsAgree({ debitAmount: 410.93 }, 400).ok, true);
  assert.equal(amountsAgree({ debitAmount: 410.98 }, 400).ok, true);
  assert.equal(amountsAgree({ debitAmount: 410.99 }, 400).ok, false);
  assert.equal(amountsAgree({ debitAmount: 408.94 }, 400).ok, false);
  const above = pifQuotes(1350);
  assert.equal(above.debit, 1380.16);
  assert.equal(amountsAgree({ debitAmount: 1380.16 }, 1350).ok, true);
  assert.equal(amountsAgree({ debitAmount: 1380.11 }, 1350).ok, true);
  assert.equal(amountsAgree({ debitAmount: 1380.10 }, 1350).ok, false);
  assert.equal(amountsAgree({ debitAmount: 1360.93 }, 1350).ok, false);
  const atFloor = pifQuotes(489);
  assert.equal(atFloor.usesFloor, true);
  assert.equal(atFloor.debit, 499.93);
  const aboveFloor = pifQuotes(490);
  assert.equal(aboveFloor.usesFloor, false);
  assert.equal(aboveFloor.debit, 500.95);
  assert.equal(amountsAgree({ debitAmount: 499.93 }, 489).ok, true);
  assert.equal(amountsAgree({ debitAmount: 489 + 10.93 }, 490).ok, false);
});

test('matching uses contract, then mandate, then client reference, including settled and deleted loans', () => {
  const csv = [
    'Status,Debit Amount,Client Reference,Transaction Date,Mandate ID,Contract Reference',
    'Success,1380.16,FAKE-CL-01,2026-02-25,FAKE-M-NOPE,FAKE-CR-0001',
    'Success,1380.16,FAKE-CL-02,2026-01-25,FAKE-M-0002,FAKE-CR-MISSING',
    'Success,410.93,FAKE-CL-03,2026-05-25,,',
    'Success,1380.16,FAKE-CL-09,2026-02-25,FAKE-M-NO,FAKE-CR-NO',
    'Success,100.00,FAKE-CL-01,2026-03-25,FAKE-M-0001,FAKE-CR-0001',
    'Success,1380.16,FAKE-CL-02,2026-01-25,FAKE-M-0002,FAKE-CR-0002'
  ].join('\n');
  const report = analyseText(csv, book);
  assert.equal(report.rows[0].how, 'contract');
  assert.equal(report.rows[0].loanId, 'l1');
  assert.equal(report.rows[0].outcome, 'matched');
  assert.equal(report.rows[1].how, 'mandate');
  assert.equal(report.rows[1].loanId, 'l2');
  assert.equal(report.rows[2].how, 'client');
  assert.equal(report.rows[2].loanId, 'l3');
  assert.equal(report.rows[2].outcome, 'matched');
  assert.equal(report.rows[3].outcome, 'unknown');
  assert.equal(report.rows[4].outcome, 'mismatched');
  assert.equal(report.rows[4].amountOk, false);
  assert.equal(report.rows[5].outcome, 'matched');
  assert.equal(report.rows[5].loanId, 'l2');
  assert.equal(report.summary.matched, 4);
  assert.equal(report.summary.mismatched, 1);
  assert.equal(report.summary.unknown, 1);
  const settled = report.groups.find(g => g.loanId === 'l2');
  const deleted = report.groups.find(g => g.loanId === 'l3');
  assert.equal(settled.settled, true);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.writtenOff, true);
});

test('a date off the schedule is a mismatch, and a debit is not compared with the raw instalment', () => {
  const csv = [
    'Contract Reference,Action Date,Amount,Status,Original Amount',
    'FAKE-CR-0001,2026-02-26,1.00,Success,1350.00',
    'FAKE-CR-0001,2026-02-25,1350.00,Success,',
    'FAKE-CR-0001,2026-02-25,1380.16,Success,',
    'FAKE-CR-0003,2026-05-25,410.93,Success,',
    'FAKE-CR-0003,2026-05-25,408.94,Success,'
  ].join('\n');
  const report = analyseText(csv, book);
  assert.equal(report.rows[0].outcome, 'mismatched');
  assert.equal(report.rows[0].dateOk, false);
  assert.equal(report.rows[0].amountOk, true);
  assert.equal(report.rows[1].outcome, 'mismatched');
  assert.equal(report.rows[1].amountOk, false);
  assert.equal(report.rows[2].outcome, 'matched');
  assert.equal(report.rows[3].outcome, 'matched');
  assert.equal(report.rows[4].outcome, 'mismatched');
  assert.equal(report.rows[4].amountOk, false);
});

test('Success adds a paid date, reversals remove one, and the other statuses do not pay', () => {
  const csv = [
    'Contract Reference,Transaction Date,Debit Amount,Status',
    'FAKE-CR-0001,2026-01-25,1380.16,Reversed',
    'FAKE-CR-0001,2026-02-25,1380.16,Success',
    'FAKE-CR-0001,2026-03-25,1380.16,Failed',
    'FAKE-CR-0001,2026-03-25,1380.16,In Tracking',
    'FAKE-CR-0001,2026-04-25,1380.16,Future',
    'FAKE-CR-0001,2026-03-25,1380.16,Cancelled',
    'FAKE-CR-0001,2026-04-25,1380.16,Disputed'
  ].join('\n');
  const report = analyseText(csv, book);
  const group = report.groups.find(g => g.loanId === 'l1');
  assert.deepEqual(group.preview.paid_dates, ['2026-02-25']);
  assert.equal(group.preview.instalments_paid, 1);
  assert.equal(classifyStatus('Disputed'), 'disputed');
  assert.equal(classifyStatus('In Tracking'), 'tracking');
  const effects = report.rows.map(r => r.effect);
  assert.deepEqual(effects, ['reverse', 'pay', 'none', 'none', 'none', 'none', 'reverse']);
  const loan = normalizeLoan(book.loans[0]);
  const onlyDispute = previewLoan(loan, [{ effect: 'reverse', outcome: 'matched', actionDate: '2026-08-01', statusKind: 'disputed', line: 1 }]);
  assert.equal(onlyDispute.instalments_paid, 1);
  assert.deepEqual(onlyDispute.paid_dates, ['2026-01-25']);
  const statuses = Object.fromEntries(report.summary.byStatus.map(s => [s.status, s.count]));
  assert.equal(statuses.Success, 1);
  assert.equal(statuses.Failed, 1);
  assert.equal(statuses['In tracking'], 1);
  assert.equal(statuses.Future, 1);
  assert.equal(statuses.Cancelled, 1);
  assert.equal(statuses.Reversed, 1);
  assert.equal(statuses.Disputed, 1);
});

test('only a Success row can wear the green Matched badge', () => {
  const csv = [
    'Contract Reference,Transaction Date,Debit Amount,Status',
    'FAKE-CR-0001,2026-02-25,1380.16,Success',
    'FAKE-CR-0001,2026-01-25,1380.16,Reversed',
    'FAKE-CR-0001,2026-03-25,1380.16,In Tracking',
    'FAKE-CR-0001,2026-04-25,1380.16,Future',
    'FAKE-CR-0003,2026-05-25,410.93,Disputed',
    'FAKE-CR-0001,2026-03-25,1380.16,Failed',
    'FAKE-CR-0002,2026-01-25,100.00,Success',
    'FAKE-CR-4040,2026-02-25,1380.16,Failed'
  ].join('\n');
  const report = analyseText(csv, book);
  const byStatus = Object.fromEntries(report.rows.map(row => [row.statusKind + ':' + row.outcome, matchBadge(row)]));
  assert.deepEqual(byStatus['success:matched'], { label: 'Matched', tone: 'ok' });
  for (const kind of ['reversed', 'tracking', 'future', 'disputed', 'failed']) {
    assert.deepEqual(byStatus[kind + ':matched'], { label: 'Loan found', tone: 'neutral' }, kind);
  }
  assert.deepEqual(byStatus['success:mismatched'], { label: 'Mismatched', tone: 'warn' });
  assert.deepEqual(byStatus['failed:unknown'], { label: 'Unknown', tone: 'neutral' });
  assert.equal(report.rows.find(row => row.statusKind === 'reversed').outcome, 'matched');
});

test('tile counts equal the badge counts, and a non-success is never Matched', () => {
  const fixed = analyseText(fixture, book);
  assert.deepEqual(fixed.summary.tiles, badgeCounts(fixed.rows));
  assert.equal(fixed.summary.matched + fixed.summary.loanFound + fixed.summary.mismatched + fixed.summary.unknown, fixed.rows.length);
  const id = '0000001111111';
  const phone = '0830001111';
  const email = 'secret.person@example.com';
  const account = '998877665544';
  const csv = [
    'Contract Reference,Transaction Date,Debit Amount,Status,Id,Phone Number,Email,Acc. Number',
    'FAKE-CR-0001,2026-02-25,1380.16,Success,' + [id, phone, email, account].join(','),
    'FAKE-CR-0001,2026-01-25,1380.16,Reversed,' + [id, phone, email, account].join(','),
    'FAKE-CR-0001,2026-03-25,1380.16,Failed,' + [id, phone, email, account].join(','),
    'FAKE-CR-0001,2026-03-25,1380.16,In Tracking,' + [id, phone, email, account].join(','),
    'FAKE-CR-0001,2026-04-25,1380.16,Future,' + [id, phone, email, account].join(','),
    'FAKE-CR-0003,2026-05-25,410.93,Disputed,' + [id, phone, email, account].join(',')
  ].join('\n');
  const piiBook = {
    loans: book.loans.map(loan => ({ ...loan, id: 'db-loan-9f3a-' + loan.id, client_id: 'db-client-9f3a-' + loan.client_id })),
    clients: book.clients.map(client => ({ ...client, id: 'db-client-9f3a-' + client.id })),
    mandates: []
  };
  const report = analyseText(csv, piiBook);
  const counts = badgeCounts(report.rows);
  assert.deepEqual(report.summary.tiles, counts);
  assert.equal(counts.Matched + counts['Loan found'] + counts.Mismatched + counts.Unknown, report.rows.length);
  const never = ['reversed', 'failed', 'tracking', 'future', 'disputed'];
  for (const row of report.rows) {
    if (never.includes(row.statusKind)) assert.notEqual(matchBadge(row).label, 'Matched', row.statusKind);
  }
  assert.equal(counts.Matched, report.rows.filter(row => row.statusKind === 'success' && row.outcome === 'matched').length);
  const exported = reportToCsv(report);
  const header = exported.split('\n')[0].toLowerCase();
  for (const column of ['phone', 'email', 'account', 'loan_id', 'client_id', 'id_number', 'branch']) {
    assert.equal(header.includes(column), false, column);
  }
  for (const secret of [id, phone, email, account, 'db-loan-9f3a', 'db-client-9f3a']) {
    assert.equal(exported.includes(secret), false, secret);
  }
  const lines = exported.trim().split('\n').slice(1);
  report.rows.forEach((row, index) => assert.equal(lines[index].split(',')[0], matchBadge(row).label));
  assert.match(exported, /FAKE-LN-01/);
  assert.match(exported, /Loan found/);
});

function miniDocument() {
  function Node(tag) {
    this.tag = tag || '';
    this.children = [];
    this.attrs = {};
    this._class = '';
    this._id = '';
    this._text = '';
  }
  Node.prototype.appendChild = function (child) { this.children.push(child); return child; };
  Node.prototype.append = function (...nodes) { nodes.forEach(node => this.appendChild(node)); };
  Object.defineProperty(Node.prototype, 'className', {
    get() { return this._class; },
    set(value) { this._class = String(value); this.attrs.class = this._class; }
  });
  Object.defineProperty(Node.prototype, 'id', {
    get() { return this._id; },
    set(value) { this._id = String(value); this.attrs.id = this._id; }
  });
  Object.defineProperty(Node.prototype, 'textContent', {
    get() { return this._text + this.children.map(child => child.textContent || '').join(''); },
    set(value) { this._text = value == null ? '' : String(value); this.children = []; }
  });
  Node.prototype.setAttribute = function (name, value) {
    this.attrs[name] = String(value);
    if (name === 'id') this._id = String(value);
    if (name === 'title') this.attrs.title = String(value);
  };
  Node.prototype.getAttribute = function (name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; };
  const document = {
    createElement(tag) { return new Node(tag); },
    createTextNode(text) { const node = new Node(''); node.textContent = text; return node; }
  };
  return { document, root: new Node('div') };
}

function renderedBlob(node, bag) {
  bag.push(node._text || '');
  for (const [name, value] of Object.entries(node.attrs || {})) bag.push(name + '=' + value);
  for (const child of node.children || []) renderedBlob(child, bag);
  return bag;
}

test('a numeric mandate stays raw for matching and is masked everywhere it is shown', () => {
  const mandate = '4829103372614';
  const otherMandate = '7731002948156';
  const idNumber = '9001015800081';
  const account = '620184739201';
  const phone = '0825550143';
  const email = 'nobody.numeric@example.com';
  const csv = [
    'Contract Reference,Mandate ID,Client Reference,Transaction Date,Debit Amount,Status,Id,Acc. Number,Phone Number,Email',
    ',' + [mandate, '', '2026-02-25', '1380.16', 'Success', idNumber, account, phone, email].join(','),
    ['FAKE-CR-0099', otherMandate, 'FAKE-CL-99', '2026-03-25', '1380.16', 'Success', idNumber, account, phone, email].join(',')
  ].join('\n');
  const numericBook = {
    loans: [{ id: 'l-num', ref: 'FAKE-LN-99', contract_ref: 'FAKE-CR-0099', mandate_id: mandate, client_id: 'c-num', instalment_amount: 1350, schedule: ['2026-01-25', '2026-02-25', '2026-03-25', '2026-04-25'], instalments_paid: 1, paid_dates: ['2026-01-25'], status: 'issued' }],
    clients: [{ id: 'c-num', ref: 'FAKE-CL-99', name: 'Numeric Sample' }],
    mandates: []
  };
  const report = analyseText(csv, numericBook);
  assert.equal(report.rows[0].how, 'mandate');
  assert.equal(report.rows[0].mandateId, mandate);
  assert.equal(report.rows[0].outcome, 'matched');
  assert.equal(report.rows[0].loanId, 'l-num');
  assert.equal(report.rows[1].how, 'contract');
  assert.equal(report.rows[1].mandateId, otherMandate);
  const exported = reportToCsv(report);
  assert.equal(exported.includes(mandate), false);
  assert.equal(exported.includes(otherMandate), false);
  assert.equal(exported.includes(idNumber), false);
  assert.equal(exported.includes(account), false);
  assert.equal(exported.includes(phone), false);
  assert.equal(exported.includes(email), false);
  assert.equal(exported.includes(maskId(mandate)), true);
  assert.equal(exported.includes(maskId(otherMandate)), true);
  const header = exported.trim().split('\n')[0].split(',');
  const allowed = new Set(['action_date', 'debit_amount', 'original_amount', 'pif_value', 'instalment_amount', 'instalment_number', 'book_instalments_paid', 'preview_instalments_paid', 'book_paid_dates', 'preview_paid_dates', 'book_outstanding']);
  const kept = [];
  for (const line of exported.trim().split('\n').slice(1)) {
    const cells = line.split(',');
    header.forEach((name, index) => {
      const value = cells[index] || '';
      if (allowed.has(name)) kept.push(value);
      else assert.equal(/\d{5,}/.test(value), false, name + ' ' + value);
    });
  }
  let rest = exported;
  for (const value of kept) rest = rest.split(value).join('');
  assert.equal(/\d{5,}/.test(rest), false, rest);
  const view = miniDocument();
  renderReport(view.root, report, view.document);
  const blob = renderedBlob(view.root, []).join('\n');
  assert.equal(blob.includes(mandate), false);
  assert.equal(blob.includes(otherMandate), false);
  assert.equal(blob.includes(idNumber), false);
  assert.equal(blob.includes(account), false);
  assert.match(blob, /Mandate /);
  assert.match(blob, /2614/);
  assert.equal(blob.includes('title=' + mandate), false);
});

test('the live mock book shows every NuPay row state, with the mandate masked', () => {
  const state = JSON.parse(fs.readFileSync(new URL('./fixtures/state.json', import.meta.url), 'utf8'));
  const csv = fs.readFileSync(new URL('./fixtures/nupay/fake_live_book_report.csv', import.meta.url), 'utf8');
  const book = { loans: state.loans, clients: state.clients, mandates: state.mandates || [] };
  const report = analyseText(csv, book);
  assert.ok(report.summary.matched >= 1, 'matched');
  assert.ok(report.summary.loanFound >= 1, 'loan found');
  assert.ok(report.summary.mismatched >= 1, 'mismatched');
  assert.ok(report.summary.unknown >= 1, 'unknown');
  assert.ok(report.summary.byStatus.some(bucket => bucket.status === 'Pending' && bucket.count >= 1), 'pending');
  const labels = report.rows.map(row => matchBadge(row).label);
  assert.ok(labels.includes('Matched'));
  assert.ok(labels.includes('Loan found'));
  assert.ok(labels.includes('Mismatched'));
  assert.ok(labels.includes('Unknown'));
  assert.equal(report.rows.find(row => row.statusKind === 'pending').outcome === 'matched' && matchBadge(report.rows.find(row => row.statusKind === 'pending')).label === 'Loan found', true);
  const mandate = '90000001';
  assert.equal(report.rows.some(row => row.mandateId === mandate), true);
  const exported = reportToCsv(report);
  for (const secret of ['90000001', '90000002', '90000003', '90000004', '90000999', '9001015800081', '620184739201', '0825550143', 'nobody.live@example.com']) {
    assert.equal(exported.includes(secret), false, secret);
  }
  assert.equal(exported.includes(maskId(mandate)), true);
  const view = miniDocument();
  renderReport(view.root, report, view.document);
  const blob = renderedBlob(view.root, []).join('\n');
  assert.equal(blob.includes(mandate), false);
  assert.match(blob, /Pending/);
  assert.match(blob, /Matched/);
  assert.match(blob, /Loan found/);
  assert.match(blob, /Mismatched/);
  assert.match(blob, /Unknown/);
  assert.match(blob, /Mandate /);
});

test('an unknown row does not show or export the file name', () => {
  const name = 'Zelda Quillwright';
  const csv = [
    'Contract Reference,Transaction Date,Debit Amount,Status,Name',
    'FAKE-CR-NOPE,2026-02-25,1380.16,Success,' + name
  ].join('\n');
  const report = analyseText(csv, book);
  assert.equal(report.rows[0].outcome, 'unknown');
  const exported = reportToCsv(report);
  assert.equal(exported.includes(name), false);
  assert.equal(exported.split('\n')[1].split(',').includes(name), false);
  const header = exported.split('\n')[0].split(',');
  const nameAt = header.indexOf('book_client_name');
  assert.equal(exported.trim().split('\n')[1].split(',')[nameAt], '');
  const view = miniDocument();
  renderReport(view.root, report, view.document);
  const blob = renderedBlob(view.root, []).join('\n');
  assert.equal(blob.includes(name), false);
});

test('a shared mandate is not matched, and a contradicting client ref is not matched', () => {
  const shared = {
    loans: [
      { id: 'a', ref: 'FAKE-LN-A', mandate_id: '555000111222', client_id: 'ca', instalment_amount: 1350, schedule: ['2026-02-25'], instalments_paid: 0, paid_dates: [], status: 'issued' },
      { id: 'b', ref: 'FAKE-LN-B', mandate_id: '555000111222', client_id: 'cb', instalment_amount: 1350, schedule: ['2026-02-25'], instalments_paid: 0, paid_dates: [], status: 'issued' },
      { id: 'c', ref: 'FAKE-LN-C', mandate_id: '555000333444', client_id: 'ca', instalment_amount: 1350, schedule: ['2026-02-25'], instalments_paid: 0, paid_dates: [], status: 'issued' }
    ],
    clients: [
      { id: 'ca', ref: 'FAKE-CL-A', name: 'Client A' },
      { id: 'cb', ref: 'FAKE-CL-B', name: 'Client B' }
    ],
    mandates: []
  };
  const csv = [
    'Mandate ID,Client Reference,Transaction Date,Debit Amount,Status',
    '555000111222,FAKE-CL-B,2026-02-25,1380.16,Success',
    '555000333444,FAKE-CL-B,2026-02-25,1380.16,Success'
  ].join('\n');
  const report = analyseText(csv, shared);
  assert.equal(report.rows[0].how, 'mandate-ambiguous');
  assert.equal(report.rows[0].loanId, '');
  assert.notEqual(matchBadge(report.rows[0]).label, 'Matched');
  assert.notEqual(report.rows[0].loanId, 'a');
  assert.equal(report.rows[1].how, 'client-mismatch');
  assert.equal(report.rows[1].loanId, 'c');
  assert.equal(report.rows[1].note, 'client mismatch');
  assert.notEqual(report.rows[1].outcome, 'matched');
  assert.equal(matchBadge(report.rows[1]).label, 'Loan found');
});

test('a Success row with an unreadable date is not Matched', () => {
  const csv = [
    'Contract Reference,Transaction Date,Debit Amount,Status',
    'FAKE-CR-0001,not-a-date,1380.16,Success',
    'FAKE-CR-0001,,1380.16,Success'
  ].join('\n');
  const report = analyseText(csv, book);
  for (const row of report.rows) {
    assert.equal(row.note, 'date unreadable');
    assert.notEqual(row.outcome, 'matched');
    assert.equal(matchBadge(row).label, 'Loan found');
  }
});

test('manual mapping is used when the headers are not recognised', () => {
  const csv = 'Foo,Bar,Baz,Qux\nFAKE-CR-0001,2026-02-25,1380.16,Success\n';
  const unread = analyseText(csv, book);
  assert.equal(unread.needsMapping, true);
  assert.equal(unread.rows.length, 0);
  const report = analyseText(csv, book, { mapping: { contractReference: 0, actionDate: 1, debitAmount: 2, status: 3 } });
  assert.equal(report.needsMapping, false);
  assert.equal(report.rows[0].outcome, 'matched');
  assert.equal(report.rows[0].loanId, 'l1');
});

test('the match CSV leaves out id, phone, email, account, and branch', () => {
  const report = analyseText(fixture, book);
  const csv = reportToCsv(report);
  assert.match(csv, /FAKE-CR-0001/);
  assert.match(csv, /Book Client One/);
  assert.equal(csv.includes('FAKE-M-0001'), false);
  assert.equal(csv.includes('FAKE-M-0002'), false);
  assert.equal(csv.includes('FAKE-M-0003'), false);
  assert.match(csv, /••••0001/);
  assertNoSecrets(csv);
  assert.equal(csv.includes('Sample Client'), false);
  assert.equal(maskId('0000000000001').endsWith('0001'), true);
  assert.equal(maskId('0000000000001').includes('0000000000001'), false);
  assert.equal(maskPhone('0000000001').endsWith('0001'), true);
  assert.equal(last4('1000000001111'), '••••1111');
});

test('xlsx and a MandateReport zip are read in the browser parser', async () => {
  const headers = ['Mandate ID', 'Contract Reference', 'Transaction Date', 'Debit Amount', 'Status'];
  const strings = headers.concat(['FAKE-M-0001', 'FAKE-CR-0001', '2026-02-25', '1380.16', 'Success']);
  const sst = '<sst>' + strings.map(s => '<si><t>' + s + '</t></si>').join('') + '</sst>';
  const letters = 'ABCDE';
  const cells = (row, indexes) => indexes.map((n, i) => '<c r="' + letters[i] + row + '" t="s"><v>' + n + '</v></c>').join('');
  const sheet = '<worksheet><sheetData><row r="1">' + cells(1, [0, 1, 2, 3, 4]) + '</row><row r="2">' + cells(2, [5, 6, 7, 8, 9]) + '</row></sheetData></worksheet>';
  const xlsx = zipFiles([
    { name: 'xl/sharedStrings.xml', data: sst },
    { name: 'xl/worksheets/sheet1.xml', data: sheet }
  ]);
  const fromXlsx = await analyseBuffer(xlsx, 'fake-transactions.xlsx', book);
  assert.equal(fromXlsx.rows.length, 1);
  assert.equal(fromXlsx.rows[0].outcome, 'matched');
  assert.equal(fromXlsx.rows[0].actionDate, '2026-02-25');

  const stamp = '20261110230000';
  const active = fixture;
  const empty = ',,,,,0,0,0\n';
  const zip = zipFiles([
    { name: 'Active_' + stamp + '.csv', data: active },
    { name: 'In_Active_' + stamp + '.csv', data: empty },
    { name: 'Pending_Authorisation_' + stamp + '.csv', data: empty },
    { name: 'Rejected_Authorisation_' + stamp + '.csv', data: empty },
    { name: 'Suspended_' + stamp + '.csv', data: empty }
  ]);
  const fromZip = await analyseBuffer(zip, 'MandateReport_' + stamp + '.zip', book);
  assert.equal(fromZip.rows.length, 3);
  assert.equal(fromZip.sources.find(s => s.role === 'in_active').rows, 0);
  assert.equal(fromZip.sources.find(s => s.role === 'active').rows, 3);
  assertNoSecrets(JSON.stringify(fromZip));
});

test('the page mounts the report without a write path', () => {
  const html = fs.readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');
  const src = fs.readFileSync(new URL('../ledger/nupay-report.js', import.meta.url), 'utf8');
  assert.match(html, /id="nupay-report-mount"/);
  assert.match(html, /src="\.\/nupay-report\.js"/);
  assert.match(html, /id="nupay-tab-drop"/);
  assert.match(html, /reportTab==='nupay'/);
  assert.match(src, /Loan found, no matched payment yet/);
  assert.match(src, /Loan found, amount or date doesn't agree/);
  assert.equal(src.includes('localStorage'), false);
  assert.equal(src.includes('fetch('), false);
  assert.equal(src.includes('indexedDB'), false);
  assert.match(src, /Preview only/);
  assert.match(src, /Nothing is uploaded/);
  assert.equal(/apply to the book/i.test(src), false);
});
