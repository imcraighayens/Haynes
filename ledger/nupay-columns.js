// NuPay column map for the read-only Ledger report.
//
// Matching never uses column order. Headers are matched by alias, case- and
// space-insensitive, because NuPay lets a merchant show or hide columns.
//
// The Active mandate export is 52 columns. The other status files share that
// layout with two differences:
//   - only Active has "Total Contract Amount" and "Future Collections Total
//     Amount", and they sit immediately after "Max Collection Amount";
//   - In_Active inserts "Status Code" and "Status Code Description" immediately
//     before "Migrated";
//   - Rejected inserts "Rejected Reason" and "Rejected Reason Description"
//     immediately before "Migrated".
//
// Transaction-report headers are still unconfirmed. Those aliases live below
// the mandate names. PIF rate and the flat floor are the numbers NuPay can change.

export const PIF = {
  rate: 0.02234,
  flat: 10.93,
  tolerance: 0.05
};

export const ACTIVE_HEADERS = [
  'Token',
  'Card Acceptor',
  'Mandate ID',
  'Contract Reference',
  'Client Reference',
  'Name',
  'Id',
  'Bank',
  'Branch Number',
  'Acc. Number',
  'Account Type',
  'Instalment Amount',
  'Max Collection Amount',
  'Total Contract Amount',
  'Future Collections Total Amount',
  'Frequency',
  'Collection Day',
  'Date of First Instalment',
  'Instalments',
  'Tracking Indicator',
  'Date Adjustment Rule Indicator',
  'Debit Value Type',
  'Mandate Type',
  'Authentication Type',
  'Entry Class',
  'First Collection Amount',
  'Adjustment Category',
  'Adjustment Amount',
  'Adjustment Rate',
  'Original Amount',
  'PIF Value',
  'Total Amount',
  'Date Loaded',
  'Date Authorised',
  'Status',
  'Active',
  'Cancellation Reason',
  'Cancellation Date',
  'Employer Code',
  'Phone Number',
  'Email',
  'Creditor Scheme',
  'Creditor Name',
  'Creditor Abbreviated Name',
  'Initiating Party',
  'Ultimate Creditor',
  'User Reference',
  'Record ID',
  'Creation Date',
  'Last Updated',
  'Loaded By',
  'Migrated'
];

export const ACTIVE_ONLY_HEADERS = ['Total Contract Amount', 'Future Collections Total Amount'];
export const IN_ACTIVE_HEADERS = ['Status Code', 'Status Code Description'];
export const REJECTED_HEADERS = ['Rejected Reason', 'Rejected Reason Description'];

// File columns that are personal. They are never rendered raw, logged, or exported.
export const PII_HEADERS = ['Name', 'Id', 'Acc. Number', 'Branch Number', 'Phone Number', 'Email'];

// Shown in the UI only to identify a client. Email and branch are dropped entirely.
export const PII_SHOW = {
  name: 'book-or-unknown',
  id: 'mask',
  account: 'last4',
  phone: 'mask'
};

export const FIELD_ALIASES = {
  contractReference: ['contract reference', 'contract ref', 'contract id', 'contract number'],
  mandateId: ['mandate id', 'mandate reference', 'mandate ref', 'mandate number', 'nupay mandate'],
  clientReference: ['client reference', 'client ref', 'client no', 'client number', 'debtor reference'],
  name: ['name', 'client name', 'account name', 'debtor name', 'debtor account name'],
  idNumber: ['id', 'id number', 'id no', 'identity number', 'debtor id', 'debtor id number'],
  accountNumber: ['acc number', 'account number', 'account no', 'debtor account number'],
  branchNumber: ['branch number', 'branch code', 'debtor branch number'],
  phone: ['phone number', 'phone', 'cell', 'cellphone', 'mobile', 'mobile number', 'debtor telephone number'],
  email: ['email', 'email address', 'debtor email', 'debtor email address'],
  actionDate: ['action date', 'transaction date', 'cycle date', 'collection date', 'debit date', 'presentment date'],
  firstInstalmentDate: ['date of first instalment', 'date of first installment', 'first collection date', 'first instalment date'],
  debitAmount: ['debit amount', 'transaction amount', 'collected amount', 'amount'],
  originalAmount: ['original amount'],
  pifValue: ['pif value', 'pif'],
  instalmentAmount: ['instalment amount', 'installment amount'],
  totalAmount: ['total amount'],
  maxCollectionAmount: ['max collection amount', 'maximum collection amount'],
  status: ['status', 'transaction status', 'result'],
  reason: ['reason', 'response', 'response code', 'response description', 'rejected reason', 'rejected reason description', 'status code', 'status code description', 'fail reason', 'unpaid reason'],
  instalmentNumber: ['instalment number', 'installment number', 'instalment no', 'installment no', 'inst no', 'instalment'],
  instalmentCount: ['instalments', 'installments', 'total instalments', 'number of instalments'],
  frequency: ['frequency'],
  collectionDay: ['collection day'],
  active: ['active']
};

export const JOIN_FIELDS = ['contractReference', 'mandateId', 'clientReference'];

const HEADER_TO_FIELD = new Map();
for (const [field, names] of Object.entries(FIELD_ALIASES)) {
  for (const name of names) HEADER_TO_FIELD.set(name, field);
}

export function normHeader(value) {
  return String(value == null ? '' : value)
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[_./]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fieldForHeader(header) {
  return HEADER_TO_FIELD.get(normHeader(header)) || '';
}

export function headersFor(kind) {
  const base = ACTIVE_HEADERS.filter(name => kind === 'active' || !ACTIVE_ONLY_HEADERS.includes(name));
  const extra = kind === 'in_active' ? IN_ACTIVE_HEADERS : kind === 'rejected' ? REJECTED_HEADERS : [];
  if (!extra.length) return base.slice();
  const at = base.indexOf('Migrated');
  if (at < 0) return base.concat(extra);
  return base.slice(0, at).concat(extra, base.slice(at));
}

export function detectHeaders(headerCells) {
  const fields = {};
  (headerCells || []).forEach((cell, index) => {
    const field = fieldForHeader(cell);
    if (!field) return;
    if (fields[field] == null) { fields[field] = index; return; }
    if (field !== 'reason') return;
    const prev = normHeader(headerCells[fields[field]]);
    const next = normHeader(cell);
    if (next.includes('description') && !prev.includes('description')) fields[field] = index;
  });
  return {
    fields,
    recognized: JOIN_FIELDS.some(name => Object.prototype.hasOwnProperty.call(fields, name))
  };
}
