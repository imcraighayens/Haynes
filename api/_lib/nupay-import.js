// Staff import of a NuPay client list. Rows land in public.clients, and in
// public.loans only when the file actually has loan columns. Dedup is the
// NuPay reference (clients.ref). The HTTP result never includes an ID number,
// a phone, an email, or an account number. Nothing here calls a bank.
import { randomBytes } from 'node:crypto';
import { HttpError } from './http.js';
import { select, upsert, insert } from './supabase.js';
import { pick, cleanText, cleanPhone, cleanEmail, num, loanStatusToDb, isSafeId, toIsoDate } from './validate.js';

const MAX_ROWS = 2000;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

// Header text after normalisation. Unknown headers are ignored.
const ALIASES = {
  reference: ['nupay reference', 'nupay ref', 'nupayreference', 'client no', 'client number', 'client reference', 'client ref', 'account reference', 'reference', 'ref'],
  name: ['name', 'client name', 'full name', 'debtor name', 'clientname'],
  id_number: ['id number', 'id no', 'said', 'sa id', 'sa id number', 'identity number', 'national id', 'debtor id'],
  phone: ['phone', 'cell', 'cellphone', 'cell no', 'mobile', 'mobile number', 'cell number'],
  email: ['email', 'email address'],
  dob: ['dob', 'date of birth', 'birth date'],
  address: ['address', 'street address'],
  city: ['city', 'town'],
  province: ['province'],
  employment: ['employment', 'employment type'],
  employer: ['employer', 'employer name'],
  job_title: ['job title', 'occupation'],
  tenure: ['tenure'],
  net_salary: ['net salary', 'net income', 'nett salary'],
  gross_salary: ['gross salary', 'gross income'],
  other_income: ['other income'],
  bank: ['bank', 'bank name'],
  branch_code: ['branch code', 'branch'],
  account_no: ['account no', 'account number', 'account'],
  account_type: ['account type'],
  score: ['score'],
  blocked: ['blocked'],
  loan_ref: ['loan reference', 'loan ref', 'contract ref', 'contract reference', 'loan number'],
  mandate_id: ['mandate id', 'mandate', 'mandate number', 'nupay mandate'],
  principal: ['principal', 'loan amount', 'capital', 'amount advanced'],
  instalment_amount: ['instalment amount', 'instalment', 'installment amount', 'installment', 'debit amount'],
  schedule: ['schedule', 'due dates', 'instalment dates', 'installment dates'],
  instalments_paid: ['instalments paid', 'installments paid', 'paid instalments'],
  status: ['loan status'],
  purpose: ['purpose'],
  issued_on: ['issued on', 'issue date', 'start date'],
  return_rate_pct: ['return rate', 'return rate pct'],
  collection_fee: ['collection fee'],
  paid_dates: ['paid dates'],
  contract_ref: ['contract id']
};

const LOAN_FIELDS = new Set(['loan_ref', 'mandate_id', 'principal', 'instalment_amount', 'schedule', 'instalments_paid', 'status', 'purpose', 'issued_on', 'return_rate_pct', 'collection_fee', 'paid_dates', 'contract_ref']);
const SECRET_FIELDS = new Set(['id_number', 'phone', 'email', 'account_no', 'branch_code']);

const HEADER_TO_FIELD = new Map();
for (const [field, names] of Object.entries(ALIASES)) {
  for (const name of names) HEADER_TO_FIELD.set(name, field);
}

export const NUPAY_COLUMNS = Object.keys(ALIASES);

export function normHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[_./]+/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectDelim(line) {
  let comma = 0, semi = 0, tab = 0, quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { i += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (c === ',') comma += 1;
    else if (c === ';') semi += 1;
    else if (c === '\t') tab += 1;
  }
  if (tab > 0 && tab >= comma && tab >= semi) return '\t';
  if (semi > comma) return ';';
  return ',';
}

export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstBreak = src.indexOf('\n');
  const headerLine = firstBreak === -1 ? src : src.slice(0, firstBreak);
  const delim = detectDelim(headerLine);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delim) { row.push(cell); cell = ''; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function strictDate(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return s;
  }
  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/.test(s)) return toIsoDate(s);
  return null;
}

function dateList(cell) {
  const raw = String(cell || '').trim();
  if (!raw) return { ok: true, dates: [] };
  const parts = raw.split(/[|;]/).map(s => s.trim()).filter(Boolean);
  const dates = [];
  for (const part of parts) {
    const iso = strictDate(part);
    if (!iso) return { ok: false, dates: [] };
    if (!dates.includes(iso)) dates.push(iso);
  }
  return { ok: true, dates };
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

function clientIdFor(ref) {
  const id = 'c_nupay_' + slug(ref);
  return isSafeId(id) ? id : '';
}

function loanIdFor(key) {
  const id = 'l_nupay_' + slug(key);
  return isSafeId(id) ? id : '';
}

function moneyCell(cell) {
  if (cell == null || String(cell).trim() === '') return { ok: true, value: null };
  const n = num(cell, NaN);
  if (!Number.isFinite(n) || n < 0 || n > 1e9) return { ok: false, value: null };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function cleanIdNumber(cell) {
  const raw = String(cell || '').trim();
  if (!raw) return { ok: true, value: '' };
  const s = cleanText(raw, 40).replace(/[^A-Za-z0-9]/g, '');
  if (!s || s.length > 20) return { ok: false, value: '' };
  return { ok: true, value: s };
}

function indexBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row || row.deleted_at) continue;
    const key = keyFn(row);
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
}

function pushError(errors, row, message) {
  errors.push({ row, message });
}

function mapHeaders(header) {
  const fields = [];
  const errors = [];
  const seen = new Set();
  header.forEach((cell, index) => {
    const norm = normHeader(cell);
    if (!norm) return;
    const field = HEADER_TO_FIELD.get(norm);
    if (!field) return;
    if (seen.has(field)) {
      errors.push({ row: 1, message: 'A column is repeated' });
      return;
    }
    seen.add(field);
    fields.push({ field, index });
  });
  return { fields, errors, hasLoans: fields.some(f => LOAN_FIELDS.has(f.field)) };
}

function cellAt(row, mapped, field) {
  const hit = mapped.find(f => f.field === field);
  if (!hit) return undefined;
  return row[hit.index] == null ? '' : String(row[hit.index]).trim();
}

// Pure plan. existingClients need id, ref, deleted_at. existingLoans need
// id, ref, client_id, mandate_id, deleted_at. Write rows stay on the plan
// object and are removed before anything is sent to the browser.
export function planNupayCsv(csv, existingClients, existingLoans) {
  const errors = [];
  const table = parseCsv(csv);
  if (!table.length) {
    return { errors: [{ row: 1, message: 'The file is empty' }], preview: [], clientRows: [], loanRows: [], counts: emptyCounts(), columns: NUPAY_COLUMNS, hasLoans: false };
  }
  const mapped = mapHeaders(table[0]);
  errors.push(...mapped.errors);
  if (!mapped.fields.some(f => f.field === 'reference')) {
    errors.push({ row: 1, message: 'A NuPay reference column is required' });
  }
  if (!mapped.fields.some(f => f.field === 'name')) {
    errors.push({ row: 1, message: 'A name column is required' });
  }
  const data = table.slice(1);
  if (data.length > MAX_ROWS) errors.push({ row: MAX_ROWS + 2, message: 'The file has too many rows' });

  const byRef = indexBy(existingClients, row => String(row.ref || '').trim());
  const byClientId = indexBy(existingClients, row => String(row.id || ''));
  const byLoanRef = indexBy(existingLoans, row => String(row.ref || '').trim());
  const byMandate = indexBy(existingLoans, row => String(row.mandate_id || '').trim());

  const grouped = new Map();
  data.slice(0, MAX_ROWS).forEach((cells, i) => {
    const fileRow = i + 2;
    if (errors.some(e => e.row === 1)) return;
    const ref = cellAt(cells, mapped.fields, 'reference');
    const name = cleanText(cellAt(cells, mapped.fields, 'name'), 120);
    if (!ref || !REF_RE.test(ref)) { pushError(errors, fileRow, 'NuPay reference is missing or not usable'); return; }
    if (!name) { pushError(errors, fileRow, 'Client name is missing'); return; }

    let bucket = grouped.get(ref);
    if (!bucket) {
      bucket = { ref, fileRow, name, client: {}, loans: [] };
      grouped.set(ref, bucket);
    }
    bucket.name = name;
    bucket.fileRow = fileRow;

    const idNum = cleanIdNumber(cellAt(cells, mapped.fields, 'id_number'));
    if (!idNum.ok) pushError(errors, fileRow, 'ID number is not usable');
    else if (idNum.value) bucket.client.id_number = idNum.value;

    const phoneRaw = cellAt(cells, mapped.fields, 'phone');
    if (phoneRaw) {
      const phone = cleanPhone(phoneRaw);
      if (!phone) pushError(errors, fileRow, 'Phone number is not usable');
      else bucket.client.phone = phone;
    }
    const emailRaw = cellAt(cells, mapped.fields, 'email');
    if (emailRaw) {
      const email = cleanEmail(emailRaw);
      if (!email) pushError(errors, fileRow, 'Email is not usable');
      else bucket.client.email = email;
    }
    assignText(bucket.client, 'address', cellAt(cells, mapped.fields, 'address'), 200);
    assignText(bucket.client, 'city', cellAt(cells, mapped.fields, 'city'), 80);
    assignText(bucket.client, 'province', cellAt(cells, mapped.fields, 'province'), 80);
    assignText(bucket.client, 'employment', cellAt(cells, mapped.fields, 'employment'), 80);
    assignText(bucket.client, 'employer', cellAt(cells, mapped.fields, 'employer'), 120);
    assignText(bucket.client, 'job_title', cellAt(cells, mapped.fields, 'job_title'), 120);
    assignText(bucket.client, 'tenure', cellAt(cells, mapped.fields, 'tenure'), 40);
    assignText(bucket.client, 'bank', cellAt(cells, mapped.fields, 'bank'), 80);
    assignText(bucket.client, 'branch_code', cellAt(cells, mapped.fields, 'branch_code'), 20);
    assignText(bucket.client, 'account_no', cellAt(cells, mapped.fields, 'account_no'), 40);
    assignText(bucket.client, 'account_type', cellAt(cells, mapped.fields, 'account_type'), 40);

    const dobRaw = cellAt(cells, mapped.fields, 'dob');
    if (dobRaw) {
      const dob = strictDate(dobRaw);
      if (!dob) pushError(errors, fileRow, 'Date of birth is not a date');
      else bucket.client.dob = dob;
    }
    for (const key of ['net_salary', 'gross_salary', 'other_income']) {
      const raw = cellAt(cells, mapped.fields, key);
      if (raw == null || raw === '') continue;
      const money = moneyCell(raw);
      if (!money.ok) pushError(errors, fileRow, 'An amount is not a number');
      else bucket.client[key] = money.value;
    }
    const scoreRaw = cellAt(cells, mapped.fields, 'score');
    if (scoreRaw) {
      const score = num(scoreRaw, NaN);
      if (!Number.isFinite(score)) pushError(errors, fileRow, 'Score is not a number');
      else bucket.client.score = Math.trunc(score);
    }
    const blockedRaw = cellAt(cells, mapped.fields, 'blocked');
    if (blockedRaw != null && blockedRaw !== '') bucket.client.blocked = /^(1|y|yes|true|blocked)$/i.test(blockedRaw);

    if (!mapped.hasLoans) return;
    const loanBits = {};
    let anyLoan = false;
    for (const field of LOAN_FIELDS) {
      const raw = cellAt(cells, mapped.fields, field);
      if (raw) { loanBits[field] = raw; anyLoan = true; }
    }
    if (!anyLoan) return;
    const loan = readLoan(loanBits, fileRow, errors);
    if (loan) bucket.loans.push(loan);
  });

  const clientRows = [];
  const loanRows = [];
  const preview = [];
  const counts = emptyCounts();
  if (!errors.length) {
    for (const bucket of grouped.values()) {
      const existing = byRef.get(bucket.ref) || byClientId.get(clientIdFor(bucket.ref));
      const id = existing ? String(existing.id) : clientIdFor(bucket.ref);
      if (!id) { pushError(errors, bucket.fileRow, 'NuPay reference cannot be stored'); continue; }
      const clientAction = existing ? 'update' : 'create';
      const draft = { id, ref: bucket.ref, name: bucket.name, ...bucket.client };
      if (!existing) draft.created_by = 'nupay-import';
      clientRows.push(pick('clients', draft));
      counts.clients[clientAction] += 1;
      const loanNotes = [];
      for (const loan of bucket.loans) {
        const placed = placeLoan(loan, id, byLoanRef, byMandate, loanRows, errors, bucket.fileRow);
        if (!placed) continue;
        counts.loans[placed] += 1;
        loanNotes.push(placed + (loan.ref ? ' ' + loan.ref : ''));
      }
      preview.push({
        row: bucket.fileRow,
        ref: bucket.ref,
        name: bucket.name,
        client: clientAction,
        loans: loanNotes
      });
    }
  }

  return {
    errors,
    preview: preview.slice(0, 50),
    previewTruncated: preview.length > 50,
    clientRows,
    loanRows,
    counts,
    columns: NUPAY_COLUMNS,
    hasLoans: mapped.hasLoans
  };
}

function assignText(target, key, value, max) {
  if (value == null || value === '') return;
  const text = cleanText(value, max);
  if (text) target[key] = text;
}

function readLoan(bits, fileRow, errors) {
  const loanRef = bits.loan_ref ? cleanText(bits.loan_ref, 40) : '';
  const mandate = bits.mandate_id ? cleanText(bits.mandate_id, 80) : '';
  const ref = loanRef || mandate;
  if (!ref || !REF_RE.test(ref)) { pushError(errors, fileRow, 'Loan reference is missing or not usable'); return null; }
  const principal = moneyCell(bits.principal || '');
  const instalment = moneyCell(bits.instalment_amount || '');
  if (!principal.ok || !instalment.ok) { pushError(errors, fileRow, 'An amount is not a number'); return null; }
  if (!(principal.value > 0) || !(instalment.value > 0)) { pushError(errors, fileRow, 'A loan needs a principal and an instalment'); return null; }
  let schedule = null;
  if (bits.schedule) {
    const parsed = dateList(bits.schedule);
    if (!parsed.ok) { pushError(errors, fileRow, 'A due date is not a date'); return null; }
    schedule = parsed.dates;
  }
  let paidDates = null;
  if (bits.paid_dates) {
    const parsed = dateList(bits.paid_dates);
    if (!parsed.ok) { pushError(errors, fileRow, 'A paid date is not a date'); return null; }
    paidDates = parsed.dates;
  }
  let instalmentsPaid = null;
  if (bits.instalments_paid) {
    const n = num(bits.instalments_paid, NaN);
    if (!Number.isFinite(n) || n < 0 || n > 240) { pushError(errors, fileRow, 'Instalments paid is not a count'); return null; }
    instalmentsPaid = Math.trunc(n);
  }
  let status = null;
  if (bits.status) {
    status = loanStatusToDb(bits.status);
    if (!status) { pushError(errors, fileRow, 'Loan status is not recognised'); return null; }
  }
  let issued = null;
  if (bits.issued_on) {
    issued = strictDate(bits.issued_on);
    if (!issued) { pushError(errors, fileRow, 'Issue date is not a date'); return null; }
  }
  let rate = null;
  if (bits.return_rate_pct) {
    const money = moneyCell(bits.return_rate_pct);
    if (!money.ok || money.value > 100) { pushError(errors, fileRow, 'Return rate is not a number'); return null; }
    rate = money.value;
  }
  let fee = null;
  if (bits.collection_fee) {
    const money = moneyCell(bits.collection_fee);
    if (!money.ok) { pushError(errors, fileRow, 'An amount is not a number'); return null; }
    fee = money.value;
  }
  return {
    ref,
    mandate_id: mandate || null,
    principal: principal.value,
    instalment_amount: instalment.value,
    schedule,
    paid_dates: paidDates,
    instalments_paid: instalmentsPaid,
    status,
    purpose: bits.purpose ? cleanText(bits.purpose, 120) : '',
    issued_on: issued,
    return_rate_pct: rate,
    collection_fee: fee,
    contract_ref: bits.contract_ref ? cleanText(bits.contract_ref, 80) : ''
  };
}

function placeLoan(loan, clientId, byLoanRef, byMandate, loanRows, errors, fileRow) {
  const byMandateHit = loan.mandate_id ? byMandate.get(loan.mandate_id) : null;
  const byRefHit = byLoanRef.get(loan.ref);
  const existing = byMandateHit || byRefHit;
  if (byMandateHit && byRefHit && String(byMandateHit.id) !== String(byRefHit.id)) {
    pushError(errors, fileRow, 'Loan reference and mandate point at different loans');
    return null;
  }
  if (existing && String(existing.client_id || '') !== String(clientId)) {
    pushError(errors, fileRow, 'That loan is already on another client');
    return null;
  }
  const id = existing ? String(existing.id) : loanIdFor(loan.mandate_id || loan.ref);
  if (!id) { pushError(errors, fileRow, 'Loan reference cannot be stored'); return null; }
  const taken = loanRows.find(row => row.id === id);
  if (!existing && (byClientOwnsId(byLoanRef, byMandate, id) || taken)) {
    pushError(errors, fileRow, 'Loan reference is already in use');
    return null;
  }
  const draft = {
    id,
    ref: loan.ref,
    client_id: clientId,
    principal: loan.principal,
    instalment_amount: loan.instalment_amount
  };
  if (loan.mandate_id) draft.mandate_id = loan.mandate_id;
  if (loan.schedule) draft.schedule = loan.schedule;
  if (loan.paid_dates) draft.paid_dates = loan.paid_dates;
  if (loan.instalments_paid != null) draft.instalments_paid = loan.instalments_paid;
  if (loan.status) draft.status = loan.status;
  else if (!existing) draft.status = 'issued';
  if (loan.purpose) draft.purpose = loan.purpose;
  if (loan.issued_on) draft.issued_on = loan.issued_on;
  if (loan.return_rate_pct != null) draft.return_rate_pct = loan.return_rate_pct;
  if (loan.collection_fee != null) draft.collection_fee = loan.collection_fee;
  if (loan.contract_ref) draft.contract_ref = loan.contract_ref;
  const row = pick('loans', draft);
  // The stored schedule is the dates in the file. instalments_paid is a count,
  // not a slice into that list.
  if (Array.isArray(draft.schedule)) row.schedule = draft.schedule.slice();
  loanRows.push(row);
  if (!existing) {
    byLoanRef.set(loan.ref, { id, ref: loan.ref, client_id: clientId, mandate_id: loan.mandate_id });
    if (loan.mandate_id) byMandate.set(loan.mandate_id, { id, ref: loan.ref, client_id: clientId, mandate_id: loan.mandate_id });
  }
  return existing ? 'update' : 'create';
}

function byClientOwnsId(byLoanRef, byMandate, id) {
  for (const row of byLoanRef.values()) if (String(row.id) === id) return true;
  for (const row of byMandate.values()) if (String(row.id) === id) return true;
  return false;
}

function emptyCounts() {
  return { clients: { create: 0, update: 0 }, loans: { create: 0, update: 0 }, rows: 0 };
}

export function publicNupayPlan(plan) {
  const preview = (plan.preview || []).map(row => ({
    row: row.row,
    ref: row.ref,
    name: row.name,
    client: row.client,
    loans: row.loans || []
  }));
  const body = {
    dryRun: true,
    committed: false,
    hasLoans: !!plan.hasLoans,
    columns: NUPAY_COLUMNS,
    counts: {
      clientsCreate: plan.counts.clients.create,
      clientsUpdate: plan.counts.clients.update,
      loansCreate: plan.counts.loans.create,
      loansUpdate: plan.counts.loans.update
    },
    preview,
    previewTruncated: !!plan.previewTruncated,
    errors: (plan.errors || []).map(e => ({ row: e.row, message: e.message }))
  };
  for (const row of preview) {
    for (const field of SECRET_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(row, field)) throw new Error('preview leaked a private column');
    }
  }
  return body;
}

function missingTable(err) {
  return !!(err && (err.code === '42P01' || /42P01/.test(String(err.message || ''))));
}

export async function runNupayImport(csv, { commit = false, actor = 'staff' } = {}) {
  if (typeof csv !== 'string' || !csv.trim()) throw new HttpError(400, 'Paste or choose a CSV file');
  if (csv.length > 1_500_000) throw new HttpError(400, 'That file is too large');
  const [clients, loans] = await Promise.all([
    select('clients', { select: 'id,ref,deleted_at' }),
    select('loans', { select: 'id,ref,client_id,mandate_id,deleted_at' })
  ]);
  const plan = planNupayCsv(csv, clients || [], loans || []);
  const safe = publicNupayPlan(plan);
  const blocked = plan.errors.length > 0;
  if (!commit || blocked) {
    safe.dryRun = true;
    safe.committed = false;
    return safe;
  }
  if (plan.clientRows.length) await upsert('clients', plan.clientRows, 'id', { returning: false });
  if (plan.loanRows.length) await upsert('loans', plan.loanRows, 'id', { returning: false });
  const who = cleanText(actor, 80) || 'staff';
  try {
    await insert('audit_log', [{
      id: 'aud_nupay_' + randomBytes(6).toString('hex'),
      at: new Date().toISOString(),
      type: 'NUPAY IMPORT',
      ref: '—',
      customer: '—',
      amount: 0,
      by: who,
      comment: 'NuPay client list: ' + plan.counts.clients.create + ' new clients, ' + plan.counts.clients.update + ' updated, ' + plan.loanRows.length + ' loans. No payment was sent.'
    }], { returning: false });
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
  safe.dryRun = false;
  safe.committed = true;
  return safe;
}
