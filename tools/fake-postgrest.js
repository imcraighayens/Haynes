// fake-postgrest.js — an in-memory stand-in for Supabase's PostgREST, just enough for
// api/_lib/supabase.js (and nothing the real handlers never send).
//
// Supported:
//   GET    /rest/v1/:table?select=a,b&col=eq.v&col=in.(a,b)&order=col.asc|desc&limit=n      (+ Prefer: count=exact → Content-Range)
//   POST   /rest/v1/:table                                                       insert; duplicate id → 409 code 23505
//   POST   /rest/v1/:table?on_conflict=id   Prefer: resolution=merge-duplicates   upsert (merge provided columns)
//                                           Prefer: resolution=ignore-duplicates  insert-if-absent
//   PATCH  /rest/v1/:table?col=eq.v                                              update matching rows
//   DELETE                                                                       always 405 — the bridge must never delete
// Everything else answers 400/404 with a PostgREST-shaped {code, message} body.
//
// `createFakePostgrest(seed)` returns { db, log, handle(url, init) → Response, reset() }.
// `install(fake, baseUrl)` wraps globalThis.fetch so requests to baseUrl are served from memory.

export function createFakePostgrest(seed = {}) {
  const base = clone(seed);
  let db = clone(base);
  const log = []; // { method, table, rows|patch, filters, prefer } for every write
  let hidden = new Map(); // table -> Set of column names that answer 42703

  function reset(next) { if (next) Object.assign(base, clone(next)); db = clone(base); log.length = 0; hidden = new Map(); }

  function pkOf(table) { return table === 'q1_repayments' ? 'key' : 'id'; }
  function rowsOf(table) {
    if (!(table in db)) return null; // unknown relation
    if (!Array.isArray(db[table])) db[table] = db[table] ? [db[table]] : [];
    return db[table];
  }

  function parseFilters(sp) {
    const filters = [];
    for (const [k, v] of sp.entries()) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
      const inn = /^in\.\((.*)\)$/s.exec(v);
      if (inn) {
        const parts = inn[1].length ? inn[1].split(',').map(s => s.trim().replace(/^"|"$/g, '')) : [];
        filters.push({ col: k, op: 'in', val: parts });
        continue;
      }
      const m = /^(eq|neq|is|gt|gte|lt|lte|ilike)\.(.*)$/s.exec(v);
      if (!m) throw httpError(400, 'PGRST100', `unsupported filter ${k}=${v}`);
      filters.push({ col: k, op: m[1], val: m[2] });
    }
    return filters;
  }
  function matches(row, filters) {
    return filters.every(f => {
      const a = row[f.col];
      switch (f.op) {
        case 'eq': return String(a) === f.val && a !== null && a !== undefined;
        case 'in': return a != null && Array.isArray(f.val) && f.val.includes(String(a));
        case 'neq': return String(a) !== f.val;
        case 'is': return f.val === 'null' ? a == null : String(a) === f.val;
        case 'gt': return cmp(a, f.val) > 0;
        case 'gte': return cmp(a, f.val) >= 0;
        case 'lt': return cmp(a, f.val) < 0;
        case 'lte': return cmp(a, f.val) <= 0;
        case 'ilike': {
          if (a == null) return false;
          const cell = String(a).toLowerCase();
          const pat = String(f.val).toLowerCase();
          if (!pat.includes('%') && !pat.includes('_')) return cell === pat;
          const re = new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$');
          return re.test(cell);
        }
        default: return false;
      }
    });
  }
  function cmp(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return -1; if (b == null) return 1;
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  }
  function order(rows, spec) {
    if (!spec) return rows;
    const parts = spec.split(',').map(s => s.trim()).filter(Boolean).map(s => { const [col, dir] = s.split('.'); return { col, desc: dir === 'desc' }; });
    return rows.slice().sort((x, y) => {
      for (const p of parts) { const c = cmp(x[p.col], y[p.col]); if (c) return p.desc ? -c : c; }
      return 0;
    });
  }
  function project(rows, select) {
    const sel = (select || '*').trim();
    if (sel === '*' || sel === '') return rows.map(r => clone(r));
    const cols = sel.split(',').map(s => s.trim()).filter(Boolean);
    return rows.map(r => Object.fromEntries(cols.map(c => [c, r[c] === undefined ? null : clone(r[c])])));
  }

  // The live columns that are NOT NULL without a default the handlers could lean on; the real
  // PostgREST answers 23502 for these and the fake must not hide that.
  const NOT_NULL = { loans: ['principal_derived'] };
  function checkNotNull(table, row) {
    for (const col of NOT_NULL[table] || []) if (col in row && row[col] === null) throw httpError(400, '23502', `null value in column "${col}" violates not-null constraint`);
  }
  function nowIso() { return new Date().toISOString(); }
  function stamp(table, row, isNew) {
    // Mimic the DB defaults the handlers rely on: created_at for list ordering, updated_at everywhere.
    if (isNew && !('created_at' in row) && !['audit_log', 'bank_tx', 'q1_repayments'].includes(table)) row.created_at = nowIso();
    if (table !== 'q1_repayments') row.updated_at = nowIso();
    return row;
  }

  function handle(url, init = {}) {
    const u = new URL(String(url));
    const method = String(init.method || 'GET').toUpperCase();
    const headers = lowerHeaders(init.headers);
    const prefer = headers.prefer || '';
    // Test double for GoTrue's password grant. Production never uses this process;
    // the real handler calls SUPABASE_URL/auth/v1/token. Directory comes from the
    // test-only env the boot harness sets. The password is not written to `log`.
    if (u.pathname === '/auth/v1/token' && method === 'POST') {
      let body = null;
      try { body = init.body == null ? null : (typeof init.body === 'string' ? JSON.parse(init.body) : init.body); } catch { body = null; }
      let directory = {};
      try { directory = JSON.parse(process.env.LEDGER_STAFF_TEST_LOGINS || '{}'); } catch { directory = {}; }
      const email = String((body && body.email) || '').trim().toLowerCase();
      const row = directory && typeof directory === 'object' ? directory[email] : null;
      const password = body && body.password != null ? String(body.password) : '';
      if (!row || password !== String(row.password || '')) {
        return respond(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      return respond(200, {
        access_token: 'test-access-token', token_type: 'bearer', expires_in: 3600, refresh_token: 'test-refresh-token',
        user: { id: 'user-' + email, email, user_metadata: { full_name: String(row.name || '') } }
      });
    }
    if (u.pathname.startsWith('/storage/v1/object')) {
      if (!db._storage || typeof db._storage !== 'object') db._storage = {};
      if (u.pathname.includes('/object/sign/')) {
        const signedPath = decodeURIComponent(u.pathname.split('/object/sign/')[1] || '');
        if (!db._storage[signedPath]) return respond(404, { code: '404', message: 'not found' });
        return respond(200, { signedURL: '/object/sign/' + signedPath + '?token=test' });
      }
      const raw = u.pathname.replace(/^\/storage\/v1\/object\//, '');
      const parts = raw.split('/').map(seg => { try { return decodeURIComponent(seg); } catch { return seg; } });
      const bucket = parts.shift();
      const key = parts.join('/');
      if (method !== 'POST') return respond(405, { code: '405', message: 'method' });
      const size = init.body == null ? 0 : (typeof init.body === 'string' ? init.body.length : (init.body.byteLength || init.body.length || 0));
      db._storage[bucket + '/' + key] = { size, type: headers['content-type'] || '' };
      log.push({ method: 'POST', table: 'storage', rows: [{ path: key, size }], filters: [], prefer });
      return respond(200, { Key: key });
    }
    const m = /^\/rest\/v1\/([^/]+)\/?$/.exec(u.pathname);
    try {
      if (!m) throw httpError(404, 'PGRST000', 'not a rest/v1 path');
      const table = decodeURIComponent(m[1]);
      const rows = rowsOf(table);
      if (!rows) throw httpError(404, '42P01', `relation "public.${table}" does not exist`);
      const sp = u.searchParams;
      const filters = parseFilters(sp);
      const body = init.body == null ? null : (typeof init.body === 'string' ? JSON.parse(init.body) : init.body);
      const pk = pkOf(table);
      const wantRep = /return=representation/.test(prefer);
      const missing = hidden.get(table);
      if (missing && missing.size) {
        const cols = [];
        const sel = sp.get('select');
        if (sel && sel.trim() && sel.trim() !== '*') sel.split(',').forEach(s => { const c = s.trim(); if (c) cols.push(c); });
        const addKeys = row => { if (row && typeof row === 'object' && !Array.isArray(row)) cols.push(...Object.keys(row)); };
        if (Array.isArray(body)) body.forEach(addKeys); else addKeys(body);
        for (const col of cols) {
          if (missing.has(col)) throw httpError(400, '42703', `column "${col}" of relation "${table}" does not exist`);
        }
      }

      if (method === 'GET' || method === 'HEAD') {
        let out = order(rows.filter(r => matches(r, filters)), sp.get('order'));
        const total = out.length;
        const offset = sp.has('offset') ? Math.max(0, parseInt(sp.get('offset'), 10) || 0) : 0;
        if (offset) out = out.slice(offset);
        if (sp.has('limit')) out = out.slice(0, Math.max(0, parseInt(sp.get('limit'), 10) || 0));
        const extra = {};
        if (/count=exact/.test(prefer)) extra['Content-Range'] = `${offset}-${Math.max(offset + out.length - 1, 0)}/${total}`;
        return respond(200, method === 'HEAD' ? '' : project(out, sp.get('select')), extra);
      }

      if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        if (!list.length || list.some(r => !r || typeof r !== 'object')) throw httpError(400, 'PGRST102', 'body must be rows');
        const onConflict = sp.get('on_conflict');
        const resolution = /resolution=ignore-duplicates/.test(prefer) ? 'ignore' : /resolution=merge-duplicates/.test(prefer) ? 'merge' : null;
        if (onConflict && onConflict !== pk) throw httpError(400, '42P10', `no unique constraint matching ON CONFLICT (${onConflict})`);
        const written = [];
        for (const r of list) {
          const id = r[pk];
          if (id == null || id === '') throw httpError(400, '23502', `null value in column "${pk}"`);
          checkNotNull(table, r);
          const i = rows.findIndex(x => String(x[pk]) === String(id));
          if (i >= 0) {
            if (!onConflict || !resolution) throw httpError(409, '23505', `duplicate key value violates unique constraint "${table}_pkey"`);
            if (resolution === 'ignore') continue;
            Object.assign(rows[i], clone(r)); stamp(table, rows[i], false); written.push(rows[i]);
          } else {
            const row = stamp(table, clone(r), true); rows.push(row); written.push(row);
          }
        }
        log.push({ method: 'POST', table, resolution: onConflict ? resolution : 'insert', rows: clone(list), count: written.length, prefer });
        return respond(201, wantRep ? project(written, sp.get('select')) : '');
      }

      if (method === 'PATCH') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'PGRST102', 'patch must be an object');
        checkNotNull(table, body);
        const hit = rows.filter(r => matches(r, filters));
        hit.forEach(r => { Object.assign(r, clone(body)); stamp(table, r, false); });
        log.push({ method: 'PATCH', table, filters: clone(filters), patch: clone(body), count: hit.length, prefer });
        return respond(wantRep ? 200 : 204, wantRep ? project(hit, sp.get('select')) : '');
      }

      if (method === 'DELETE') {
        log.push({ method: 'DELETE', table, filters: clone(filters), count: 0, prefer });
        throw httpError(405, 'P0001', 'hard deletes are blocked'); // same as the live trigger
      }
      throw httpError(405, 'PGRST000', `method ${method} not supported`);
    } catch (e) {
      if (e && e.pgrst) return respond(e.status, { code: e.code, message: e.message, details: null, hint: null });
      return respond(500, { code: 'XX000', message: String((e && e.message) || e) });
    }
  }

  return {
    get db() { return db; },
    log, handle, reset,
    table(name) { return rowsOf(name) || []; },
    find(name, id) { const pk = pkOf(name); return (rowsOf(name) || []).find(r => String(r[pk]) === String(id)) || null; },
    writes(table, method) { return log.filter(w => (!table || w.table === table) && (!method || w.method === method)); },
    hideColumns(table, cols) { hidden.set(table, new Set(cols)); }
  };
}

// Routes fetch(baseUrl/...) to the fake; everything else goes to the previous fetch.
export function install(fake, baseUrl) {
  const prev = globalThis.fetch;
  const base = String(baseUrl).replace(/\/+$/, '');
  globalThis.fetch = async function fakeFetch(url, init) {
    const s = typeof url === 'string' ? url : (url && url.url) || String(url);
    if (s.startsWith(base + '/')) return fake.handle(s, init);
    if (!prev) throw new Error('No real fetch available for ' + s);
    return prev(url, init);
  };
  return () => { globalThis.fetch = prev; };
}

function httpError(status, code, message) { const e = new Error(message); e.pgrst = true; e.status = status; e.code = code; return e; }
function respond(status, body, extra = {}) {
  const text = body === '' || body === undefined ? '' : JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', ...extra };
  return new Response(status === 204 ? null : text, { status, headers });
}
function lowerHeaders(h) {
  const out = {};
  if (!h) return out;
  if (typeof h.forEach === 'function' && !Array.isArray(h)) { h.forEach((v, k) => { out[String(k).toLowerCase()] = String(v); }); return out; }
  Object.keys(h).forEach(k => { out[k.toLowerCase()] = String(h[k]); });
  return out;
}
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
