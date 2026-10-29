/* ledger-sync.js — boot pre-fetch + localStorage mirror for the LEDGER console.
 *
 * Classic script, loaded first in <head> (replaces the original runtime <script>).
 * It never touches the app source. It only:
 *   1. seeds localStorage['ledjaa.supabase'] / ['q1.apps'] (empty fields only),
 *   2. pre-fetches GET /api/ledger/state and seeds the keys the console reads
 *      synchronously in its constructor (logbook, petty, bank, expenses, org…),
 *   3. then injects the dc runtime so the app boots on top of cloud data,
 *   4. mirrors later localStorage writes back to POST /api/ledger/sync.
 *
 * Contract used by ledjaa-db.js (written by another module):
 *   window.__ledger = { cfg(), save(patch), api(method, path, body), state: Promise, error }
 *
 * See docs/BRIDGE-SPEC.md → "ledger/ledger-sync.js".
 */
(function (W) {
  'use strict';

  var RUNTIME_SRC = 'c53b361c-bb83-4c37-90f5-7116b8407f79.js';
  var KEYS = {
    cfg: 'ledjaa.supabase', console: 'evoltConsoleV4', org: 'evoltOrg', bank: 'ledjaa.bank',
    bankTx: 'ledjaa.bank.tx', expenses: 'ledjaa.expenses', refHigh: 'ledjaa.clientRefHigh',
    q1: 'q1.apps', queue: 'ledjaa.sync.queue'
  };
  var STATE_TIMEOUT_MS = 8000;   // never block the app longer than this
  var DEBOUNCE_MS = 1500;        // the console persists in bursts; coalesce them
  var MAX_QUEUE = 2000;          // offline safety cap for the persisted op queue
  var MAX_BATCH = 200;           // ops per POST /sync
  var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var store = null;
  try { store = W.localStorage; } catch (e) { store = null; }
  // Originals are captured once so our own seeding writes bypass the mirror.
  var SP = (W.Storage && W.Storage.prototype) || (store && Object.getPrototypeOf(store)) || {};
  var rawSet = SP.setItem, rawGet = SP.getItem;

  function info() { try { if (W.console && W.console.info) W.console.info.apply(W.console, ['[ledger-sync]'].concat([].slice.call(arguments))); } catch (e) {} }
  function readRaw(key) { try { return store ? rawGet.call(store, key) : null; } catch (e) { return null; } }
  function writeRaw(key, val) { try { if (store) rawSet.call(store, key, val); } catch (e) {} }
  function readJSON(key, fallback) { try { var v = readRaw(key); if (v == null) return fallback; var j = JSON.parse(v); return j == null ? fallback : j; } catch (e) { return fallback; } }
  function writeJSON(key, val) { writeRaw(key, JSON.stringify(val)); }
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[\sR,]/g, '')); return isFinite(n) ? n : 0; }
  function str(v, d) { return v == null || v === '' ? (d == null ? '' : d) : String(v); }
  function origin() { try { return (W.location && W.location.origin) || ''; } catch (e) { return ''; } }
  function stableJSON(o) { if (o == null || typeof o !== 'object') return JSON.stringify(o); if (Array.isArray(o)) return '[' + o.map(stableJSON).join(',') + ']'; return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + stableJSON(o[k]); }).join(',') + '}'; }

  // FNV-1a, two seeds → 16 hex chars. Only used to give id-less console records a stable identity.
  function fnv(s, seed) { var h = seed >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
  function hash(s) { return fnv(s, 2166136261) + fnv(s, 1114111); }

  // ---- dates: console labels ("29 OCT 2026" / "29 Oct 2026") <-> ISO / ms --------------------
  function parseLabel(s) { var m = String(s || '').trim().match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/); if (!m) return null; var mi = MN.map(function (x) { return x.toLowerCase(); }).indexOf(m[2].toLowerCase()); if (mi < 0) return null; return new Date(+m[3], mi, +m[1]); }
  function labelOf(d) { d = d instanceof Date ? d : new Date(d); if (isNaN(d)) return ''; return d.getDate() + ' ' + MN[d.getMonth()] + ' ' + d.getFullYear(); }
  function isoDate(d) { d = d instanceof Date ? d : new Date(d); if (isNaN(d)) return ''; return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function ms(v) { if (v == null || v === '') return null; if (typeof v === 'number') return v; var t = Date.parse(v); return isNaN(t) ? null : t; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  // A label is all the console gives us for "when"; today's label means "now", an older one noon that day.
  function atFromLabel(label, now) { var d = parseLabel(label); if (!d) return now; var n = new Date(now); if (sameDay(d, n)) return now; d.setHours(12, 0, 0, 0); return d.getTime(); }

  // ---- logbook <-> audit_log ------------------------------------------------------------------
  function logKey(e) { return [e.type, e.ref, e.customer, num(e.amount), e.date, e.by, e.comment].map(function (v) { return str(v); }).join('\u0001'); }
  // Gives every entry a stable id/at. Oldest-first occurrence counting keeps ids stable across
  // re-persists because logAdd only ever prepends.
  function assignLogIds(list, now) {
    now = now || Date.now();
    var counts = {}, out = new Array(list.length), changed = false;
    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i] || {}, k = hash(logKey(e)); counts[k] = (counts[k] || 0) + 1;
      var id = e.id ? String(e.id) : 'al_' + k + (counts[k] > 1 ? '_' + counts[k] : '');
      var at = ms(e.at); if (at == null) at = atFromLabel(e.date, now);
      if (e.id !== id || e.at !== at) { changed = true; e = Object.assign({}, e, { id: id, at: at }); }
      out[i] = e;
    }
    return { list: out, changed: changed };
  }
  function auditToLog(row, names) {
    var at = ms(row.at) || Date.now(), by = str(row.by, '—');
    return { id: String(row.id), at: at, ref: str(row.ref, '—'), customer: str(row.customer, '—'), amount: num(row.amount), type: str(row.type, '—'), date: labelOf(at).toUpperCase(), by: (names && names[by]) || by, comment: str(row.comment) };
  }
  function logToAudit(e) {
    var at = ms(e.at); if (at == null) at = atFromLabel(e.date, Date.now());
    return { id: String(e.id), at: new Date(at).toISOString(), type: str(e.type, '—'), ref: str(e.ref, '—'), customer: str(e.customer, '—'), amount: num(e.amount), by: str(e.by, '—'), comment: str(e.comment) };
  }

  // ---- petty <-> petty_cash --------------------------------------------------------------------
  var CAT_TO_DB = { travel: 'travel', printing: 'office', stationery: 'office', other: 'other', office: 'office', airtime: 'airtime', meals: 'meals', advance: 'advance' };
  var CAT_FROM_DB = { travel: 'travel', office: 'stationery', airtime: 'other', meals: 'other', other: 'other' }; // advance → no cat (borrower advance)
  var ST_TO_DB = { PENDING: 'PENDING', APPROVED: 'APPROVED', PAID: 'REPAID', REPAID: 'REPAID', REJECTED: 'DECLINED', DECLINED: 'DECLINED' };
  function catToDb(c) { return c ? (CAT_TO_DB[String(c).toLowerCase()] || 'other') : 'advance'; }
  function statusToDb(s) { return ST_TO_DB[String(s || 'PENDING').toUpperCase()] || 'PENDING'; }
  function statusFromDb(s, hasCat) { s = String(s || 'PENDING').toUpperCase(); return s === 'REPAID' && hasCat ? 'PAID' : s; }
  function pettyToRow(p) {
    var date = p.iso || (parseLabel(p.date) ? isoDate(parseLabel(p.date)) : isoDate(new Date()));
    return { id: String(p.id), date: date, amount: num(p.amount), category: catToDb(p.cat), purpose: str(p.purpose, '—'), borrower: str(p.borrower), notes: str(p.notes), status: statusToDb(p.status), by: str(p.staffName || p.by, '—') };
  }
  function rowToPetty(row, local, idsByName) {
    var dbCat = CAT_FROM_DB[row.category], cat = (local && catToDb(local.cat) === row.category) ? local.cat : dbCat;
    var hasCat = !!cat, dbStatus = String(row.status || 'PENDING').toUpperCase();
    var status = (local && statusToDb(local.status) === dbStatus) ? local.status : statusFromDb(dbStatus, hasCat);
    var d = row.date ? new Date(String(row.date).slice(0, 10) + 'T12:00:00') : new Date();
    var by = str(row.by), base = { id: String(row.id), purpose: str(row.purpose), borrower: str(row.borrower, '—'), amount: num(row.amount), notes: str(row.notes), iso: isoDate(d), date: labelOf(d), status: status, by: by, staffName: by, staffId: (idsByName && idsByName[by]) || '' };
    var out = Object.assign({}, local || {}, base);
    if (local) { if (local.staffId) out.staffId = local.staffId; if (local.staffName) out.staffName = local.staffName; if (local.by != null) out.by = local.by; }
    if (cat) out.cat = cat; else delete out.cat;
    return out;
  }

  // ---- bank tx <-> bank_tx ---------------------------------------------------------------------
  function bankTxId(t) { return t.id ? String(t.id) : 'bt_' + hash([t.type, num(t.amount), t.ref, t.label, ms(t.at), t.by].map(function (v) { return str(v); }).join('\u0001')); }
  function bankTxToRow(t) { var at = ms(t.at) || Date.now(); return { id: bankTxId(t), at: new Date(at).toISOString(), type: t.type === 'in' ? 'in' : 'out', amount: num(t.amount), ref: str(t.ref, '—'), label: str(t.label), by: str(t.by, '—') }; }
  function rowToBankTx(row) { return { id: String(row.id), type: row.type === 'in' ? 'in' : 'out', amount: num(row.amount), ref: str(row.ref, '—'), label: str(row.label), at: ms(row.at) || Date.now(), by: str(row.by, '—') }; }

  // ---- expenses <-> expenses (DB keeps id/name/amount only; cat/day/paid live locally) ----------
  function expToRow(e) { return { id: String(e.id), name: str(e.name, '—'), amount: num(e.amount) }; }
  function rowToExp(row, local) { return Object.assign({ cat: 'Other', day: 1, paid: {} }, local || {}, { id: String(row.id), name: str(row.name), amount: num(row.amount) }); }

  // ---- settings <-> ledjaa.bank / evoltOrg ----------------------------------------------------
  function bankToSettings(b) { if (!b || b.balance == null) return null; return { bank_opening_balance: num(b.balance), bank_opening_at: new Date(ms(b.at) || Date.now()).toISOString() }; }
  var ORG_MAP = [['name', 'org_name'], ['legal', 'org_legal_name'], ['tagline', 'tagline'], ['address', 'address'], ['email', 'contact_email'], ['phone', 'contact_phone'], ['website', 'website']];
  function orgToSettings(o) { if (!o || !o.name) return null; var p = {}; ORG_MAP.forEach(function (m) { if (o[m[0]] != null && o[m[0]] !== '') p[m[1]] = String(o[m[0]]); }); return p; }
  function settingsToOrg(s, local) { if (!s || !s.org_name) return null; var o = Object.assign({}, local || {}); ORG_MAP.forEach(function (m) { if (s[m[1]] != null && s[m[1]] !== '') o[m[0]] = String(s[m[1]]); }); return o; }

  // ---- config + api ----------------------------------------------------------------------------
  function defaultCfg() { return { url: origin() + '/api/ledger', key: '', table: 'ledger_book', bookId: 'main', connected: false }; }
  function cfg() { return Object.assign(defaultCfg(), readJSON(KEYS.cfg, null) || {}); }
  function seedCfg() {
    var cur = readJSON(KEYS.cfg, null), def = defaultCfg(), next = Object.assign({}, cur || {});
    Object.keys(def).forEach(function (k) { if (next[k] == null || next[k] === '') next[k] = def[k]; });
    if (!cur || stableJSON(cur) !== stableJSON(next)) writeJSON(KEYS.cfg, next);
    return next;
  }
  function save(patch) { var next = Object.assign(cfg(), patch || {}); writeJSON(KEYS.cfg, next); if (next.key) scheduleFlush(0); return next; }
  function api(method, path, body, opts) {
    var c = cfg(), base = String(c.url || '').replace(/\/+$/, ''), p = String(path || ''), url = base + (p.charAt(0) === '/' ? p : '/' + p);
    var headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
    if (c.key) { headers['Authorization'] = 'Bearer ' + c.key; headers['apikey'] = c.key; }
    var init = { method: method || 'GET', headers: headers };
    if (body !== undefined && body !== null) init.body = JSON.stringify(body);
    var ctl = null, t = null, timeout = (opts && opts.timeoutMs) || 20000;
    if (typeof W.AbortController === 'function') { ctl = new W.AbortController(); init.signal = ctl.signal; t = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, timeout); }
    return Promise.resolve().then(function () { return W.fetch(url, init); }).then(function (r) {
      return Promise.resolve(r.status === 204 ? '' : r.text()).then(function (txt) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + String(txt).slice(0, 140));
        if (!txt) return null; try { return JSON.parse(txt); } catch (e) { throw new Error('Bad JSON from ' + p); }
      });
    }).finally(function () { if (t) clearTimeout(t); });
  }

  var L = { cfg: cfg, save: save, api: api, state: null, error: null, booted: null };

  function fetchState() {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (done) return; done = true; L.error = 'state fetch timed out after ' + STATE_TIMEOUT_MS + 'ms'; info(L.error); resolve(null); }, STATE_TIMEOUT_MS);
      api('GET', '/state', null, { timeoutMs: STATE_TIMEOUT_MS }).then(function (j) { if (done) return; done = true; clearTimeout(t); resolve(j && typeof j === 'object' ? j : null); },
        function (e) { if (done) return; done = true; clearTimeout(t); L.error = String((e && e.message) || e); info('state fetch failed — local only:', L.error); resolve(null); });
    });
  }

  // ---- op queue (persisted) --------------------------------------------------------------------
  var pending = [], flushTimer = null, flushing = false, backoff = DEBOUNCE_MS;
  function opKey(op) { var id = op.op === 'soft_delete' ? op.id : (op.rows && op.rows[0] && op.rows[0].id); return op.table + '|' + op.op + '|' + id; }
  function persistQueue() { writeJSON(KEYS.queue, pending); }
  function restoreQueue() { var q = readJSON(KEYS.queue, []); pending = Array.isArray(q) ? q.filter(function (o) { return o && o.table && o.op; }) : []; }
  function enqueue(op) {
    var k = opKey(op), i;
    // Same row already pending: an upsert merges its patch (bank + org both target settings/org),
    // anything else is simply replaced by the newer op.
    for (i = 0; i < pending.length; i++) if (opKey(pending[i]) === k) { pending[i] = op.op === 'upsert' ? Object.assign({}, op, { rows: [Object.assign({}, pending[i].rows && pending[i].rows[0], op.rows[0])] }) : op; break; }
    if (i === pending.length) pending.push(op);
    if (pending.length > MAX_QUEUE) pending.splice(0, pending.length - MAX_QUEUE);
    persistQueue(); scheduleFlush();
  }
  function scheduleFlush(delay) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(function () { flushTimer = null; flush(); }, delay == null ? DEBOUNCE_MS : delay);
    if (flushTimer && typeof flushTimer.unref === 'function') flushTimer.unref();
  }
  // A per-op error the server marks retryable (upstream down, 5xx, throttled) keeps the op; a
  // validation/conflict error drops it. Older servers without the flag: retry on the messages
  // that only ever mean "try later".
  function retryable(r) { return r.retryable === true || (r.retryable == null && /unreachable|Internal error/i.test(String(r.error || ''))); }
  function flush() {
    if (flushing || !pending.length) return Promise.resolve();
    if (!cfg().key) return Promise.resolve(); // keep the queue until the console is connected
    flushing = true;
    var batch = pending.slice(0, MAX_BATCH);
    return api('POST', '/sync', { ops: batch }).then(function (res) {
      var results = (res && res.results) || [], again = [];
      results.forEach(function (r, i) { if (r && r.error) { info('sync op rejected', batch[i].table, batch[i].op, r.error); if (retryable(r)) again.push(batch[i]); } });
      pending = again.concat(pending.slice(batch.length)); persistQueue(); flushing = false;
      if (again.length) { info('retrying', again.length, 'op(s) in', backoff, 'ms'); scheduleFlush(backoff); backoff = Math.min(backoff * 2, 60000); return; }
      backoff = DEBOUNCE_MS;
      if (pending.length) scheduleFlush(0); else info('synced', batch.length, 'op(s)');
    }, function (e) {
      flushing = false; info('sync failed, retrying in', backoff, 'ms —', String((e && e.message) || e));
      scheduleFlush(backoff); backoff = Math.min(backoff * 2, 60000);
    });
  }

  // ---- snapshot of what the DB already holds (drives the diff on each setItem) -----------------
  var known = { log: {}, bankTx: {}, petty: {}, expenses: {}, bank: null, org: null };
  function rememberLog(list) { list.forEach(function (e) { if (e && e.id) known.log[e.id] = 1; }); }
  function rememberBankTx(list) { list.forEach(function (t) { if (t && t.id) known.bankTx[t.id] = 1; }); }
  function rememberPetty(list) { list.forEach(function (p) { if (p && p.id) known.petty[p.id] = stableJSON(pettyToRow(p)); }); }
  function rememberExpenses(list) { known.expenses = {}; list.forEach(function (e) { if (e && e.id) known.expenses[e.id] = stableJSON(expToRow(e)); }); }

  function clientRefNum(ref) { var m = String(ref || '').match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : 0; }

  // The console's constructor only discards its built-in demo book when the saved state has
  // `clients` and `loans` ([] is truthy, so empty arrays are enough). The hosted console must
  // never show — let alone push — demo rows, so every boot path guarantees these keys exist.
  var BOOK_LISTS = ['clients', 'loans', 'logbook', 'petty', 'employees', 'applications'];
  function ensureBook(sv) {
    var out = Object.assign({}, sv && typeof sv === 'object' ? sv : {}), changed = !sv || typeof sv !== 'object';
    BOOK_LISTS.forEach(function (k) { if (!Array.isArray(out[k])) { out[k] = []; changed = true; } });
    return { book: out, changed: changed };
  }
  // Next loan/client sequence from the highest live ref ('ECL-112' → 113). The console formats
  // new refs as 'ECL-0' + seq, so 113 renders 'ECL-0113' — unique, which is what matters.
  function seedSeq(payload, key, rows) {
    var hi = 0; (rows || []).forEach(function (r) { hi = Math.max(hi, clientRefNum(r && r.ref)); });
    if (hi) payload[key] = Math.max(num(payload[key]), hi + 1);
  }

  // Fills only empty fields of the Quik1 entry (and seeds the console's default list when absent).
  function seedQ1Apps(key) {
    var cur = readJSON(KEYS.q1, null), list;
    if (Array.isArray(cur)) list = cur.map(function (a) { return Object.assign({}, a); });
    else {
      var P = [['Quik1 loan app', '/applications?status=new', 'Q1 checks this every minute and brings new loan applications into Applications. Allow actions to send approved / declined back to Quik1.'], ['NuPay (debit orders)', '/transactions?days=7', 'NuPay debit-order results. Most NuPay endpoints need a server proxy.'], ['Bank account', '/accounts/balance', 'Bank or Stitch / Ozow API for balance and statement lines. Usually needs a proxy.'], ['Supabase / own database', '/rest/v1/ledger_book?select=*', 'Supabase REST works from the browser. Use the anon key.'], ['Accounting (Xero, Sage)', '/Invoices?where=Status=="AUTHORISED"', 'Xero or Sage. OAuth tokens expire; use a proxy that refreshes them.'], ['WhatsApp / SMS', '/messages?limit=20', 'WhatsApp Cloud API or SMS gateway. Actions send messages.'], ['Google Sheets', '', 'Paste a published-to-web CSV link or an Apps Script web-app URL as the base URL.']];
      list = P.map(function (p, i) { return { id: 'q' + i, name: p[0], url: '', path: p[1], key: '', proxy: '', on: false, actions: false, hint: p[2], pathHint: p[1] || '(leave blank)' }; });
    }
    var q = null; for (var i = 0; i < list.length; i++) if (/quik1/i.test(list[i].name || '')) { q = list[i]; break; }
    if (!q) { q = { id: 'q_quik1', name: 'Quik1 loan app', url: '', path: '/applications?status=new', key: '', proxy: '', on: false, actions: false, hint: 'Q1 checks this every minute and brings new loan applications into Applications.', pathHint: '/applications?status=new' }; list.unshift(q); }
    var changed = !Array.isArray(cur);
    if (!q.url) { q.url = origin() + '/api/q1'; q.on = true; q.actions = true; changed = true; } // first configuration only — never flip a user's toggles
    // LEDGER_KEY unlocks the whole book, so it only ever accompanies our own /api/q1 — never a
    // third-party url the operator pointed this entry at.
    var ours = String(q.url || '').replace(/\/+$/, '') === origin() + '/api/q1';
    if (ours && !q.key && key) { q.key = key; changed = true; }
    if (!q.path) { q.path = '/applications?status=new'; changed = true; }
    if (changed) writeJSON(KEYS.q1, list);
    return list;
  }

  // Seeds localStorage from the cloud state. DB wins; local records the DB does not know yet are
  // kept and re-queued. Returns the ops queued.
  function applyState(st) {
    var now = Date.now(), ops = [];
    var sv = readJSON(KEYS.console, null); if (!sv || typeof sv !== 'object') sv = null;
    var localEmp = (sv && sv.employees) || [], names = {}, idsByName = {};
    ((st && st.employees) || []).concat(localEmp).forEach(function (e) { if (e && e.id && e.name) { names[e.id] = e.name; idsByName[e.name] = idsByName[e.name] || e.id; } });

    // logbook ← audit_log (merge by id)
    var dbLog = ((st && st.audit_log) || []).map(function (r) { return auditToLog(r, names); });
    var localLog = assignLogIds((sv && Array.isArray(sv.logbook)) ? sv.logbook : [], now).list;
    // A local entry counts as "in the DB" by id, or by content: a browser that logged entries before
    // the bridge existed holds the same rows under different ids, and must not re-insert them.
    var dbIds = {}, dbKeys = {}; dbLog.forEach(function (e) { dbIds[e.id] = 1; dbKeys[logKey(e)] = 1; });
    var extraLog = localLog.filter(function (e) { return !dbIds[e.id] && !dbKeys[logKey(e)]; });
    extraLog.forEach(function (e) { ops.push({ table: 'audit_log', op: 'insert', rows: [logToAudit(e)] }); });
    var logbook = dbLog.concat(extraLog).sort(function (a, b) { return (b.at || 0) - (a.at || 0); });

    // petty ← petty_cash
    var localPetty = (sv && Array.isArray(sv.petty)) ? sv.petty : [], lp = {}; localPetty.forEach(function (p) { if (p && p.id) lp[p.id] = p; });
    var dbPettyIds = {}, petty = ((st && st.petty_cash) || []).map(function (r) { dbPettyIds[r.id] = 1; return rowToPetty(r, lp[r.id], idsByName); });
    localPetty.forEach(function (p) { if (p && p.id && !dbPettyIds[p.id]) { petty.push(p); ops.push({ table: 'petty_cash', op: 'upsert', rows: [pettyToRow(p)] }); } });
    petty.sort(function (a, b) { return String(b.iso || '').localeCompare(String(a.iso || '')); });

    var payload = Object.assign(ensureBook(sv).book, { logbook: logbook, petty: petty });
    seedSeq(payload, 'loanSeq', st && st.loans);
    seedSeq(payload, 'clientSeq', st && st.clients);
    writeJSON(KEYS.console, payload);
    rememberLog(logbook); rememberPetty(petty);

    // bank tx ← bank_tx
    var localTx = (readJSON(KEYS.bankTx, []) || []).map(function (t) { return Object.assign({}, t, { id: bankTxId(t) }); });
    var dbTxIds = {}, tx = ((st && st.bank_tx) || []).map(function (r) { dbTxIds[r.id] = 1; return rowToBankTx(r); });
    localTx.forEach(function (t) { if (!dbTxIds[t.id]) { tx.push(t); ops.push({ table: 'bank_tx', op: 'insert', rows: [bankTxToRow(t)] }); } });
    tx.sort(function (a, b) { return (b.at || 0) - (a.at || 0); }); tx = tx.slice(0, 500);
    writeJSON(KEYS.bankTx, tx); rememberBankTx(tx);

    // expenses ← expenses (not deleted); local-only ones are re-queued
    var localExp = readJSON(KEYS.expenses, []) || [], le = {}; localExp.forEach(function (e) { if (e && e.id) le[e.id] = e; });
    var dbExpIds = {}, exp = [];
    ((st && st.expenses) || []).forEach(function (r) { dbExpIds[r.id] = 1; if (!r.deleted_at) exp.push(rowToExp(r, le[r.id])); });
    localExp.forEach(function (e) { if (e && e.id && !dbExpIds[e.id]) { exp.push(e); ops.push({ table: 'expenses', op: 'upsert', rows: [expToRow(e)] }); } });
    writeJSON(KEYS.expenses, exp); rememberExpenses(exp);

    // settings → ledjaa.bank / evoltOrg
    var s = st && st.settings, bank = readJSON(KEYS.bank, null);
    if (s && s.bank_opening_balance != null) {
      bank = Object.assign({ balance: null, at: null, by: null, history: [] }, bank || {}, { balance: num(s.bank_opening_balance), at: ms(s.bank_opening_at) || (bank && bank.at) || now });
      if (!bank.by) bank.by = str(s.updated_by, '—');
      writeJSON(KEYS.bank, bank);
    }
    known.bank = stableJSON(bankToSettings(bank));
    var org = readJSON(KEYS.org, null), dbOrg = settingsToOrg(s, org);
    if (dbOrg) {
      if (!dbOrg.admin) { var adm = ((st && st.employees) || []).filter(function (e) { return e && e.role === 'admin' && e.name; })[0]; if (adm) dbOrg.admin = adm.name; }
      if (stableJSON(dbOrg) !== stableJSON(org)) writeJSON(KEYS.org, dbOrg);
      org = dbOrg;
    }
    known.org = stableJSON(orgToSettings(org));

    // ledjaa.clientRefHigh ← max client ref number
    var hi = parseInt(readRaw(KEYS.refHigh) || '0', 10) || 0;
    ((st && st.clients) || []).forEach(function (c) { hi = Math.max(hi, clientRefNum(c && c.ref)); });
    if (hi) writeRaw(KEYS.refHigh, String(hi));

    ops.forEach(enqueue);
    return ops;
  }

  // Offline / no-key boot: just remember what is there so later writes diff correctly.
  function snapshotLocal() {
    var eb = ensureBook(readJSON(KEYS.console, null)), sv = eb.book;
    var a = assignLogIds(sv.logbook, Date.now());
    if (eb.changed || a.changed) writeJSON(KEYS.console, Object.assign({}, sv, { logbook: a.list }));
    rememberLog(a.list);
    rememberPetty(sv.petty);
    rememberBankTx((readJSON(KEYS.bankTx, []) || []).map(function (t) { return Object.assign({}, t, { id: bankTxId(t) }); }));
    rememberExpenses(readJSON(KEYS.expenses, []) || []);
    known.bank = stableJSON(bankToSettings(readJSON(KEYS.bank, null)));
    known.org = stableJSON(orgToSettings(readJSON(KEYS.org, null)));
  }

  // ---- mirror: diff console writes against the snapshot and queue ops ------------------------
  function onConsoleWrite(value) {
    var sv = JSON.parse(value); if (!sv || typeof sv !== 'object') return value;
    var out = value;
    if (Array.isArray(sv.logbook)) {
      var a = assignLogIds(sv.logbook, Date.now());
      a.list.forEach(function (e) { if (!known.log[e.id]) { known.log[e.id] = 1; enqueue({ table: 'audit_log', op: 'insert', rows: [logToAudit(e)] }); } });
      if (a.changed) { sv.logbook = a.list; out = JSON.stringify(sv); } // ids ride along so later boots keep them
    }
    if (Array.isArray(sv.petty)) sv.petty.forEach(function (p) { if (!p || !p.id) return; var row = pettyToRow(p), h = stableJSON(row); if (known.petty[p.id] !== h) { known.petty[p.id] = h; enqueue({ table: 'petty_cash', op: 'upsert', rows: [row] }); } });
    return out;
  }
  function onBankTxWrite(value) {
    var list = JSON.parse(value); if (!Array.isArray(list)) return value;
    var changed = false, out = list.map(function (t) { if (!t || typeof t !== 'object') return t; var id = bankTxId(t); if (t.id !== id) { changed = true; t = Object.assign({}, t, { id: id }); } if (!known.bankTx[id]) { known.bankTx[id] = 1; enqueue({ table: 'bank_tx', op: 'insert', rows: [bankTxToRow(t)] }); } return t; });
    return changed ? JSON.stringify(out) : value;
  }
  function onExpensesWrite(value) {
    var list = JSON.parse(value); if (!Array.isArray(list)) return value;
    var seen = {};
    list.forEach(function (e) { if (!e || !e.id) return; var row = expToRow(e), h = stableJSON(row); seen[e.id] = 1; if (known.expenses[e.id] !== h) enqueue({ table: 'expenses', op: 'upsert', rows: [row] }); });
    Object.keys(known.expenses).forEach(function (id) { if (!seen[id]) enqueue({ table: 'expenses', op: 'soft_delete', id: id }); });
    rememberExpenses(list);
    return value;
  }
  function onBankWrite(value) { var p = bankToSettings(JSON.parse(value)), h = stableJSON(p); if (p && h !== known.bank) { known.bank = h; enqueue({ table: 'settings', op: 'upsert', rows: [Object.assign({ id: 'org' }, p)] }); } return value; }
  function onOrgWrite(value) { var p = orgToSettings(JSON.parse(value)), h = stableJSON(p); if (p && h !== known.org) { known.org = h; enqueue({ table: 'settings', op: 'upsert', rows: [Object.assign({ id: 'org' }, p)] }); } return value; }
  var HANDLERS = {}; HANDLERS[KEYS.console] = onConsoleWrite; HANDLERS[KEYS.bankTx] = onBankTxWrite; HANDLERS[KEYS.expenses] = onExpensesWrite; HANDLERS[KEYS.bank] = onBankWrite; HANDLERS[KEYS.org] = onOrgWrite;

  var hooked = false;
  function hookStorage() {
    if (hooked || !store || typeof rawSet !== 'function') return; hooked = true;
    SP.setItem = function (key, value) {
      var v = value;
      if (this === store && HANDLERS[key]) { try { v = HANDLERS[key](String(value)); } catch (e) { v = value; } } // never break the app's own write
      return rawSet.call(this, key, v);
    };
  }

  // ---- runtime injection ----------------------------------------------------------------------
  function whenParsed(fn) { var d = W.document; if (!d || d.readyState !== 'loading') return fn(); d.addEventListener('DOMContentLoaded', function once() { d.removeEventListener('DOMContentLoaded', once); fn(); }); }
  function injectRuntime() {
    return new Promise(function (resolve) {
      whenParsed(function () {
        try { var d = W.document, s = d.createElement('script'); s.src = RUNTIME_SRC; (d.head || d.documentElement).appendChild(s); } catch (e) { info('runtime injection failed', e); }
        resolve();
      });
    });
  }

  // ---- boot ------------------------------------------------------------------------------------
  function boot() {
    var c = seedCfg();
    restoreQueue();
    if (c.key) { try { seedQ1Apps(c.key); } catch (e) { info('q1.apps seed failed', e); } }
    else L.error = 'no key configured — local only';
    L.state = c.key ? fetchState() : Promise.resolve(null);
    L.booted = L.state.then(function (st) {
      try { if (st) { var ops = applyState(st); info('seeded from cloud', (st.audit_log || []).length, 'audit rows;', ops.length, 'local op(s) re-queued'); } else snapshotLocal(); }
      catch (e) { L.error = 'seed failed: ' + String((e && e.message) || e); info(L.error); try { snapshotLocal(); } catch (e2) {} }
      hookStorage();
      return injectRuntime();
    }).then(function () { if (pending.length) scheduleFlush(0); });
    try { W.addEventListener && W.addEventListener('online', function () { if (pending.length) scheduleFlush(0); }); } catch (e) {}
  }

  // Internals exposed for unit tests only.
  L._ = { KEYS: KEYS, ensureBook: ensureBook, assignLogIds: assignLogIds, auditToLog: auditToLog, logToAudit: logToAudit, pettyToRow: pettyToRow, rowToPetty: rowToPetty, bankTxToRow: bankTxToRow, rowToBankTx: rowToBankTx, expToRow: expToRow, rowToExp: rowToExp, bankToSettings: bankToSettings, orgToSettings: orgToSettings, settingsToOrg: settingsToOrg, seedQ1Apps: seedQ1Apps, applyState: applyState, parseLabel: parseLabel, labelOf: labelOf, flush: flush, queue: function () { return pending.slice(); }, known: known };
  W.__ledger = L;
  boot();
})(typeof window !== 'undefined' ? window : this);
