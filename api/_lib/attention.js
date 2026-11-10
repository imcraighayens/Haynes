// Staff acknowledgements for the attention popup. The table is optional until
// the migration is applied: a missing relation is a soft "not ready", not a boot failure.
import { select, upsert, eq } from './supabase.js';

function missingTable(err) {
  const code = err && err.code;
  const msg = String((err && err.message) || '');
  return code === '42P01' || code === 'PGRST205' || /42P01|PGRST205/.test(msg);
}

export async function listAttention(staffEmail) {
  const email = String(staffEmail || '').trim().toLowerCase();
  try {
    if (!email) {
      await select('ledger_attention', { select: 'id', limit: 1 });
      return { ready: true, rows: [], viewer: email };
    }
    const rows = await select('ledger_attention', {
      select: 'loan_id,marker',
      staff_email: eq(email),
      order: 'acknowledged_at.desc'
    });
    return {
      ready: true,
      viewer: email,
      rows: (rows || []).filter(r => r && r.loan_id && r.marker).map(r => ({
        loan_id: String(r.loan_id),
        marker: String(r.marker)
      }))
    };
  } catch (err) {
    if (missingTable(err)) return { ready: false, rows: [], viewer: email };
    throw err;
  }
}

export async function saveAttention(staffEmail, items) {
  const email = String(staffEmail || '').trim().toLowerCase();
  if (!email) return { ready: false, saved: 0 };
  const now = new Date().toISOString();
  const rows = (items || []).map(it => ({
    id: email + ':' + it.loanId,
    staff_email: email,
    loan_id: it.loanId,
    marker: it.marker,
    acknowledged_at: now
  }));
  try {
    if (!rows.length) {
      await select('ledger_attention', { select: 'id', limit: 1 });
      return { ready: true, saved: 0 };
    }
    const out = await upsert('ledger_attention', rows, 'id');
    return { ready: true, saved: out.length };
  } catch (err) {
    if (missingTable(err)) return { ready: false, saved: 0 };
    throw err;
  }
}

const LOAN_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MARKER = /^(overdue|duetoday)\|[0-9-]*\|[0-9TZ:.-]*$/;

export function cleanAttentionItems(body) {
  const items = Array.isArray(body && body.items) ? body.items.slice(0, 100) : [];
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const loanId = item && typeof item.loanId === 'string' ? item.loanId.trim() : '';
    const marker = item && typeof item.marker === 'string' ? item.marker.trim() : '';
    if (!LOAN_ID.test(loanId) || !MARKER.test(marker) || marker.length > 200) continue;
    if (seen.has(loanId)) continue;
    seen.add(loanId);
    out.push({ loanId, marker });
  }
  return out;
}
