// One staff action updates public.loans and writes the audit row before the
// response. If the audit insert fails, the loan status is put back.
import { randomBytes } from 'node:crypto';
import { selectOne, update, insert, eq } from './supabase.js';
import { loanStatusToDb } from './validate.js';
import { HttpError } from './http.js';

const LOAN_ID = /^[A-Za-z0-9_-]{1,80}$/;

function nextStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (raw === 'duetoday' || raw === 'due today') return 'issued';
  return loanStatusToDb(status);
}

export async function commitLoanStatus({ loanId, status, note, by }) {
  const id = String(loanId || '').trim();
  if (!LOAN_ID.test(id)) throw new HttpError(400, 'Loan not found');
  const next = nextStatus(status);
  if (!next) throw new HttpError(400, 'Loan status is not recognised');
  const loan = await selectOne('loans', { select: '*', id: eq(id) });
  if (!loan || loan.deleted_at) throw new HttpError(404, 'Loan not found');
  const prevStatus = loan.status;
  const prevAt = loan.status_at || null;
  const now = new Date().toISOString();
  const changed = prevStatus !== next;
  if (changed) await update('loans', { id }, { status: next, status_at: now });
  const client = loan.client_id
    ? await selectOne('clients', { select: 'id,name', id: eq(loan.client_id) })
    : null;
  const audit = {
    id: 'al_' + randomBytes(8).toString('hex'),
    at: now,
    type: 'STATUS → ' + next.replace(/_/g, ' ').toUpperCase(),
    ref: String(loan.ref || '').slice(0, 40),
    customer: String((client && client.name) || '—').slice(0, 80),
    amount: Number(loan.instalment_amount) || 0,
    by: String(by || 'staff').slice(0, 80),
    comment: String(note || '').replace(/[\r\n]/g, ' ').slice(0, 240)
  };
  try {
    await insert('audit_log', [audit]);
  } catch (err) {
    if (changed) {
      try { await update('loans', { id }, { status: prevStatus, status_at: prevAt }); } catch { /* the caller still hears the audit failure */ }
    }
    throw err;
  }
  const fresh = await selectOne('loans', { select: '*', id: eq(id) });
  return { loan: fresh || { ...loan, status: next, status_at: changed ? now : prevAt }, audit };
}
