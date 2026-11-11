// node --test tests/api/inbox-feed.test.js
// Staff inbox + q1 list: website rows stay, unknown sources stay out, PGRST205 does not 502.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ENV = {
  SUPABASE_URL: 'https://db.test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-NEVER-RETURN',
  LEDGER_KEY: 'ledger-test-key-0123456789abcdef'
};
const KEY = ENV.LEDGER_KEY;
Object.assign(process.env, ENV);

const q1 = (await import('../../api/q1.js')).default;
const ledger = (await import('../../api/ledger.js')).default;

function makeRes() {
  const res = {
    statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; }
  };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}

async function call(handler, { method = 'GET', path = [], url, headers = {}, body } = {}) {
  const req = {
    method,
    query: { path },
    url: url || '/api/' + path.join('/'),
    headers: { authorization: 'Bearer ' + KEY, ...headers },
    body
  };
  const res = makeRes();
  Object.assign(process.env, ENV);
  await handler(req, res);
  return res;
}

let calls = [];
function stubFetch(route) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const rec = {
      url: u,
      table: u.pathname.split('/').pop(),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : undefined
    };
    calls.push(rec);
    const out = (await route(rec)) || { status: 200, body: [] };
    const text = out.body === undefined ? '' : JSON.stringify(out.body);
    return {
      ok: out.status < 400,
      status: out.status,
      headers: new Headers(out.headers || {}),
      text: async () => text,
      json: async () => JSON.parse(text || 'null')
    };
  };
}

const web = {
  id: 'ew_aabbccddeeff', ref: 'EW-1085', name: 'Web Applicant', phone: '0800000000', email: null,
  id_number: null, employer: null, job_title: null, net_income: 0, bank: null, amount: 1500,
  term_months: 1, purpose: 'Stock', source: 'ecoloan_web', status: 'new', client_id: null,
  created_at: '2026-11-01T08:00:00.000Z', meta: { docs: ['id.pdf'] }, decision: null
};
const quick = {
  id: 'ap_0123456789ab', ref: 'AP-1086', name: 'App Applicant', phone: '0800000001', email: null,
  id_number: null, employer: null, job_title: null, net_income: 9000, bank: null, amount: 800,
  term_months: 3, purpose: 'Fees', source: 'quik1', status: 'new', client_id: null,
  created_at: '2026-11-02T08:00:00.000Z', meta: { docs: [] }, decision: null
};
const returning = {
  ...quick, id: 'ap_abcdefabcdef', name: 'Returning Applicant', client_id: 'c_existing', amount: 400
};
const other = {
  id: 'zz_001', ref: 'ZZ-1', name: 'Other Applicant', phone: '0800000002', amount: 100,
  term_months: 1, purpose: 'Other', source: 'partner_api', status: 'new', client_id: null,
  created_at: '2026-11-03T08:00:00.000Z', meta: {}
};

function relationError(code, table) {
  const message = code === 'PGRST205'
    ? `Could not find the table 'public.${table}' in the schema cache`
    : `relation "public.${table}" does not exist`;
  return { status: 404, body: { code, message, details: null, hint: null } };
}

test('staff inbox includes a website row and a quik1 row, and drops an unknown source', async () => {
  stubFetch(rec => {
    if (rec.table === 'applications') return { status: 200, body: [web, quick, returning, other] };
    return { status: 200, body: [] };
  });
  const res = await call(ledger, { path: ['quik1-feed'], url: '/api/ledger/quik1-feed' });
  assert.equal(res.statusCode, 200);
  const rows = res.json().applications;
  const site = rows.find(a => a.extId === 'ew_aabbccddeeff');
  assert.ok(site);
  assert.equal(site.id, 'ew_aabbccddeeff');
  assert.equal(site.source, 'Website');
  assert.equal(site.name, 'Web Applicant');
  assert.equal(site.status, 'new');
  const plain = rows.find(a => a.extId === 'ap_0123456789ab');
  assert.ok(plain);
  assert.equal(plain.id, 'qk_ap_0123456789ab');
  assert.equal(plain.source, 'Quik1 app');
  const back = rows.find(a => a.extId === 'ap_abcdefabcdef');
  assert.equal(back.source, 'Quik1 · existing client');
  assert.equal(rows.some(a => a.id === 'zz_001' || a.extId === 'zz_001' || String(a.id).includes('zz_001')), false);
  const query = calls.find(c => c.table === 'applications').url.searchParams;
  assert.equal(query.get('source'), 'in.(quik1,ecoloan_web)');
  assert.equal(JSON.stringify(res.json()).includes('service-role-secret'), false);
});

test('q1 list includes the website row with its ew_ id and still returns the quik1 row', async () => {
  stubFetch(() => ({ status: 200, body: [web, quick, other] }));
  const res = await call(q1, { path: ['applications'], url: '/api/q1/applications?status=new' });
  assert.equal(res.statusCode, 200);
  const rows = res.json();
  const site = rows.find(a => a.id === 'ew_aabbccddeeff');
  assert.ok(site);
  assert.equal(site.id, 'ew_aabbccddeeff');
  assert.equal(site.source, 'ecoloan_web');
  assert.equal(site.term, 1);
  assert.deepEqual(site.docs, ['id.pdf']);
  const plain = rows.find(a => a.id === 'ap_0123456789ab');
  assert.ok(plain);
  assert.equal(plain.name, 'App Applicant');
  assert.equal(plain.term, 3);
  assert.equal(plain.income, 9000);
  assert.equal(rows.some(a => a.id === 'zz_001' || a.source === 'partner_api'), false);
  assert.equal(calls[0].url.searchParams.get('source'), 'in.(quik1,ecoloan_web)');
  assert.equal(calls[0].url.searchParams.get('status'), 'eq.new');
});

test('quik1-feed PGRST205 returns an empty applications list and keeps the rest, with a warning and no 5xx', async () => {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
  try {
    stubFetch(rec => {
      if (rec.table === 'applications') return relationError('PGRST205', 'applications');
      if (rec.table === 'q1_messages') {
        return { status: 200, body: [{ id: 'qm_1', client_id: 'c_feed_1', author: 'borrower', body: 'Hello from the client', created_at: '2026-11-01T09:00:00.000Z' }] };
      }
      if (rec.table === 'clients') {
        return { status: 200, body: [{ id: 'c_feed_1', ref: 'EC-001', name: 'Feed Client', deleted_at: null }] };
      }
      return { status: 200, body: [] };
    });
    const res = await call(ledger, { path: ['quik1-feed'], url: '/api/ledger/quik1-feed' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.statusCode < 500);
    assert.deepEqual(res.json().applications, []);
    assert.equal(res.json().threads.length, 1);
    assert.equal(res.json().threads[0].lines[0].body, 'Hello from the client');
    assert.ok(warnings.some(line => /quik1-feed/.test(line) && /PGRST205/.test(line)));
    assert.equal(warnings.some(line => /schema cache/i.test(line)), false);
    assert.equal(JSON.stringify(res.json()).includes('schema cache'), false);
  } finally {
    console.warn = orig;
  }
});

test('q1 list PGRST205 returns an empty list and a warning, not a 502', async () => {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
  try {
    stubFetch(() => relationError('PGRST205', 'applications'));
    const res = await call(q1, { path: ['applications'], url: '/api/q1/applications' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), []);
    assert.ok(warnings.some(line => /\[q1\]/.test(line) && /PGRST205/.test(line)));
    assert.equal(JSON.stringify(res.json()).includes('schema cache'), false);
  } finally {
    console.warn = orig;
  }
});

test('a real database error on the inbox list is still a 502', async () => {
  stubFetch(rec => {
    if (rec.table === 'applications') return { status: 500, body: { code: 'XX000', message: 'secret internals' } };
    return { status: 200, body: [] };
  });
  const feed = await call(ledger, { path: ['quik1-feed'], url: '/api/ledger/quik1-feed' });
  assert.equal(feed.statusCode, 502);
  assert.equal(feed.json().error, 'Database error XX000');
  stubFetch(() => ({ status: 500, body: { code: 'XX000', message: 'secret internals' } }));
  const list = await call(q1, { path: ['applications'], url: '/api/q1/applications' });
  assert.equal(list.statusCode, 502);
  assert.equal(list.json().error, 'Database error XX000');
});
