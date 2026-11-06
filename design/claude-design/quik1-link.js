/* Quik1 link — shared state between the customer app and the admin console.
   Same-origin: localStorage for persistence, BroadcastChannel for live push. */
(function (w) {
  var KEY = 'quik1-link-v1';
  var chan = null;
  try { chan = new BroadcastChannel('quik1-link'); } catch (e) {}
  var subs = [];

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { applications: [], decisions: {}, requests: [], signups: [] }; }
    catch (e) { return { applications: [], decisions: {}, requests: [], signups: [] }; }
  }
  function write(next, silent) {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
    if (!silent && chan) chan.postMessage({ t: 'sync' });
    subs.forEach(function (fn) { fn(next); });
  }
  function emit() { var s = read(); subs.forEach(function (fn) { fn(s); }); }

  if (chan) chan.onmessage = emit;
  w.addEventListener('storage', function (e) { if (e.key === KEY) emit(); });

  var Link = {
    getState: read,
    subscribe: function (fn) { subs.push(fn); fn(read()); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },

    // customer app → admin
    submitApplication: function (app) {
      var s = read();
      var id = app.id || 'AP-' + (1085 + s.applications.length);
      var rec = Object.assign({
        id: id, submittedAt: Date.now(), status: 'Needs decision', source: 'app'
      }, app, { id: id });
      s.applications = [rec].concat(s.applications.filter(function (a) { return a.id !== id; }));
      write(s);
      return id;
    },
    submitRequest: function (req) {
      var s = read();
      var id = req.id || 'RQ-' + (813 + s.requests.length);
      s.requests = [Object.assign({ id: id, at: Date.now(), status: 'New' }, req, { id: id })].concat(s.requests);
      write(s);
      return id;
    },

    submitSignup: function (rec) {
      var s = read(); s.signups = s.signups || [];
      var id = rec.id || 'SU-' + (2041 + s.signups.length);
      s.signups = [Object.assign({ id: id, submittedAt: Date.now(), status: 'Pending review', reviewer: 'applications@ecoloans.co.za' }, rec, { id: id })]
        .concat(s.signups.filter(function (a) { return a.id !== id; }));
      write(s);
      return id;
    },
    decideSignup: function (id, verdict, by, note) {
      var s = read(); s.signups = s.signups || [];
      s.signups = s.signups.map(function (a) {
        return a.id === id ? Object.assign({}, a, { status: verdict === 'approved' ? 'Approved' : 'Declined', decidedAt: Date.now(), by: by || 'applications@ecoloans.co.za', note: note || '' }) : a;
      });
      write(s);
    },

    // admin → customer app
    decide: function (id, verdict, amount, by, note) {
      var s = read();
      s.decisions[id] = { verdict: verdict, amount: amount || 0, by: by || 'Admin', note: note || '', at: Date.now() };
      s.applications = s.applications.map(function (a) {
        return a.id === id ? Object.assign({}, a, { status: verdict === 'approved' ? 'Approved' : verdict === 'escalated' ? 'Escalated' : verdict === 'info' ? 'Docs pending' : 'Declined' }) : a;
      });
      write(s);
    },
    confirmRepayment: function (key, by, ok) {
      var s = read(); s.repayments = s.repayments || {};
      s.repayments[key || 'app'] = { ok: ok !== false, by: by || 'Admin', at: Date.now() };
      write(s);
    },
    repaymentFor: function (key) { var r = (read().repayments || {})[key || 'app']; return r || null; },
    decisionFor: function (id) { return read().decisions[id] || null; },
    reset: function () { write({ applications: [], decisions: {}, requests: [], signups: [] }); }
  };

  w.Quik1Link = Link;
})(window);
