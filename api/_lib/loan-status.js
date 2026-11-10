// A staff status change updates public.loans first. The audit row is written
// only after that update changed a row and a fresh read shows the new status.
// If the audit insert fails, the loan columns are put back.
import { randomBytes } from 'node:crypto';
import { selectOne, update, insert, eq } from './supabase.js';
import { loanStatusToDb } from './validate.js';
import { HttpError } from './http.js';

const LOAN_ID = /^[A-Za-z0-9_-]{1,80}$/;
const CLOSED = new Set(['paid', 'settled_early']);

function nextStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (raw === 'duetoday' || raw === 'due today') return 'issued';
  return loanStatusToDb(status);
}

function isoDate(value) {
  const s = String(value || '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function paidFields(loan, now) {
  const today = now.slice(0, 10);
  const schedule = Array.isArray(loan.schedule) ? loan.schedule.map(isoDate).filter(Boolean) : [];
  const paid = Array.isArray(loan.paid_dates) ? loan.paid_dates.map(isoDate).filter(Boolean) : [];
  if (today && !paid.includes(today)) paid.push(today);
  const count = Math.max(Number(loan.instalments_paid) || 0, schedule.length, paid.length, 1);
  return { instalments_paid: count, paid_dates: paid };
}

export async function commitLoanStatus({ loanId, status, note, by, updatedBy, instalmentsPaid }) {
  const id = String(loanId || '').trim();
  if (!LOAN_ID.test(id)) throw new HttpError(400, 'Loan not found');
  const next = nextStatus(status);
  if (!next) throw new HttpError(400, 'Loan status is not recognised');
  const loan = await selectOne('loans', { select: '*', id: eq(id) });
  if (!loan || loan.deleted_at) throw new HttpError(404, 'Loan not found');
  const now = new Date().toISOString();
  const who = String(updatedBy || by || 'staff').slice(0, 80);
  const patch = { status: next, status_at: now, updated_at: now, updated_by: who };
  if (CLOSED.has(next)) Object.assign(patch, paidFields(loan, now));
  if (instalmentsPaid != null && Number.isFinite(Number(instalmentsPaid))) {
    patch.instalments_paid = Math.max(0, Math.trunc(Number(instalmentsPaid)));
  }
  const updated = await update('loans', { id }, patch);
  if (!Array.isArray(updated) || updated.length !== 1) {
    throw new HttpError(409, 'The loan was not updated');
  }
  const fresh = await selectOne('loans', { select: '*', id: eq(id) });
  if (!fresh || fresh.status !== next) throw new HttpError(409, 'The loan was not updated');
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
    by: String(by || who).slice(0, 80),
    comment: String(note || '').replace(/[\r\n]/g, ' ').slice(0, 240)
  };
  try {
    await insert('audit_log', [audit]);
  } catch (err) {
    try {
      await update('loans', { id }, {
        status: loan.status,
        status_at: loan.status_at || null,
        updated_at: loan.updated_at || null,
        updated_by: loan.updated_by || null,
        instalments_paid: loan.instalments_paid || 0,
        paid_dates: Array.isArray(loan.paid_dates) ? loan.paid_dates : []
      });
    } catch { /* the caller still hears the audit failure */ }
    throw err;
  }
  return { loan: fresh, audit, updated: 1 };
}
