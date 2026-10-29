// node --test tests/quik1-link.test.js
// Boots quik1/quik1-link.js in a vm context with stubbed window, localStorage, fetch,
// BroadcastChannel and timers, and checks the API contract the design-frozen app relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../quik1/quik1-link.js', import.meta.url), 'utf8');
const API = 'https://quik1.test/api/quik1';

class FakeStorage {
  constructor() { this._m = new Map(); this.throwOnSet = false; }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  setItem(k, v) { if (this.throwOnSet) throw new Error('QuotaExceeded'); this._m.set(k, String(v)); }
  removeItem(k) { this._m.delete(k); }
}

// Deterministic timers: advance() runs every due timer in order and drains microtasks between them.
class FakeTimers {
  constructor() { this.now = 1_760_000_000_000; this.q = []; this.seq = 0; }
  setTimeout(fn, ms, ...a) { const id = ++this.seq; this.q.push({ id, at: this.now + (ms || 0), fn, a }); return id; }
  setInterval(fn, ms, ...a) { const id = ++this.seq; this.q.push({ id, at: this.now + ms, fn, a, every: ms }); return id; }
  clearTimeout(id) { this.q = this.q.filter(t => t.id !== id); }
  clearInterval(id) { this.q = this.q.filter(t => t.id !== id); }
  get intervals() { return this.q.filter(t => t.every).length; }
  async advance(ms) {
    const end = this.now + ms;
    for (;;) {
      const due = this.q.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.now = due.at;
      if (due.every) due.at += due.every; else this.q = this.q.filter(t => t !== due);
      due.fn(...due.a);
      await drain();
    }
    this.now = end;
  }
}
async function drain() { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); }

function json(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
// Objects created inside the vm realm have foreign prototypes; compare them by value.
const plain = x => JSON.parse(JSON.stringify(x));
const EMPTY = { applications: [], decisions: {}, requests: [], signups: [], repayments: {} };

// Boots a fresh copy of the script. `route(call)` answers each fetch; throwing simulates a network error.
function boot(route) {
  const timers = new FakeTimers();
  const localStorage = new FakeStorage();
  const calls = [];
  const posted = [];
  let channel = null;
  class BroadcastChannel {
    constructor(name) { this.name = name; this.onmessage = null; channel = this; }
    postMessage(m) { posted.push(m); }
  }
  class FakeDate extends Date { static now() { return timers.now; } }
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    return route(call);
  };
  const listeners = {};
  const window = {
    localStorage, fetch, BroadcastChannel, QUIK1_API: API, Date: FakeDate,
    location: { origin: 'https://quik1.test' }, console: { info() {} },
    setTimeout: (...a) => timers.setTimeout(...a), clearTimeout: (...a) => timers.clearTimeout(...a),
    setInterval: (...a) => timers.setInterval(...a), clearInterval: (...a) => timers.clearInterval(...a),
    addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
  };
  window.window = window;
  vm.createContext(window);
  vm.runInContext(SRC, window, { filename: 'quik1-link.js' });
  const fire = (ev, e) => (listeners[ev] || []).forEach(fn => fn(e));
  return { Link: window.Quik1Link, calls, timers, localStorage, posted, channel: () => channel, fire };
}

const APP = { name: 'Thandi Mokoena', phone: '0824410912', amount: 2500, term: '3 mo', purpose: 'School fees', income: 12000, surplus: 3100 };
const SIGNUP = { name: 'Thandi Mokoena', idnum: '9001015009087', phone: '+27 82 441 0912', email: 't@example.com', employment: 'Permanent', employer: 'Acme', income: '12000', payday: '25th' };

test('submitApplication returns a client id synchronously and POSTs the record with that id', async () => {
  const { Link, calls, localStorage } = boot(c => json(201, { id: c.body.id, status: 'Needs decision' }));
  const id = Link.submitApplication(APP);
  assert.match(id, /^ap_[0-9a-f]{12}$/);
  const s = Link.getState();
  assert.equal(s.applications[0].id, id);
  assert.equal(s.applications[0].status, 'Needs decision');
  assert.equal(s.applications[0].source, 'app');
  assert.equal(s.applications[0].term, '3 mo');
  assert.equal(typeof s.applications[0].submittedAt, 'number');
  assert.deepEqual(JSON.parse(localStorage.getItem('quik1-link-v1')).applications[0].id, id);
  await drain();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, API + '/applications');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.equal(calls[0].body.id, id);
  assert.equal(calls[0].body.name, 'Thandi Mokoena');
  assert.equal(calls[0].body.amount, 2500);
  assert.equal(calls[0].body.term, '3 mo');
  assert.equal(calls[0].body.surplus, 3100);
  assert.equal(JSON.parse(localStorage.getItem('quik1-link-v1.outbox')).queue.length, 0, 'accepted POST leaves the outbox');
});

test('a poll that returns an approved decision reaches subscribers as decisions[id] and stops polling', async () => {
  let decided = false;
  const { Link, calls, timers } = boot(c => {
    if (c.method === 'POST') return json(201, { id: c.body.id, status: 'Needs decision' });
    if (/\/repayments\/app$/.test(c.url)) return json(200, null);
    if (!decided) return json(200, { id: c.url.split('/').pop(), status: 'Needs decision', decision: null });
    return json(200, { id: c.url.split('/').pop(), status: 'Approved', decision: { verdict: 'approved', amount: 2000, by: 'Ecoloans', note: 'ok', at: 1_760_000_100_000 } });
  });
  const seen = [];
  const unsub = Link.subscribe(s => seen.push(s));
  assert.equal(seen.length, 1, 'subscribe calls fn immediately');
  assert.deepEqual(plain(seen[0]), EMPTY);

  const id = Link.submitApplication(APP);
  await drain();
  assert.equal(timers.intervals, 1, 'undecided record + subscriber → polling');

  await timers.advance(6000);
  const gets = calls.filter(c => c.method === 'GET' && c.url === API + '/applications/' + id);
  assert.equal(gets.length, 1, 'polled once per tick');
  assert.equal(Link.decisionFor(id), null);

  decided = true;
  const before = seen.length;
  await timers.advance(6000);
  const last = seen[seen.length - 1];
  assert.ok(seen.length > before, 'subscriber notified');
  assert.equal(last.decisions[id].verdict, 'approved');
  assert.equal(last.decisions[id].amount, 2000);
  assert.equal(last.decisions[id].at, 1_760_000_100_000);
  assert.equal(last.applications[0].status, 'Approved');
  assert.equal(Link.decisionFor(id).verdict, 'approved');
  assert.equal(timers.intervals, 0, 'nothing undecided → interval cleared');

  const n = calls.length;
  await timers.advance(30000);
  assert.equal(calls.length, n, 'no more polling after the decision');
  unsub();
});

test('signups: status transitions Pending review → Approved when the server decides', async () => {
  let approved = false;
  const { Link, calls, timers } = boot(c => {
    if (c.method === 'POST') return json(201, { id: c.body.id, status: 'Pending review' });
    if (/\/repayments\/app$/.test(c.url)) return json(200, null);
    if (!approved) return json(200, { id: c.url.split('/').pop(), status: 'Pending review', decidedAt: null, by: null, note: '' });
    return json(200, { id: c.url.split('/').pop(), status: 'Approved', decidedAt: '2026-10-29T10:00:00.000Z', by: 'auto', note: 'Auto-approved by Quik1 bridge' });
  });
  const statuses = [];
  const id = Link.submitSignup(SIGNUP);
  Link.subscribe(s => { const r = s.signups.find(x => x.id === id); if (r) statuses.push(r.status); });
  assert.match(id, /^su_[0-9a-f]{12}$/);
  assert.equal(Link.getState().signups[0].status, 'Pending review');
  assert.equal(Link.getState().signups[0].reviewer, 'applications@ecoloans.co.za');
  await drain();
  const post = calls.find(c => c.method === 'POST');
  assert.equal(post.url, API + '/signups');
  assert.equal(post.body.id, id);
  assert.equal(post.body.idnum, SIGNUP.idnum);

  await timers.advance(6000);
  assert.equal(Link.getState().signups[0].status, 'Pending review');
  approved = true;
  await timers.advance(6000);
  const rec = Link.getState().signups[0];
  assert.equal(rec.status, 'Approved');
  assert.equal(rec.decidedAt, Date.parse('2026-10-29T10:00:00.000Z'));
  assert.equal(rec.by, 'auto');
  assert.deepEqual(statuses, ['Pending review', 'Approved']);
  assert.equal(timers.intervals, 0, 'signup decided → polling stops');
});

test('subscribe starts polling and unsubscribe stops it', async () => {
  const { Link, calls, timers } = boot(c => c.method === 'POST' ? json(201, { id: c.body.id, status: 'Needs decision' }) : json(200, null));
  Link.submitApplication(APP);
  await drain();
  assert.equal(timers.intervals, 0, 'no subscriber → no interval');
  const n0 = calls.length;
  await timers.advance(20000);
  assert.equal(calls.length, n0, 'no subscriber → no polling');

  const unsub = Link.subscribe(() => {});
  await drain();
  assert.ok(calls.length > n0, 'subscribe polls once immediately');
  assert.equal(timers.intervals, 1);
  unsub();
  assert.equal(timers.intervals, 0, 'unsubscribe clears the interval');
  const n1 = calls.length;
  await timers.advance(20000);
  assert.equal(calls.length, n1, 'no polling after unsubscribe');
});

test('offline: nothing throws, the record stays Needs decision, and the POST is retried later', async () => {
  let online = false;
  const { Link, calls, timers, localStorage } = boot(c => {
    if (!online) throw new TypeError('Failed to fetch');
    if (c.method === 'POST') return json(201, { id: c.body.id, status: 'Needs decision' });
    return json(200, c.url.endsWith('/repayments/app') ? null : { id: c.url.split('/').pop(), status: 'Needs decision', decision: null });
  });
  Link.subscribe(() => {});
  const id = Link.submitApplication(APP);
  await drain();
  assert.equal(Link.getState().applications[0].status, 'Needs decision');
  assert.equal(JSON.parse(localStorage.getItem('quik1-link-v1.outbox')).queue[0].id, id, 'unsent POST kept in the outbox');
  const posts = () => calls.filter(c => c.method === 'POST').length;
  assert.equal(posts(), 1);

  await timers.advance(6000);
  assert.equal(posts(), 1, 'backoff: not retried on the very next tick');
  online = true;
  await timers.advance(12000);
  assert.equal(posts(), 2, 'retried after backoff');
  assert.equal(JSON.parse(localStorage.getItem('quik1-link-v1.outbox')).queue.length, 0);
  assert.equal(Link.getState().applications[0].status, 'Needs decision');
});

test('a 4xx rejection is not retried forever; 404 on poll re-sends the record', async () => {
  const { Link, calls, timers, localStorage } = boot(c => {
    if (c.method === 'POST') return json(400, { error: 'bad' });
    return json(200, null);
  });
  Link.subscribe(() => {});
  const id = Link.submitApplication(APP);
  await drain();
  const ob = JSON.parse(localStorage.getItem('quik1-link-v1.outbox'));
  assert.equal(ob.queue.length, 0); assert.equal(ob.dead[id], true);
  const n = calls.length;
  await timers.advance(30000);
  assert.equal(calls.length, n, 'dead record is neither re-POSTed nor polled');

  let seen404 = false;
  const b2 = boot(c => {
    if (c.method === 'POST') return json(201, { id: c.body.id, status: 'Needs decision' });
    if (/\/applications\//.test(c.url)) { if (!seen404) { seen404 = true; return json(404, { error: 'not found' }); } return json(200, { id: c.url.split('/').pop(), status: 'Needs decision', decision: null }); }
    return json(200, null);
  });
  b2.Link.subscribe(() => {});
  const id2 = b2.Link.submitApplication(APP);
  await drain();
  await b2.timers.advance(6000);
  const reposts = b2.calls.filter(c => c.method === 'POST' && c.body.id === id2);
  assert.equal(reposts.length, 2, 'record re-sent after the server said 404');
});

test('submitRequest returns an rq_ id and POSTs to requests; repayments/app flows into state', async () => {
  const { Link, calls, timers } = boot(c => {
    if (c.method === 'POST') return json(201, { id: c.body.id, status: 'New' });
    if (c.url.endsWith('/repayments/app')) return json(200, { ok: true, by: 'Craig', at: '2026-10-29T09:00:00Z' });
    return json(200, null);
  });
  const id = Link.submitRequest({ type: 'New account', detail: 'Savings', name: 'Thandi', to: 'applications@ecoloans.co.za' });
  assert.match(id, /^rq_[0-9a-f]{12}$/);
  assert.equal(Link.getState().requests[0].status, 'New');
  await drain();
  const post = calls.find(c => c.method === 'POST');
  assert.equal(post.url, API + '/requests');
  assert.equal(post.body.type, 'New account');

  let repay = null;
  Link.subscribe(s => { repay = (s.repayments || {}).app || null; });
  await drain();
  assert.deepEqual(plain(repay), { ok: true, by: 'Craig', at: Date.parse('2026-10-29T09:00:00Z') });
  assert.equal(Link.repaymentFor('app').ok, true);
  assert.equal(timers.intervals, 0, 'requests do not keep the poller alive once sent');
});

test('local admin helpers and cross-tab sync keep working; storage failures never throw', async () => {
  const { Link, posted, channel, fire, localStorage } = boot(c => json(201, { id: c.body && c.body.id, status: 'Needs decision' }));
  const id = Link.submitApplication(APP);
  assert.equal(posted.length, 1, 'write broadcasts to other tabs');
  Link.decide(id, 'approved', 1500, 'Admin', 'fine');
  assert.equal(Link.decisionFor(id).amount, 1500);
  assert.equal(Link.getState().applications[0].status, 'Approved');
  Link.confirmRepayment('app', 'Admin', true);
  assert.equal(Link.repaymentFor().ok, true);
  const sid = Link.submitSignup(SIGNUP);
  Link.decideSignup(sid, 'declined', 'x', 'no');
  assert.equal(Link.getState().signups[0].status, 'Declined');

  // another tab wrote: both the channel message and the storage event re-emit the stored state
  const got = [];
  Link.subscribe(s => got.push(s.applications.length));
  localStorage.setItem('quik1-link-v1', JSON.stringify({ applications: [], decisions: {}, requests: [], signups: [] }));
  channel().onmessage({ data: { t: 'sync' } });
  fire('storage', { key: 'quik1-link-v1' });
  assert.deepEqual(got, [1, 0, 0]);

  localStorage.throwOnSet = true;
  assert.doesNotThrow(() => Link.submitApplication(APP));
  assert.doesNotThrow(() => Link.reset());
  localStorage.throwOnSet = false;
  Link.reset();
  assert.deepEqual(plain(Link.getState()), EMPTY);
});
