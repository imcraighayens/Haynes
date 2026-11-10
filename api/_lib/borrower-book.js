// Session-scoped Quik1 book. Every read is the client on the open session.
// Withdrawals and messages are status records. Nothing here calls a bank.
import { randomBytes } from 'node:crypto';
import { HttpError } from './http.js';
import { select, selectOne, insert, update, count, eq } from './supabase.js';
import { isSafeId, cleanText, parseAmount, num } from './validate.js';
import { accountFromLoans, statementsFromLoans, publicProfile, unidentified } from './quik1-book.js';
import { readSession } from './quik1-session.js';
import { maskForBorrower } from './sa-id.js';
import { decodeDocument, uploadPrivate, signPrivate } from './storage.js';

const LOAN_COLS = 'id,ref,client_id,principal,status,schedule,instalment_amount,instalments_paid,paid_dates,purpose,issued_on,deleted_at';
const APP_COLS = 'id,ref,client_id,name,amount,purpose,status,source,decision,created_at,meta';

function newId(prefix) {
  return prefix + '_' + randomBytes(8).toString('hex');
}

function missingTable(err) {
  return !!(err && (err.code === '42P01' || /42P01/.test(String(err.message || ''))));
}

async function optionalRows(table, query) {
  try { return await select(table, query); }
  catch (err) {
    if (missingTable(err)) return [];
    throw err;
  }
}

export async function requireBorrower(req) {
  const sess = readSession(req);
  if (!sess) throw new HttpError(401, 'Sign in required');
  const session = await selectOne('q1_sessions', {
    select: 'id,borrower_id,client_id,expires_at,revoked_at',
    id: eq(sess.sid)
  });
  if (!session || session.revoked_at) throw new HttpError(401, 'Sign in required');
  if (session.borrower_id !== sess.bid || session.client_id !== sess.cid) throw new HttpError(401, 'Sign in required');
  if (new Date(session.expires_at).getTime() <= Date.now()) throw new HttpError(401, 'Sign in required');
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id',
    id: eq(sess.bid)
  });
  if (!borrower || borrower.client_id !== sess.cid) throw new HttpError(401, 'Sign in required');
  const client = await selectOne('clients', {
    select: 'id,ref,name,bank,deleted_at',
    id: eq(borrower.client_id)
  });
  if (!client || client.deleted_at) throw new HttpError(401, 'Sign in required');
  return { session, borrower, client };
}

async function loansOf(clientId) {
  const rows = await select('loans', {
    select: LOAN_COLS,
    client_id: eq(clientId)
  });
  return (rows || []).filter(row => row && row.client_id === clientId && !row.deleted_at);
}

function publicLoan(loan) {
  if (!loan) return null;
  const copy = { ...loan };
  delete copy.client_id;
  delete copy.deleted_at;
  return copy;
}

export function publicApplication(row) {
  if (!row) return null;
  const decision = row.decision && typeof row.decision === 'object' ? row.decision : null;
  const verdict = decision && (decision.verdict === 'approved' || decision.verdict === 'declined')
    ? decision.verdict
    : (row.status === 'approved' || row.status === 'declined' ? row.status : null);
  return {
    id: row.id,
    ref: row.ref || '',
    status: row.status || 'new',
    amount: num(row.amount),
    purpose: cleanText(row.purpose, 120),
    created_at: row.created_at || null,
    verdict
  };
}

export function publicMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    from: row.author === 'borrower' ? 'you' : 'ecoloans',
    body: cleanText(row.body, 2000),
    at: row.created_at || null
  };
}

async function applicationsOf(clientId) {
  const rows = await optionalRows('applications', {
    select: APP_COLS,
    client_id: eq(clientId),
    source: eq('quik1'),
    order: 'created_at.desc',
    limit: 50
  });
  return (rows || []).filter(row => row && row.client_id === clientId);
}

async function messagesOf(clientId) {
  const rows = await optionalRows('q1_messages', {
    select: 'id,client_id,author,body,created_at',
    client_id: eq(clientId),
    order: 'created_at.asc',
    limit: 100
  });
  return (rows || []).filter(row => row && row.client_id === clientId);
}

export async function borrowerBook(req) {
  let who;
  try { who = await requireBorrower(req); }
  catch (err) {
    // A missing borrower table keeps the public home up. A missing session is 401.
    if (missingTable(err)) return unidentified();
    throw err;
  }
  const loans = await loansOf(who.client.id);
  const [applications, messages, idMasked] = await Promise.all([
    applicationsOf(who.client.id),
    messagesOf(who.client.id),
    maskForBorrower(who.borrower.id)
  ]);
  return {
    identified: true,
    profile: { ...publicProfile(who.client), idMasked: idMasked || '' },
    account: accountFromLoans(loans),
    statements: statementsFromLoans(loans),
    applications: applications.map(publicApplication),
    messages: messages.map(publicMessage)
  };
}

export async function borrowerLoans(req) {
  const { client } = await requireBorrower(req);
  const account = accountFromLoans(await loansOf(client.id));
  return { loans: account.loans.map(publicLoan) };
}

export async function borrowerLoan(req, loanId) {
  if (!isSafeId(loanId)) throw new HttpError(400, 'bad id');
  const { client } = await requireBorrower(req);
  const loan = await selectOne('loans', {
    select: LOAN_COLS,
    id: eq(loanId),
    client_id: eq(client.id)
  });
  if (!loan || loan.deleted_at || loan.client_id !== client.id) throw new HttpError(404, 'Loan not found');
  const view = accountFromLoans([loan]).loans[0];
  if (!view) throw new HttpError(404, 'Loan not found');
  return publicLoan(view);
}

export async function borrowerStatements(req) {
  const { client } = await requireBorrower(req);
  return { statements: statementsFromLoans(await loansOf(client.id)) };
}

export async function borrowerApplications(req) {
  const { client } = await requireBorrower(req);
  const rows = await applicationsOf(client.id);
  return { applications: rows.map(publicApplication) };
}

// A request from a signed-in client. It is an inbox row, not a payout.
export async function createWithdrawal(req, body) {
  const { client } = await requireBorrower(req);
  const purpose = cleanText(body && body.purpose, 120);
  if (!purpose) throw new HttpError(400, 'Say what the money is for');
  const amount = parseAmount(body && body.amount);
  const loans = await loansOf(client.id);
  const account = accountFromLoans(loans);
  if (amount > account.available + 0.001) throw new HttpError(400, 'That is more than the credit still available');
  const id = newId('ap');
  const seq = await count('applications', {});
  const row = {
    id,
    ref: `AP-${1085 + seq}`,
    client_id: client.id,
    name: cleanText(client.name, 120) || 'Client',
    phone: null,
    email: null,
    id_number: null,
    amount,
    term_months: 1,
    purpose,
    net_income: 0,
    source: 'quik1',
    status: 'new',
    meta: { kind: 'withdrawal', client: 'quik1', submittedAt: Date.now() }
  };
  await insert('applications', [row], { returning: false });
  return { id, ref: row.ref, status: 'new', amount, purpose };
}

export async function borrowerMessages(req) {
  const { client } = await requireBorrower(req);
  const rows = await messagesOf(client.id);
  return { messages: rows.map(publicMessage) };
}

export async function postBorrowerMessage(req, body) {
  const { client } = await requireBorrower(req);
  const text = cleanText(body && (body.body ?? body.message ?? body.text), 2000);
  if (!text) throw new HttpError(400, 'Write a message');
  const id = newId('qm');
  await insert('q1_messages', [{
    id,
    client_id: client.id,
    author: 'borrower',
    body: text
  }]);
  return { id, from: 'you', body: text };
}

export async function postStaffReply(clientId, body, now = Date.now()) {
  if (!isSafeId(clientId)) throw new HttpError(400, 'bad id');
  const client = await selectOne('clients', { select: 'id,deleted_at', id: eq(clientId) });
  if (!client || client.deleted_at) throw new HttpError(404, 'Client not found');
  const text = cleanText(body && (body.body ?? body.message), 2000);
  if (!text) throw new HttpError(400, 'Write a reply');
  const id = newId('qm');
  await insert('q1_messages', [{
    id,
    client_id: client.id,
    author: 'staff',
    body: text,
    created_at: new Date(now).toISOString()
  }]);
  return { id, from: 'ecoloans', body: text };
}

const DECIDED = new Set(['approved', 'declined', 'reviewing', 'new']);

export async function decideApplication(id, status, amount) {
  if (!isSafeId(id)) throw new HttpError(400, 'bad id');
  const next = String(status || '').toLowerCase();
  if (!DECIDED.has(next)) throw new HttpError(400, 'status must be new, reviewing, approved, or declined');
  const existing = await selectOne('applications', {
    select: 'id,amount,status,source,client_id',
    id: eq(id),
    source: eq('quik1')
  });
  if (!existing) throw new HttpError(404, 'Application not found');
  const now = new Date().toISOString();
  const decided = next === 'approved' || next === 'declined';
  const patch = decided
    ? {
      status: next,
      decided_at: now,
      decided_by: 'ledger',
      decision: { verdict: next, amount: num(amount, num(existing.amount)), by: 'Ecoloans', note: '', at: now }
    }
    : { status: next, decided_at: null, decided_by: null, decision: null };
  const rows = await update('applications', { id, source: 'quik1' }, patch);
  if (!rows.length) throw new HttpError(404, 'Application not found');
  return publicApplication(rows[0]);
}

function docNames(meta) {
  const docs = meta && Array.isArray(meta.docs) ? meta.docs : [];
  return docs.map(d => (typeof d === 'string' ? d : cleanText(d && d.name, 80))).filter(Boolean);
}

export function consoleApplication(row) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  const when = row.created_at ? new Date(row.created_at) : null;
  const submitted = when && !Number.isNaN(when.getTime())
    ? when.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
    : '';
  return {
    id: 'qk_' + row.id,
    extId: row.id,
    name: cleanText(row.name, 120) || 'Applicant',
    phone: cleanText(row.phone, 32) || '—',
    email: cleanText(row.email, 160) || '—',
    idNumber: cleanText(row.id_number, 20) || '—',
    amount: num(row.amount),
    term: Math.max(1, parseInt(row.term_months, 10) || 1),
    purpose: cleanText(row.purpose, 120) || 'Personal',
    employer: cleanText(row.employer, 120) || '—',
    jobTitle: cleanText(row.job_title, 120) || '—',
    income: num(row.net_income),
    bank: cleanText(row.bank, 80) || '—',
    docs: docNames(meta),
    status: row.status || 'new',
    source: row.client_id ? 'Quik1 · existing client' : 'Quik1 app',
    submitted,
    existingClientId: row.client_id || null
  };
}

export async function staffFeed() {
  const [applications, messages, clients] = await Promise.all([
    optionalRows('applications', { select: '*', source: eq('quik1'), order: 'created_at.desc', limit: 200 }),
    optionalRows('q1_messages', { select: 'id,client_id,author,body,created_at', order: 'created_at.asc', limit: 400 }),
    optionalRows('clients', { select: 'id,ref,name,deleted_at' })
  ]);
  const byClient = {};
  for (const client of clients || []) {
    if (client && !client.deleted_at) byClient[client.id] = client;
  }
  const threads = {};
  for (const row of messages || []) {
    if (!row || !row.client_id) continue;
    const bucket = threads[row.client_id] || { clientId: row.client_id, name: '', ref: '', lines: [] };
    const client = byClient[row.client_id];
    bucket.name = client ? cleanText(client.name, 120) : 'Client';
    bucket.ref = client ? cleanText(client.ref, 40) : '';
    bucket.lines.push({
      id: row.id,
      who: row.author === 'staff' ? 'Ledger' : 'Client',
      body: cleanText(row.body, 2000),
      at: row.created_at || null
    });
    threads[row.client_id] = bucket;
  }
  return {
    applications: (applications || []).map(consoleApplication),
    threads: Object.values(threads)
  };
}

const DOC_MAX = 5;

export async function attachDocument(req, body) {
  const applicationId = cleanText(body && body.applicationId, 80);
  if (!isSafeId(applicationId)) throw new HttpError(400, 'bad id');
  const app = await selectOne('applications', {
    select: 'id,client_id,source,status,meta',
    id: eq(applicationId),
    source: eq('quik1')
  });
  if (!app) throw new HttpError(404, 'Application not found');
  if (app.client_id) {
    const { client } = await requireBorrower(req);
    if (client.id !== app.client_id) throw new HttpError(404, 'Application not found');
  }
  const meta = app.meta && typeof app.meta === 'object' ? { ...app.meta } : {};
  const docs = Array.isArray(meta.docs) ? meta.docs.slice() : [];
  if (docs.length >= DOC_MAX) throw new HttpError(400, 'That application already has its documents');
  const name = cleanText(body && body.name, 80);
  if (!name) throw new HttpError(400, 'Name the file');
  const file = decodeDocument(body && body.data, body && body.contentType);
  const path = `applications/${app.id}/${randomBytes(6).toString('hex')}.${file.ext}`;
  await uploadPrivate(path, file.bytes, file.contentType);
  docs.push({ name, path });
  meta.docs = docs;
  await update('applications', { id: app.id, source: 'quik1' }, { meta });
  return { ok: true, name };
}

export async function signStaffDocument(applicationId, docPath) {
  if (!isSafeId(applicationId)) throw new HttpError(400, 'bad id');
  const path = cleanText(docPath, 180);
  if (!path.startsWith(`applications/${applicationId}/`)) throw new HttpError(400, 'bad path');
  const app = await selectOne('applications', {
    select: 'id,source,meta',
    id: eq(applicationId),
    source: eq('quik1')
  });
  if (!app) throw new HttpError(404, 'Application not found');
  const docs = app.meta && Array.isArray(app.meta.docs) ? app.meta.docs : [];
  const hit = docs.find(d => d && d.path === path);
  if (!hit) throw new HttpError(404, 'Document not found');
  const url = await signPrivate(path, 120);
  return { name: cleanText(hit.name, 80), url };
}

const PREVIEW_CLIENT_CAP = 200;

export async function previewClients() {
  const rows = await select('clients', {
    select: 'id,ref,name,deleted_at',
    order: 'name.asc',
    limit: PREVIEW_CLIENT_CAP
  });
  return (rows || []).filter(row => row && !row.deleted_at && isSafeId(String(row.id || ''))).map(row => ({
    id: row.id,
    ref: String(row.ref || '').trim(),
    name: String(row.name || '').trim()
  }));
}

// Same borrower view as a signed-in client, for one id the staff member named.
export async function previewBook(clientId) {
  if (!isSafeId(clientId)) throw new HttpError(400, 'bad id');
  const client = await selectOne('clients', {
    select: 'id,ref,name,bank,deleted_at',
    id: eq(clientId)
  });
  if (!client || client.deleted_at) throw new HttpError(404, 'Client not found');
  const loans = await loansOf(client.id);
  return {
    identified: true,
    preview: true,
    profile: publicProfile(client),
    account: accountFromLoans(loans),
    statements: statementsFromLoans(loans),
    applications: [],
    messages: []
  };
}
