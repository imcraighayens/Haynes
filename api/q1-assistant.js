// Staff chat behind the existing Ledger Q1 icon. POST /api/q1-assistant
// Bearer LEDGER_KEY or the same-origin unlock cookie. Both answer from
// loadLiveBook (the same rows GET /api/ledger/state serves). The browser DATA
// block is only the current screen, unless that live load fails.
// No Claude call and no AI gateway key. A key pasted into the body is never a
// credential.
//
// q1_requests stays the Quik1 customer inbox (POST /api/quik1/requests). This
// route does not write there.
import { wrap, json, readBody, requireEnv, HttpError } from './_lib/http.js';
import { requireStaff } from './_lib/auth.js';
import { select, selectOne, eq } from './_lib/supabase.js';
import { cleanText, isSafeId } from './_lib/validate.js';
import { missingRelation } from './_lib/inbox.js';
import { parseLedgerData, mergeBook, answerQuestion } from './_lib/q1-brain.js';
import { notifyQ1Webhook, scrubSecrets } from './_lib/q1-webhook.js';

const BODY_CAP = 256 * 1024;

// Keep newlines. cleanText() folds every control character, which would erase the
// console DATA block the answerer splits on line boundaries.
function clip(v, max) {
  if (v == null) return '';
  return String(v).replace(/\u0000/g, '').slice(0, max);
}

function sanitizeApps(apps) {
  if (!Array.isArray(apps)) return [];
  return apps.slice(0, 12).map(a => ({
    name: cleanText(a && a.name, 80),
    actions: !!(a && (a.actions === true || a.actions === 'true')),
    path: cleanText(a && a.path, 180)
  })).filter(a => a.name);
}

function historyOf(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-8).map(h => ({
    role: h && h.role === 'user' ? 'user' : 'bot',
    text: cleanText(h && (h.text || h.content), 1500)
  })).filter(h => h.text);
}

function openingBalance(settings) {
  if (!settings || settings.bank_opening_balance == null || settings.bank_opening_balance === '') return null;
  const n = Number(settings.bank_opening_balance);
  return Number.isFinite(n) ? n : null;
}

function openingAtIso(settings) {
  const raw = settings && settings.bank_opening_at;
  const ms = Date.parse(raw);
  if (!raw || Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

// Same sum the console's bankNow() applies: confirmed opening, plus every movement after it.
function balanceAfter(opening, openingAt, rows) {
  const cutoff = Date.parse(openingAt);
  let delta = 0;
  for (const t of rows || []) {
    if (!t) continue;
    const at = Date.parse(t.at);
    if (!Number.isFinite(at) || !(at > cutoff)) continue;
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) continue;
    delta += t.type === 'in' ? amt : -amt;
  }
  return Math.round((opening + delta) * 100) / 100;
}

// null means the live book could not be loaded in full. A cookie session then
// falls back to the browser DATA block. An empty array is a real empty section.
export async function loadLiveBook() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  let clients, loans, employees, expenses, settings;
  try {
    // No row cap. select() pages until the count is complete, in a stable order.
    [clients, loans, employees, expenses, settings] = await Promise.all([
      select('clients', { select: 'id,ref,name,blocked,deleted_at', order: 'id.asc' }),
      select('loans', { select: 'id,ref,client_id,principal,instalment_amount,status,schedule,instalments_paid,deleted_at', order: 'id.asc' }),
      select('employees', { select: 'id,name,role,active', order: 'id.asc' }),
      select('expenses', { select: 'id,name,amount,deleted_at', order: 'id.asc' }),
      selectOne('settings', { select: 'id,bank_opening_balance,bank_opening_at', id: eq('org') })
    ]);
  } catch {
    return null;
  }
  let applications;
  try {
    applications = await select('applications', { select: 'id,ref,name,amount,status,source,created_at', order: 'created_at.desc,id.asc' });
  } catch (err) {
    if (!missingRelation(err)) return null;
    applications = [];
  }
  const opening = openingBalance(settings);
  const openingAt = openingAtIso(settings);
  let bank = opening;
  if (opening != null && openingAt) {
    let rows;
    try {
      rows = await select('bank_tx', { select: 'at,type,amount', order: 'at.asc,id.asc', at: 'gt.' + openingAt });
    } catch {
      return null;
    }
    bank = balanceAfter(opening, openingAt, rows);
  }
  const people = (clients || []).filter(c => c && !c.deleted_at);
  const byId = new Map(people.map(c => [c.id, c]));
  return {
    clients: people.map(c => ({ id: c.id, ref: c.ref || '', name: c.name || '—', blocked: !!c.blocked })),
    loans: (loans || []).filter(l => l && !l.deleted_at).map(l => {
      const c = byId.get(l.client_id) || {};
      return {
        ref: l.ref || '',
        client: c.name || '—',
        clientRef: c.ref || '',
        blocked: !!c.blocked,
        status: l.status || '',
        principal: Number(l.principal) || 0,
        instalment: Number(l.instalment_amount) || 0,
        schedule: Array.isArray(l.schedule) ? l.schedule : [],
        paid: Number(l.instalments_paid) || 0
      };
    }),
    applications: (applications || []).filter(a => a && isSafeId(String(a.id || ''))).map(a => ({
      id: a.id,
      ref: a.ref || '',
      name: a.name || '',
      amount: Number(a.amount) || 0,
      status: a.status || '',
      source: a.source || ''
    })),
    employees: (employees || []).filter(e => e && e.active !== false && !e.deleted_at).map(e => ({ name: e.name || '—', role: e.role || '' })),
    expenses: (expenses || []).filter(e => e && !e.deleted_at).map(e => ({ name: e.name || '—', amount: Number(e.amount) || 0 })),
    bank
  };
}

export default wrap('q1-assistant', async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  requireEnv(['LEDGER_KEY']);
  // #15 made requireStaff async (active-employee check). A bare call would
  // let unauthenticated and cross-site requests answer before the 401 lands.
  await requireStaff(req);
  const body = await readBody(req, BODY_CAP);
  const message = cleanText(body.message ?? body.text, 2000);
  if (!message) throw new HttpError(400, 'message is required');
  const parsed = parseLedgerData(clip(body.data, 100000));
  if (body.page) parsed.page = cleanText(body.page, 40);
  // Cookie and Bearer sessions share this path. body.key / apikey are not read.
  let live = null;
  try { live = await loadLiveBook(); } catch { live = null; }
  const snap = live
    ? mergeBook(parsed, live, new Date(), { preferLive: true })
    : mergeBook(parsed, null);
  const source = live ? 'server' : 'browser-fallback';
  snap.apps = sanitizeApps(body.apps);
  snap.appsNote = scrubSecrets(clip(body.appsNote, 4000)).slice(0, 4000);
  const result = answerQuestion(message, snap, historyOf(body.history));
  await notifyQ1Webhook({ source: 'ledger-q1', page: snap.page, message });
  const payload = {
    reply: result.reply,
    action: result.action,
    call: result.call,
    connected: true,
    source
  };
  json(res, 200, payload, req);
});
