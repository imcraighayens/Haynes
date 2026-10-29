/* Quik1 link — customer-side state bridge, backed by the Ecoloans API.

   Same public API as the original same-origin version (quik1/original/quik1-link.local.js),
   so the design-frozen app keeps calling getState/subscribe/submit* unchanged. What differs:
   every record the customer creates is also POSTed to /api/quik1 (so LEDGER receives the
   loan application) and its decision is polled back into the same local state the app reads.

   Rules this file lives by:
   - never throw into the app: every network/storage failure is swallowed and retried later;
   - work offline: records stay 'Needs decision' / 'Pending review' until the network returns;
   - poll only while someone is listening and something is still undecided;
   - keep two tabs in step (BroadcastChannel + the storage event, as before). */
(function (w) {
  var KEY = 'quik1-link-v1';               // own records, in the exact shape the app reads
  var OUTBOX_KEY = 'quik1-link-v1.outbox'; // unsent POSTs + ids the server refused for good
  var CHANNEL = 'quik1-link';
  var POLL_MS = 6000;
  var MAX_BACKOFF_MS = 5 * 60 * 1000;
  var MAX_POLL_AGE_MS = 7 * 24 * 60 * 60 * 1000; // stop asking about week-old records
  var FETCH_TIMEOUT_MS = 15000;

  var subs = [];
  var timer = null;
  var inflight = {}; // request keys on the wire from this tab (avoids duplicate polls/POSTs)

  // ---------- small helpers ----------
  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function isObj(x) { return !!x && typeof x === 'object' && !isArr(x); }
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function same(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } }
  function safe(fn) { try { return fn(); } catch (e) { info('swallowed', e && e.message); } }
  function info() { try { if (w.console && w.console.info) w.console.info.apply(w.console, ['[quik1-link]'].concat([].slice.call(arguments))); } catch (e) {} }

  // Server timestamps may arrive as ms, ISO strings or be missing; the app compares
  // decision.at between polls, so a missing value must stay stable (keep the previous one).
  function ms(x, prev) {
    if (typeof x === 'number' && isFinite(x)) return x;
    if (typeof x === 'string' && x) { var n = Number(x); if (isFinite(n)) return n; var p = Date.parse(x); if (isFinite(p)) return p; }
    return typeof prev === 'number' ? prev : Date.now();
  }

  function hex12() {
    var out = '', i;
    try {
      var a = new Uint8Array(6);
      (w.crypto || crypto).getRandomValues(a);
      for (i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2);
      return out;
    } catch (e) {}
    while (out.length < 12) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  function apiBase() {
    var base = w.QUIK1_API || (((w.location && w.location.origin) || '') + '/api/quik1');
    return String(base).replace(/\/+$/, '');
  }

  // ---------- local state (what the app reads) ----------
  function empty() { return { applications: [], decisions: {}, requests: [], signups: [], repayments: {} }; }
  function read() {
    var s = null;
    try { s = JSON.parse(w.localStorage.getItem(KEY)); } catch (e) {}
    if (!isObj(s)) return empty();
    return {
      applications: isArr(s.applications) ? s.applications : [],
      decisions: isObj(s.decisions) ? s.decisions : {},
      requests: isArr(s.requests) ? s.requests : [],
      signups: isArr(s.signups) ? s.signups : [],
      repayments: isObj(s.repayments) ? s.repayments : {}
    };
  }
  function write(next, silent) {
    try { w.localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
    if (!silent && chan) { try { chan.postMessage({ t: 'sync' }); } catch (e) {} }
    notify(next);
    safe(schedule);
  }
  function notify(s) { subs.slice().forEach(function (fn) { try { fn(s); } catch (e) { info('subscriber error', e && e.message); } }); }
  function emit() { notify(read()); safe(schedule); }

  var chan = null;
  try { chan = new w.BroadcastChannel(CHANNEL); } catch (e) { chan = null; }
  if (chan) chan.onmessage = function () { safe(emit); };
  try {
    w.addEventListener('storage', function (e) { if (e && e.key === KEY) safe(emit); });
    w.addEventListener('online', function () { safe(tick); safe(schedule); });
  } catch (e) {}

  // ---------- outbox (POSTs not yet accepted by the server) ----------
  function readOutbox() {
    try {
      var o = JSON.parse(w.localStorage.getItem(OUTBOX_KEY));
      if (isObj(o) && isArr(o.queue)) return { queue: o.queue, dead: isObj(o.dead) ? o.dead : {} };
    } catch (e) {}
    return { queue: [], dead: {} };
  }
  function writeOutbox(o) { try { w.localStorage.setItem(OUTBOX_KEY, JSON.stringify(o)); } catch (e) {} }
  function enqueue(kind, rec) {
    var o = readOutbox();
    o.queue = o.queue.filter(function (q) { return q.id !== rec.id; }).concat([{ kind: kind, id: rec.id, body: rec, tries: 0, nextAt: 0 }]);
    delete o.dead[rec.id];
    writeOutbox(o);
  }
  function dequeue(id, dead) {
    var o = readOutbox();
    o.queue = o.queue.filter(function (q) { return q.id !== id; });
    if (dead) o.dead[id] = true; // the server said no (4xx): keep the local record, stop retrying
    writeOutbox(o);
  }
  function bump(id) {
    var o = readOutbox();
    o.queue.forEach(function (q) {
      if (q.id !== id) return;
      q.tries = (q.tries || 0) + 1;
      q.nextAt = Date.now() + Math.min(POLL_MS * Math.pow(2, q.tries), MAX_BACKOFF_MS);
    });
    writeOutbox(o);
  }

  // ---------- network (never rejects) ----------
  function parseBody(res) {
    try {
      if (res && typeof res.json === 'function') return Promise.resolve(res.json()).then(null, function () { return null; });
      if (res && typeof res.text === 'function') return Promise.resolve(res.text()).then(function (t) { try { return JSON.parse(t); } catch (e) { return null; } }, function () { return null; });
    } catch (e) {}
    return Promise.resolve(null);
  }
  function request(method, path, body) {
    var init = { method: method, headers: { Accept: 'application/json' }, cache: 'no-store' };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    var ctrl = null, t = null;
    try {
      if (w.AbortController) {
        ctrl = new w.AbortController(); init.signal = ctrl.signal;
        t = w.setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, FETCH_TIMEOUT_MS);
      }
    } catch (e) { t = null; }
    var p;
    try { p = Promise.resolve(w.fetch(apiBase() + '/' + path, init)); } catch (e) { p = Promise.reject(e); }
    return p.then(function (res) {
      return parseBody(res).then(function (b) { return { ok: !!(res && res.ok), status: (res && res.status) | 0, body: b }; });
    }, function () { return { ok: false, status: 0, body: null }; })
      .then(function (r) { if (t != null) { try { w.clearTimeout(t); } catch (e) {} } return r; });
  }

  // ---------- applying what the server says ----------
  function applyServer(kind, id, body) {
    if (!isObj(body)) return;
    var s = read(), changed = false;
    function patchList(list, fields) {
      return list.map(function (r) {
        if (!r || r.id !== id) return r;
        var n = Object.assign({}, r);
        if (typeof body.id === 'string' && body.id && body.id !== id) n.serverId = body.id; // poll by the server's id
        fields(n, r);
        if (!same(n, r)) changed = true;
        return n;
      });
    }
    if (kind === 'applications') {
      s.applications = patchList(s.applications, function (n) {
        if (typeof body.status === 'string' && body.status) n.status = body.status;
      });
      var d = body.decision;
      if (isObj(d) && d.verdict) {
        var prev = s.decisions[id];
        var nd = { verdict: String(d.verdict), amount: num(d.amount), by: d.by || 'Ecoloans', note: d.note || '', at: ms(d.at, prev && prev.at) };
        if (!same(nd, prev)) { s.decisions[id] = nd; changed = true; }
      }
    } else if (kind === 'signups') {
      s.signups = patchList(s.signups, function (n, r) {
        if (typeof body.status === 'string' && body.status) n.status = body.status;
        if (body.decidedAt != null) n.decidedAt = ms(body.decidedAt, r.decidedAt);
        if (body.by) n.by = body.by;
        if (body.note) n.note = String(body.note); // an empty note is not news; avoid waking subscribers
      });
    } else if (kind === 'requests') {
      s.requests = patchList(s.requests, function (n) {
        if (typeof body.status === 'string' && body.status) n.status = body.status;
      });
    }
    if (changed) write(s);
  }
  function applyRepayment(body) {
    if (!isObj(body) || typeof body.ok !== 'boolean') return; // null = nothing confirmed yet; keep local
    var s = read();
    var prev = s.repayments.app;
    var next = { ok: body.ok, by: body.by || 'Admin', at: ms(body.at, prev && prev.at) };
    if (same(next, prev)) return;
    s.repayments.app = next;
    write(s);
  }

  // ---------- what still needs the network ----------
  function finalApp(a, s) {
    return !!s.decisions[a.id] || a.status === 'Approved' || a.status === 'Declined';
  }
  function pollTargets() {
    var s = read(), o = readOutbox(), now = Date.now(), out = [], queued = {};
    o.queue.forEach(function (q) { queued[q.id] = true; });
    s.applications.forEach(function (a) {
      if (!a || typeof a.id !== 'string' || o.dead[a.id] || queued[a.id] || finalApp(a, s)) return;
      if (now - num(a.submittedAt) > MAX_POLL_AGE_MS) return;
      out.push({ kind: 'applications', id: a.id, remote: a.serverId || a.id, rec: a });
    });
    s.signups.forEach(function (a) {
      if (!a || typeof a.id !== 'string' || o.dead[a.id] || queued[a.id] || a.status !== 'Pending review') return;
      if (now - num(a.submittedAt) > MAX_POLL_AGE_MS) return;
      out.push({ kind: 'signups', id: a.id, remote: a.serverId || a.id, rec: a });
    });
    return out;
  }
  function hasWork() { return readOutbox().queue.length > 0 || pollTargets().length > 0; }

  function flush() {
    var now = Date.now();
    readOutbox().queue.forEach(function (q) {
      var key = 'post:' + q.id;
      if (inflight[key] || num(q.nextAt) > now) return;
      inflight[key] = true;
      request('POST', q.kind, q.body).then(function (r) {
        delete inflight[key];
        if (r.ok || r.status === 409) { dequeue(q.id); applyServer(q.kind, q.id, r.body); }
        else if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) { dequeue(q.id, true); info(q.kind, 'rejected', r.status); }
        else { bump(q.id); }
        safe(schedule);
      });
    });
  }
  function poll() {
    pollTargets().forEach(function (t) {
      var key = 'get:' + t.id;
      if (inflight[key]) return;
      inflight[key] = true;
      request('GET', t.kind + '/' + encodeURIComponent(t.remote)).then(function (r) {
        delete inflight[key];
        if (r.ok) applyServer(t.kind, t.id, r.body);
        else if (r.status === 404 && !t.rec.serverId) { enqueue(t.kind, t.rec); flush(); } // server never got it: send again
        safe(schedule);
      });
    });
  }
  // The repayment flag is scoped to this customer's latest application (`app:<id>`): the local
  // original's bare `app` key was implicitly per-device, but on a shared backend it would be one
  // global flag every customer sees. Staff confirm against the scoped key.
  function repaymentKey() {
    var a = read().applications[0];
    return a && typeof a.id === 'string' && a.id ? 'app:' + (a.serverId || a.id) : null;
  }
  function pollRepayments() {
    var key = 'get:repayments', rk = repaymentKey();
    if (!rk || inflight[key]) return;
    inflight[key] = true;
    request('GET', 'repayments/' + encodeURIComponent(rk)).then(function (r) {
      delete inflight[key];
      if (r.ok) applyRepayment(r.body);
    });
  }
  function tick() { flush(); poll(); pollRepayments(); }

  // One interval, alive only while a subscriber exists and something is still pending.
  function schedule() {
    var want = subs.length > 0 && hasWork();
    if (want && timer == null) timer = w.setInterval(function () { safe(tick); }, POLL_MS);
    else if (!want && timer != null) { w.clearInterval(timer); timer = null; }
  }

  // ---------- public API (identical to the local version) ----------
  var Link = {
    getState: read,
    subscribe: function (fn) {
      subs.push(fn);
      try { fn(read()); } catch (e) { info('subscriber error', e && e.message); }
      safe(tick); safe(schedule); // poll once on subscribe, then only while there is work
      return function () { subs = subs.filter(function (f) { return f !== fn; }); safe(schedule); };
    },

    // customer app → LEDGER
    submitApplication: function (app) {
      app = isObj(app) ? app : {};
      var id = typeof app.id === 'string' && app.id ? app.id : 'ap_' + hex12();
      var rec = Object.assign({ id: id, submittedAt: Date.now(), status: 'Needs decision', source: 'app' }, app, { id: id });
      safe(function () {
        var s = read();
        s.applications = [rec].concat(s.applications.filter(function (a) { return !a || a.id !== id; }));
        enqueue('applications', rec);
        write(s);
        flush();
      });
      return id;
    },
    submitRequest: function (req) {
      req = isObj(req) ? req : {};
      var id = typeof req.id === 'string' && req.id ? req.id : 'rq_' + hex12();
      var rec = Object.assign({ id: id, at: Date.now(), status: 'New' }, req, { id: id });
      safe(function () {
        var s = read();
        s.requests = [rec].concat(s.requests.filter(function (a) { return !a || a.id !== id; }));
        enqueue('requests', rec);
        write(s);
        flush();
      });
      return id;
    },
    submitSignup: function (sign) {
      sign = isObj(sign) ? sign : {};
      var id = typeof sign.id === 'string' && sign.id ? sign.id : 'su_' + hex12();
      var rec = Object.assign({ id: id, submittedAt: Date.now(), status: 'Pending review', reviewer: 'applications@ecoloans.co.za' }, sign, { id: id });
      safe(function () {
        var s = read();
        s.signups = [rec].concat(s.signups.filter(function (a) { return !a || a.id !== id; }));
        enqueue('signups', rec);
        write(s);
        flush();
      });
      return id;
    },

    // admin-side helpers: the customer app never calls these; they keep working on the local cache
    decideSignup: function (id, verdict, by, note) {
      safe(function () {
        var s = read();
        s.signups = s.signups.map(function (a) {
          return a && a.id === id ? Object.assign({}, a, { status: verdict === 'approved' ? 'Approved' : 'Declined', decidedAt: Date.now(), by: by || 'applications@ecoloans.co.za', note: note || '' }) : a;
        });
        write(s);
      });
    },
    decide: function (id, verdict, amount, by, note) {
      safe(function () {
        var s = read();
        s.decisions[id] = { verdict: verdict, amount: amount || 0, by: by || 'Admin', note: note || '', at: Date.now() };
        s.applications = s.applications.map(function (a) {
          return a && a.id === id ? Object.assign({}, a, { status: verdict === 'approved' ? 'Approved' : verdict === 'escalated' ? 'Escalated' : verdict === 'info' ? 'Docs pending' : 'Declined' }) : a;
        });
        write(s);
      });
    },
    confirmRepayment: function (key, by, ok) {
      safe(function () {
        var s = read();
        s.repayments[key || 'app'] = { ok: ok !== false, by: by || 'Admin', at: Date.now() };
        write(s);
      });
    },
    repaymentFor: function (key) { var r = read().repayments[key || 'app']; return r || null; },
    decisionFor: function (id) { return read().decisions[id] || null; },
    reset: function () { writeOutbox({ queue: [], dead: {} }); write(empty()); }
  };

  w.Quik1Link = Link;
})(window);
