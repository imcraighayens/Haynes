// LEDGER's "Quik1 loan app" integration endpoints (Bearer LEDGER_KEY), shaped for the console's
// qkMap/qkPush code:
//   GET   /api/q1/applications?status=new|reviewing|approved|declined|all
//   PATCH /api/q1/applications/:id   body {status}
import { wrap, json, readBody, pathParts, searchParams, requireEnv, HttpError, STAFF_BODY_CAP } from '../_lib/http.js';
import { requireStaff } from '../_lib/auth.js';
import { select, selectOne, update, eq } from '../_lib/supabase.js';
import { APPLICATION_STATUS, applicationStatusToDb, isSafeId, num } from '../_lib/validate.js';

const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'LEDGER_KEY'];
const LIST_LIMIT = 200;

// Adds the aliases qkMap reads (term/income/submitted/docs) without renaming anything.
export function augment(row) {
  const meta = row && row.meta && typeof row.meta === 'object' ? row.meta : {};
  return {
    ...row,
    term: row.term_months == null ? 1 : row.term_months,
    income: row.net_income == null ? 0 : num(row.net_income),
    submitted: row.created_at,
    docs: Array.isArray(meta.docs) ? meta.docs : []
  };
}

async function listApplications(req, res) {
  const sp = searchParams(req);
  const wanted = (sp.get('status') || 'new').trim().toLowerCase();
  const query = { select: '*', source: eq('quik1'), order: 'created_at.desc', limit: LIST_LIMIT };
  if (wanted !== 'all') {
    const status = applicationStatusToDb(wanted);
    if (!status) throw new HttpError(400, `status must be one of ${APPLICATION_STATUS.join('|')}|all`);
    query.status = eq(status);
  }
  const rows = await select('applications', query);
  json(res, 200, rows.map(augment), req);
}

async function patchApplication(req, res, id) {
  if (!isSafeId(id)) throw new HttpError(400, 'bad application id');
  const body = await readBody(req, STAFF_BODY_CAP);
  const status = APPLICATION_STATUS.includes(String(body.status || '').toLowerCase())
    ? String(body.status).toLowerCase()
    : applicationStatusToDb(body.status);
  if (!status) throw new HttpError(400, `status must be one of ${APPLICATION_STATUS.join('|')}`);
  const existing = await selectOne('applications', { select: 'id,amount,status,source', id: eq(id), source: eq('quik1') });
  if (!existing) throw new HttpError(404, 'Application not found');
  const now = new Date().toISOString();
  const decided = status === 'approved' || status === 'declined';
  const patch = decided
    ? {
      status, decided_at: now, decided_by: 'ledger',
      // What the customer app shows: the console's verdict under the Ecoloans name.
      decision: { verdict: status, amount: num(body.amount, num(existing.amount)), by: 'Ecoloans', note: '', at: now }
    }
    : { status, decided_at: null, decided_by: null, decision: null }; // reopened / under review
  const rows = await update('applications', { id, source: 'quik1' }, patch);
  if (!rows.length) throw new HttpError(404, 'Application not found');
  json(res, 200, augment(rows[0]), req);
}

export default wrap('q1', async (req, res) => {
  requireEnv(ENV);
  requireStaff(req);
  const [head, id, ...rest] = pathParts(req, 'q1');
  if (head !== 'applications' || rest.length) throw new HttpError(404, 'Not found');
  if (!id) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    return listApplications(req, res);
  }
  if (req.method === 'PATCH' || req.method === 'POST' || req.method === 'PUT') return patchApplication(req, res, id);
  if (req.method === 'GET') {
    if (!isSafeId(id)) throw new HttpError(400, 'bad application id');
    const row = await selectOne('applications', { select: '*', id: eq(id), source: eq('quik1') });
    if (!row) throw new HttpError(404, 'Application not found');
    return json(res, 200, augment(row), req);
  }
  throw new HttpError(405, 'Method not allowed');
});
