// Minimal PostgREST client over global fetch using the service-role key. The service role
// bypasses RLS, so the discipline the database enforces for staff (no DELETE, append-only
// audit_log) is enforced here in code: there is deliberately no `remove()` method.
import { HttpError } from './http.js';

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'Server not configured');
  return { url: url.replace(/\/+$/, ''), key };
}

function qs(query) {
  if (!query) return '';
  if (typeof query === 'string') return query.replace(/^\?/, '');
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach(x => sp.append(k, String(x)));
    else sp.append(k, String(v));
  }
  return sp.toString();
}

// PostgREST filter value: `eq.<value>` with the value percent-encoded by URLSearchParams.
export function eq(value) { return `eq.${String(value)}`; }

async function request(method, table, query, { body, prefer, headers } = {}) {
  const { url, key } = env();
  const q = qs(query);
  const target = `${url}/rest/v1/${encodeURIComponent(table)}${q ? '?' + q : ''}`;
  const h = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(prefer ? { Prefer: prefer } : {}),
    ...(headers || {})
  };
  let res;
  try {
    res = await fetch(target, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new HttpError(502, 'Database unreachable');
  }
  const text = typeof res.text === 'function' ? await res.text() : '';
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!res.ok) {
    // Surface the PostgREST error code (e.g. 23505 duplicate, 42P01 missing table) but never
    // its message/details, which can echo row values.
    const code = data && typeof data === 'object' && data.code ? String(data.code) : String(res.status);
    const err = new HttpError(res.status === 404 ? 502 : (res.status >= 500 ? 502 : 502), `Database error ${code}`);
    err.code = code; err.upstream = res.status;
    throw err;
  }
  const get = name => (res.headers && typeof res.headers.get === 'function') ? res.headers.get(name) : (res.headers && res.headers[name]) || null;
  return { data, status: res.status, contentRange: get('content-range') };
}

export async function select(table, query) {
  const { data } = await request('GET', table, query);
  return Array.isArray(data) ? data : (data == null ? [] : [data]);
}

export async function selectOne(table, query) {
  const rows = await select(table, { ...(typeof query === 'string' ? Object.fromEntries(new URLSearchParams(query)) : query), limit: 1 });
  return rows[0] || null;
}

// Exact row count for a filter; falls back to the page length if the header is absent.
export async function count(table, query) {
  const { data, contentRange } = await request('GET', table, { select: 'id', ...(query || {}), limit: 1 }, { prefer: 'count=exact' });
  const m = contentRange && /\/(\d+)\s*$/.exec(String(contentRange));
  if (m) return Number(m[1]);
  return Array.isArray(data) ? data.length : 0;
}

export async function insert(table, rows, { returning = true } = {}) {
  const list = Array.isArray(rows) ? rows : [rows];
  const { data } = await request('POST', table, undefined, { body: list, prefer: returning ? 'return=representation' : 'return=minimal' });
  return Array.isArray(data) ? data : [];
}

export async function upsert(table, rows, onConflict = 'id', { ignoreDuplicates = false, returning = true } = {}) {
  const list = Array.isArray(rows) ? rows : [rows];
  const resolution = ignoreDuplicates ? 'ignore-duplicates' : 'merge-duplicates';
  const { data } = await request('POST', table, { on_conflict: onConflict }, {
    body: list, prefer: `resolution=${resolution},return=${returning ? 'representation' : 'minimal'}`
  });
  return Array.isArray(data) ? data : [];
}

// match: { col: value } → `col=eq.value` filters. Returns the updated rows.
export async function update(table, match, patch) {
  if (!match || !Object.keys(match).length) throw new HttpError(400, 'update needs a match');
  const query = {};
  for (const [k, v] of Object.entries(match)) query[k] = eq(v);
  const { data } = await request('PATCH', table, query, { body: patch, prefer: 'return=representation' });
  return Array.isArray(data) ? data : [];
}
