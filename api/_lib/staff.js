// Staff sign-in against the Ledger Supabase project (https://rcektqecduuzqqmcsgat.supabase.co).
// GoTrue checks the password. The allowlist is public.employees (active row, case-insensitive
// email) — the same rule as auth_signup_allowlist. There is no second password table and no
// invented address for the open second slot. LEDGER_KEY is not a staff password.
import { staffFetch, select, eq } from './supabase.js';

export function normEmail(v) {
  return String(v ?? '').trim().toLowerCase();
}

// Active employees only. Returns the row or null. Same predicate as the sign-up trigger:
// lower(email) match and active.
export async function isAllowlistedEmployee(email) {
  const n = normEmail(email);
  if (!n || n.length > 254 || /[%_\\]/.test(n)) return null;
  const rows = await select('employees', {
    select: 'id,name,email,role,active',
    email: 'ilike.' + n,
    active: eq(true),
    limit: 5
  });
  return (rows || []).find(r => r && r.active !== false && normEmail(r.email) === n) || null;
}

function displayNameOf(user) {
  const meta = user && user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  const name = String(meta.full_name || meta.name || meta.display_name || '').trim();
  return name.slice(0, 80);
}

// { ok:true, staff:{email, displayName} } or { ok:false, status }.
// Allowlist misses and rejected credentials both come back as 401. The GoTrue error body is dropped.
export async function signInStaff(email, password) {
  const submitted = normEmail(email);
  const pw = password == null ? '' : String(password);
  if (!pw || pw.length > 1024) return { ok: false, status: 401 };

  let res;
  try {
    res = await staffFetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email: submitted, password: pw },
      timeoutMs: 8000
    });
  } catch {
    return { ok: false, status: 503 };
  }
  if (!res.ok || res.status >= 500) return { ok: false, status: res.status >= 500 ? 503 : 401 };
  const user = res.data && res.data.user;
  const confirmed = normEmail(user && user.email);
  if (!confirmed || confirmed !== submitted) return { ok: false, status: 401 };
  let employee;
  try { employee = await isAllowlistedEmployee(confirmed); }
  catch { return { ok: false, status: 503 }; }
  // Same 401 for a bad password (handled above) and for an account that is not an active employee.
  if (!employee) return { ok: false, status: 401 };
  const displayName = displayNameOf(user) || String(employee.name || '').trim().slice(0, 80) || confirmed;
  return { ok: true, staff: { email: confirmed, displayName } };
}
