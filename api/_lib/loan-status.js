// A staff status change updates public.loans first. The audit row is written
// only after that update changed a row and a fresh read shows the new status.
// If the audit insert fails, the loan columns are put back — but only if this
// request still owns the row (compare-and-set on the updated_at it wrote).
import { createHash } from 'node:crypto';
import { selectOne, patchWhere, upsert, eq } from './supabase.js';
import { loanStatusToDb } from './validate.js';
import { HttpError } from './http.js';

const LOAN_ID = /^[A-Za-z0-9_-]{1,80}$/;
const CLOSED = new Set(['paid', 'settled_early']);

function norm(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function nextStatus(status) {
  const raw = norm(status);
  if (raw === 'duetoday' || raw === 'due_today') return 'issued';
  return loanStatusToDb(status);
}

function isoDate(value) {
  const s = String(value || '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function paidDatesOf(loan) {
  return Array.isArray(loan && loan.paid_dates) ? loan.paid_dates.map(isoDate).filter(Boolean) : [];
}

function scheduleOf(loan) {
  return Array.isArray(loan && loan.schedule) ? loan.schedule.map(isoDate).filter(Boolean) : [];
}

function paidFields(loan, now) {
  const today = now.slice(0, 10);
  const paid = paidDatesOf(loan);
  if (today && !paid.includes(today)) paid.push(today);
  const count = Math.max(Number(loan.instalments_paid) || 0, scheduleOf(loan).length, paid.length, 1);
  return { instalments_paid: count, paid_dates: paid };
}

// Same loan, same target, same instalment count, same client request → same audit id.
// A retry of that request updates nothing extra in the audit log.
export function loanStatusAuditId({ loanId, status, instalmentsPaid, requestId }) {
  const count = instalmentsPaid == null || instalmentsPaid === '' ? '' : String(Math.trunc(Number(instalmentsPaid)));
  const req = String(requestId || '').replace(/[^\w.:-]/g, '').slice(0, 80);
  const material = [String(loanId || ''), String(status || ''), count, req].join('|');
  return 'al_' + createHash('sha256').update(material).digest('hex').slice(0, 32);
}

function updatedAtFilter(value) {
  if (value == null || value === '') return 'is.null';
  return eq(value);
}

function casUpdate(id, updatedAt, patch) {
  return patchWhere('loans', { id: eq(id), updated_at: updatedAtFilter(updatedAt) }, patch);
}

export async function commitLoanStatus({ loanId, status, note, by, updatedBy, instalmentsPaid, requestId }) {
  const id = String(loanId || '').trim();
  if (!LOAN_ID.test(id)) throw new HttpError(400, 'Loan not found');
  const next = nextStatus(status);
  if (!next) throw new HttpError(400, 'Loan status is not recognised');
  const loan = await selectOne('loans', { select: '*', id: eq(id) });
  if (!loan || loan.deleted_at) throw new HttpError(404, 'Loan not found');
  const current = norm(loan.status);
  if (current === 'written_off' || current === 'writtenoff') {
    throw new HttpError(409, 'A written-off loan cannot change status.');
  }
  if ((current === 'settled_early' || current === 'settled') && next === 'paid') {
    throw new HttpError(409, 'A settled loan cannot be marked paid.');
  }
  const now = new Date().toISOString();
  const who = String(updatedBy || by || 'staff').slice(0, 80);
  const prevPaid = Number(loan.instalments_paid) || 0;
  const schedule = scheduleOf(loan);
  let requested = null;
  if (instalmentsPaid != null && instalmentsPaid !== '' && Number.isFinite(Number(instalmentsPaid))) {
    requested = Math.max(0, Math.trunc(Number(instalmentsPaid)));
  }
  const patch = { status: next, status_at: now, updated_at: now, updated_by: who };
  if (CLOSED.has(next)) {
    if (requested != null && schedule.length && requested < schedule.length) {
      throw new HttpError(422, 'This instalment does not close the loan.');
    }
    Object.assign(patch, paidFields(loan, now));
    if (requested != null) patch.instalments_paid = Math.max(patch.instalments_paid, requested);
  } else if (requested != null) {
    if (requested !== prevPaid && requested !== prevPaid + 1) {
      throw new HttpError(422, 'Pay exactly one instalment.');
    }
    patch.instalments_paid = requested;
    if (requested === prevPaid + 1) {
      const today = now.slice(0, 10);
      const paid = paidDatesOf(loan);
      if (today && !paid.includes(today)) paid.push(today);
      patch.paid_dates = paid;
    }
  }
  const updated = await casUpdate(id, loan.updated_at, patch);
  if (!Array.isArray(updated) || updated.length !== 1) {
    throw new HttpError(409, 'The loan changed while it was being saved. Nothing was changed.');
  }
  const fresh = await selectOne('loans', { select: '*', id: eq(id) });
  const paidDates = fresh && Array.isArray(fresh.paid_dates) ? fresh.paid_dates.filter(Boolean) : [];
  const paidCount = fresh ? Number(fresh.instalments_paid) || 0 : 0;
  if (!fresh || fresh.status !== next || !fresh.status_at) throw new HttpError(409, 'The loan was not updated');
  if (CLOSED.has(next) && (paidCount < 1 || !paidDates.length)) throw new HttpError(409, 'The loan was not updated');
  const client = loan.client_id
    ? await selectOne('clients', { select: 'id,name', id: eq(loan.client_id) })
    : null;
  const audit = {
    id: loanStatusAuditId({
      loanId: id,
      status: next,
      instalmentsPaid: patch.instalments_paid != null ? patch.instalments_paid : prevPaid,
      requestId
    }),
    at: now,
    type: 'STATUS → ' + next.replace(/_/g, ' ').toUpperCase(),
    ref: String(loan.ref || '').slice(0, 40),
    customer: String((client && client.name) || '—').slice(0, 80),
    amount: Number(loan.instalment_amount) || 0,
    by: String(by || who).slice(0, 80),
    comment: String(note || '').replace(/[\r\n]/g, ' ').slice(0, 240)
  };
  try {
    await upsert('audit_log', [audit], 'id', { ignoreDuplicates: true });
  } catch (err) {
    if (err && err.code === '23505') return { loan: fresh, audit, updated: 1 };
    try {
      // Match the updated_at this request wrote. A newer write keeps its columns.
      await casUpdate(id, now, {
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
