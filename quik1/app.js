/* Quik1 borrower app. Screens follow the Claude Design v2 shell.
   Figures come from the signed-in Ledger book. A withdrawal is an inbox
   request. Nothing on this page moves money. */
(function () {
  var state = {
    screen: 'pin',
    pin: '',
    pinPhase: 'sign',
    pinFirst: '',
    pinNote: '',
    pinBusy: false,
    inviteCode: '',
    deviceRef: '',
    accountRef: '',
    identified: false,
    book: null,
    previewClientId: '',
    amount: '',
    purpose: '',
    hide: false,
    messages: [],
    applications: [],
    statements: [],
    aiChat: [],
    aiTyping: false,
    aiDraft: '',
    msgDraft: '',
    toast: ''
  };

  function $(id) { return document.getElementById(id); }
  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }
  function money(n) {
    if (state.hide) return 'R ••••';
    var x = num(n);
    return 'R' + x.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtIso(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return '';
    var p = String(iso).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function account() {
    var acct = state.book && state.book.account;
    return acct || { credit_limit: 0, outstanding_principal: 0, available: 0, next_due: null, next_debit: 0, loans: [] };
  }
  function profile() {
    var p = state.book && state.book.profile;
    return p || { name: '', bank: '', ref: '' };
  }
  function loans() { return Array.isArray(account().loans) ? account().loans : []; }
  function api(path) {
    var base = (typeof window !== 'undefined' && window.QUIK1_API) || (((location && location.origin) || '') + '/api/quik1');
    return String(base).replace(/\/+$/, '') + path;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function add(parent, tag, text, className) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function show(screen) {
    if (screen !== 'pin' && !state.identified) screen = 'pin';
    state.screen = screen;
    document.querySelectorAll('.screen').forEach(function (el) {
      el.classList.toggle('active', el.id === screen);
    });
    var dock = $('dock');
    if (dock) dock.hidden = screen === 'pin' || !state.identified;
    document.querySelectorAll('[data-tab]').forEach(function (el) {
      el.classList.toggle('on', el.getAttribute('data-tab') === screen);
    });
    paint();
  }

  function toast(text) {
    state.toast = text || '';
    var el = $('toast');
    if (!el) return;
    el.hidden = !state.toast;
    el.textContent = state.toast;
  }

  function applyBook(payload) {
    var identified = !!(payload && payload.identified === true);
    state.identified = identified;
    state.book = identified ? payload : null;
    state.messages = identified && Array.isArray(payload.messages) ? payload.messages : [];
    state.applications = identified && Array.isArray(payload.applications) ? payload.applications : [];
    state.statements = identified && Array.isArray(payload.statements) ? payload.statements : [];
    if (identified && state.screen === 'pin') state.screen = 'home';
    if (!identified && state.screen !== 'pin') state.screen = 'pin';
    show(state.screen);
  }

  function previewHeaders() {
    var headers = { accept: 'application/json' };
    try {
      var raw = localStorage.getItem('ledjaa.supabase');
      var cfg = raw ? JSON.parse(raw) : null;
      if (cfg && typeof cfg.key === 'string' && cfg.key) headers.authorization = 'Bearer ' + cfg.key;
    } catch (e) {}
    return headers;
  }

  function refreshBook() {
    if (state.previewClientId) {
      return fetch(api('/preview/' + encodeURIComponent(state.previewClientId)), { credentials: 'same-origin', headers: previewHeaders() })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.identified === true) applyBook(j); })
        .catch(function () {});
    }
    return fetch(api('/me'), { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.identified === true) applyBook(j); })
      .catch(function () {});
  }

  function startPoll() {
    clearInterval(state._poll);
    state._poll = setInterval(function () { if (state.identified) refreshBook(); }, 8000);
  }

  function preparePreview() {
    fetch(api('/preview'), { credentials: 'same-origin', headers: previewHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || j.enabled !== true || !Array.isArray(j.clients) || !j.clients.length) return;
        var bar = $('q1-view-as');
        var pick = $('q1-view-as-pick');
        var go = $('q1-view-as-go');
        if (!bar || !pick || !go) return;
        pick.textContent = '';
        j.clients.forEach(function (c) {
          var opt = document.createElement('option');
          opt.value = String(c.id || '');
          opt.textContent = (c.ref ? c.ref + ' · ' : '') + (c.name || 'Client');
          pick.appendChild(opt);
        });
        bar.hidden = false;
        go.onclick = function () { if (pick.value) loadPreview(pick.value); };
      })
      .catch(function () {});
  }

  function loadPreview(clientId) {
    fetch(api('/preview/' + encodeURIComponent(clientId)), { credentials: 'same-origin', headers: previewHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || j.identified !== true) return;
        state.previewClientId = clientId;
        applyBook(j);
        startPoll();
        toast('Preview only. Nothing on this phone is sent to Ledger.');
      })
      .catch(function () {});
  }

  function paintPin() {
    var heading = state.pinPhase === 'choose' ? 'Choose a PIN' : state.pinPhase === 'confirm' ? 'Confirm your PIN' : 'Enter your PIN';
    var sub = state.pinPhase === 'sign'
      ? 'Enter the 4-digit PIN you chose. It is not your ID number.'
      : 'Choose 4 digits. This is not your ID number.';
    var h = $('pin-heading');
    var s = $('pin-sub');
    if (h) h.textContent = heading;
    if (s) s.textContent = sub;
    var note = $('pin-note');
    if (note) note.textContent = state.pinNote || '';
    var cells = $('pin-cells');
    if (cells) {
      clear(cells);
      for (var i = 0; i < 4; i++) add(cells, 'div', state.pin.length > i ? '•' : '', 'pin-cell');
    }
    var wrap = $('account-ref-wrap');
    if (wrap) wrap.hidden = !!(state.inviteCode || state.deviceRef);
  }

  function paintHome() {
    var acct = account();
    var person = profile();
    var due = fmtIso(acct.next_due);
    var first = (person.name || 'there').split(' ')[0];
    setText('home-hello', state.identified ? ('Hello, ' + first) : '');
    setText('dash-balance', state.identified ? money(acct.available) : '—');
    setText('dash-next', due ? ('Next due ' + due) : 'Not scheduled');
    setText('tile-available', money(acct.available) + ' available');
    setText('tile-open', money(acct.outstanding_principal) + ' principal still open');
    setText('tile-limit', 'Limit on the ledger ' + money(acct.credit_limit));
    var bank = person.bank ? ('Bank on the ledger: ' + person.bank) : 'Bank details stay on the ledger.';
    setText('tile-bank', bank);
    var box = $('home-activity');
    if (!box) return;
    clear(box);
    var lines = [];
    (state.statements || []).forEach(function (st) {
      (st.lines || []).forEach(function (line) {
        lines.push({ ref: st.ref, label: line.label, date: line.date, amount: line.amount, kind: line.kind });
      });
    });
    if (!lines.length) { add(box, 'p', 'No activity on the ledger yet.', 'empty-copy'); return; }
    lines.slice(-6).reverse().forEach(function (line) {
      var row = add(box, 'div', null, 'txn-item');
      var info = add(row, 'div', null, 'txn-info');
      add(info, 'div', line.label || 'Ledger', 'txn-name');
      add(info, 'div', (line.ref ? line.ref + ' · ' : '') + (fmtIso(line.date) || ''), 'txn-date');
      add(row, 'div', line.kind === 'due' ? money(line.amount) : money(line.amount), 'txn-amt');
    });
  }

  function paintBorrow() {
    var acct = account();
    setText('borrow-available', money(acct.available));
    setText('borrow-num', state.amount || '0');
    var field = $('borrow-purpose');
    if (field && field.value !== state.purpose) field.value = state.purpose;
    setText('borrow-cap', 'Up to ' + money(acct.available) + '. The request waits in Ledger. No money moves from this phone.');
  }

  function paintLoans() {
    var box = $('loan-list');
    if (!box) return;
    clear(box);
    var rows = loans();
    if (!rows.length) { add(box, 'p', 'No loan on the ledger.', 'empty-copy'); return; }
    rows.forEach(function (loan) {
      var card = add(box, 'div', null, 'contract-card');
      var head = add(card, 'div', null, 'contract-head');
      var title = add(head, 'div', null, '');
      add(title, 'div', loan.ref || 'Loan', 'contract-month');
      add(title, 'div', (loan.status === 'settled' ? 'Settled' : 'Open') + ' · ' + (loan.purpose || 'Ledger'), 'app-meta');
      add(head, 'div', loan.status === 'settled' ? 'SETTLED' : 'OPEN', 'pill-badge ' + (loan.status === 'settled' ? 'pill-green' : 'pill-yellow'));
      var body = add(card, 'div', null, 'contract-body');
      row(body, 'Principal', money(loan.principal));
      row(body, 'Still open', money(loan.outstanding_principal));
      row(body, 'Instalment on file', money(loan.instalment));
      row(body, 'Marked paid on the ledger', String(num(loan.instalments_paid)));
      var dates = Array.isArray(loan.schedule) ? loan.schedule : [];
      if (!dates.length) row(body, 'Schedule', 'No dates on the ledger');
      dates.forEach(function (iso, i) {
        var line = add(body, 'div', null, 'sched-line');
        add(line, 'span', 'Due ' + (i + 1) + ' of ' + dates.length);
        add(line, 'span', fmtIso(iso) || iso);
      });
    });
  }

  function row(parent, label, value) {
    var line = add(parent, 'div', null, 'app-row');
    add(line, 'span', label, 'l');
    add(line, 'span', value, 'r');
  }

  function paintStatements() {
    var box = $('statement-list');
    if (!box) return;
    clear(box);
    if (!state.statements.length) { add(box, 'p', 'No statement lines on the ledger.', 'empty-copy'); return; }
    state.statements.forEach(function (st) {
      var card = add(box, 'div', null, 'contract-card');
      var head = add(card, 'div', null, 'contract-head');
      add(head, 'div', st.ref || 'Loan', 'contract-month');
      add(head, 'div', st.status === 'settled' ? 'SETTLED' : 'OPEN', 'pill-badge ' + (st.status === 'settled' ? 'pill-green' : 'pill-yellow'));
      var body = add(card, 'div', null, 'contract-body');
      (st.lines || []).forEach(function (line) {
        row(body, (fmtIso(line.date) || 'Date') + ' · ' + (line.label || ''), money(line.amount));
      });
    });
  }

  function paintMessages() {
    var box = $('message-list');
    if (!box) return;
    clear(box);
    var rows = state.messages.length ? state.messages : [{ from: 'ecoloans', body: 'Send a message and the team will reply here. Nothing on this screen moves money.' }];
    rows.forEach(function (m) {
      var you = m.from === 'you';
      var wrap = add(box, 'div', null, 'msg-row');
      add(wrap, 'div', m.body || '', 'msg-bubble ' + (you ? 'msg-you' : 'msg-them'));
    });
    var q = $('q1-log');
    if (!q) return;
    clear(q);
    (state.aiChat || []).forEach(function (m) {
      var wrap = add(q, 'div', null, 'msg-row');
      add(wrap, 'div', m.text || '', 'msg-bubble ' + (m.from === 'me' ? 'msg-you' : 'msg-them'));
    });
    var label = q1Label(state);
    var status = $('q1-status');
    if (status) status.textContent = label.aiStatus;
  }

  function paintProfile() {
    var person = profile();
    setText('profile-name', person.name || 'Your name');
    setText('profile-ref', person.ref ? ('Reference ' + person.ref) : 'Reference is on the ledger');
    setText('profile-bank', person.bank || '—');
    setText('profile-limit', money(account().credit_limit));
    setText('profile-available', money(account().available));
    var open = loans().filter(function (l) { return l && l.status === 'open'; }).length;
    setText('profile-open', open ? String(open) : 'None');
  }

  function paintRepay() {
    var acct = account();
    var due = fmtIso(acct.next_due);
    setText('repay-amount', money(acct.outstanding_principal));
    setText('repay-due', due ? ('Next due ' + due) : 'Not scheduled');
    setText('repay-note', 'This sends a note to Ledger. It does not collect money.');
  }

  function paintRequest() {
    var box = $('request-list');
    if (!box) return;
    clear(box);
    if (!state.applications.length) { add(box, 'p', 'No request in the Ledger inbox yet.', 'empty-copy'); return; }
    state.applications.forEach(function (app) {
      var card = add(box, 'div', null, 'contract-card');
      var head = add(card, 'div', null, 'contract-head');
      add(head, 'div', app.ref || 'Request', 'contract-month');
      add(head, 'div', String(app.verdict || app.status || 'new').toUpperCase(), 'pill-badge pill-yellow');
      var body = add(card, 'div', null, 'contract-body');
      row(body, 'Amount', money(app.amount));
      row(body, 'Purpose', app.purpose || '—');
      row(body, 'Status', app.verdict || app.status || 'new');
      add(body, 'p', 'This is a status only. No money has moved.', 'empty-copy');
    });
  }

  function setText(id, text) { var el = $(id); if (el) el.textContent = text == null ? '' : String(text); }

  function paint() {
    paintPin();
    if (!state.identified) return;
    paintHome();
    paintBorrow();
    paintLoans();
    paintStatements();
    paintMessages();
    paintProfile();
    paintRepay();
    paintRequest();
    var banner = $('preview-banner');
    if (banner) banner.hidden = !state.previewClientId;
  }

  function saveDevice(ref) {
    if (!/^qb_[0-9a-f]{32}$/.test(ref || '')) return;
    state.deviceRef = ref;
    try { localStorage.setItem('quik1.device.v1', JSON.stringify({ accountRef: ref })); } catch (e) {}
  }

  function finishPin(path, body) {
    if (state.pinBusy) return;
    state.pinBusy = true;
    state.pinNote = '';
    paintPin();
    fetch(api(path), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); })
      .then(function (res) {
        state.pinBusy = false;
        state.pin = '';
        if (res.status === 423) { state.pinNote = 'This account is locked. Ask your loan officer for a new invite.'; state.pinPhase = 'sign'; paintPin(); return; }
        if (!res.ok) {
          state.pinNote = String((res.body && res.body.error) || 'PIN not accepted').slice(0, 160);
          state.pinFirst = '';
          state.pinPhase = state.inviteCode ? 'choose' : 'sign';
          paintPin();
          return;
        }
        saveDevice(res.body && res.body.accountRef);
        state.inviteCode = '';
        state.pinPhase = 'sign';
        state.pinFirst = '';
        try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
        refreshBook().then(startPoll);
      })
      .catch(function () { state.pinBusy = false; state.pinNote = 'Could not reach Quik1. Try again.'; paintPin(); });
  }

  function submitPin(pin) {
    if (state.pinBusy || !/^\d{4}$/.test(pin)) return;
    if (state.inviteCode) {
      if (state.pinPhase !== 'confirm') { state.pinFirst = pin; state.pinPhase = 'confirm'; state.pin = ''; state.pinNote = ''; paintPin(); return; }
      if (pin !== state.pinFirst) { state.pinFirst = ''; state.pinPhase = 'choose'; state.pin = ''; state.pinNote = 'Those did not match. Choose the PIN again.'; paintPin(); return; }
      finishPin('/invites/redeem', { code: state.inviteCode, pin: pin, pinConfirm: state.pinFirst });
      return;
    }
    var ref = state.deviceRef || String(state.accountRef || '').trim();
    if (!/^qb_[0-9a-f]{32}$/.test(ref)) {
      state.pin = '';
      state.pinNote = 'This phone is not linked yet. Open the invite from your loan officer, or enter the account reference.';
      paintPin();
      return;
    }
    finishPin('/login', { accountRef: ref, pin: pin });
  }

  function pushDigit(digit) {
    if (state.screen === 'pin') {
      if (digit === 'del') state.pin = state.pin.slice(0, -1);
      else if (state.pin.length < 4) state.pin += digit;
      paintPin();
      if (state.pin.length === 4) submitPin(state.pin);
      return;
    }
    if (state.screen === 'borrow') {
      if (digit === 'del') state.amount = state.amount.slice(0, -1);
      else if (state.amount.length < 7) state.amount = String(num(state.amount + digit) || (digit === '0' ? '' : digit));
      paintBorrow();
    }
  }

  function previewing() { return !!state.previewClientId; }

  function sendWithdrawal() {
    if (previewing()) { toast('This is a preview. The request was not sent.'); return; }
    var purpose = String(state.purpose || '').trim();
    var amount = num(state.amount);
    if (!purpose) { toast('Say what the money is for.'); return; }
    if (!(amount > 0)) { toast('Enter an amount.'); return; }
    if (amount > num(account().available) + 0.001) { toast('That is more than the credit still available.'); return; }
    fetch(api('/withdrawals'), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ amount: amount, purpose: purpose }) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { toast(String((res.body && res.body.error) || 'Could not send that request.').slice(0, 160)); return; }
        state.amount = '';
        state.purpose = '';
        toast('Request ' + ((res.body && res.body.ref) || '') + ' is in the Ledger inbox. No money has moved.');
        refreshBook().then(function () { show('request'); });
      })
      .catch(function () { toast('Could not reach Ledger. Try again.'); });
  }

  function sendMessage(text) {
    if (previewing()) { toast('This is a preview. The message was not sent.'); return; }
    var body = String(text || '').trim();
    if (!body) return;
    fetch(api('/messages'), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ body: body }) })
      .then(function (r) { if (!r.ok) throw new Error('no'); return refreshBook(); })
      .then(function () { toast('Sent to Ledger. No money has moved.'); })
      .catch(function () { toast('Could not send that. Try again.'); });
  }

  function signOut() {
    fetch(api('/logout'), { method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json' } }).catch(function () {});
    state.previewClientId = '';
    state.identified = false;
    state.book = null;
    state.pin = '';
    state.pinPhase = state.inviteCode ? 'choose' : 'sign';
    clearInterval(state._poll);
    show('pin');
  }

  function boot() {
    try {
      var raw = localStorage.getItem('quik1.device.v1');
      var saved = raw ? JSON.parse(raw) : null;
      if (saved && /^qb_[0-9a-f]{32}$/.test(saved.accountRef || '')) state.deviceRef = saved.accountRef;
    } catch (e) {}
    var match = /^#invite=([0-9a-f]{64})$/.exec(String(location.hash || ''));
    if (match) { state.inviteCode = match[1]; state.pinPhase = 'choose'; }
    show('pin');
    preparePreview();
    if (!state.inviteCode) {
      fetch(api('/me'), { credentials: 'same-origin', headers: { accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.identified === true && !state.inviteCode) { applyBook(j); startPoll(); } })
        .catch(function () {});
    }
    document.body.addEventListener('click', onClick);
    var purpose = $('borrow-purpose');
    if (purpose) purpose.addEventListener('input', function () { state.purpose = purpose.value; });
    var ref = $('account-ref');
    if (ref) ref.addEventListener('input', function () { state.accountRef = ref.value; });
    var msg = $('message-draft');
    if (msg) msg.addEventListener('input', function () { state.msgDraft = msg.value; });
    var q1 = $('q1-draft');
    if (q1) q1.addEventListener('input', function () { state.aiDraft = q1.value; });
  }

  function onClick(event) {
    var node = event.target.closest('[data-go],[data-key],[data-act]');
    if (!node) return;
    var go = node.getAttribute('data-go');
    var key = node.getAttribute('data-key');
    var act = node.getAttribute('data-act');
    if (go) { show(go); return; }
    if (key) { pushDigit(key); return; }
    if (act === 'withdraw') sendWithdrawal();
    else if (act === 'message') { sendMessage(state.msgDraft); state.msgDraft = ''; var box = $('message-draft'); if (box) box.value = ''; }
    else if (act === 'settle') sendMessage('Please record a settlement on my account. This message does not move money.');
    else if (act === 'ask') { askQ1(state.aiDraft); state.aiDraft = ''; var q = $('q1-draft'); if (q) q.value = ''; }
    else if (act === 'hide') { state.hide = !state.hide; paint(); }
    else if (act === 'signout') signOut();
    else if (act === 'statement') downloadStatement();
  }

  function localAnswer(q) {
    var low = String(q || '').toLowerCase();
    var acct = account();
    var due = fmtIso(acct.next_due);
    if (!state.identified) return 'Sign in with your PIN to read the ledger.';
    if (/owe|balance|outstanding|available/.test(low)) return 'Available credit is ' + money(acct.available) + '. Open principal is ' + money(acct.outstanding_principal) + '.';
    if (/debit|date|due|next|schedule/.test(low)) return due ? ('Next due date on the ledger is ' + due + '.') : 'Nothing is scheduled on the ledger.';
    if (/limit/.test(low)) return 'The limit on the ledger is ' + money(acct.credit_limit) + '.';
    return 'I can only read what is on your ledger. A person replies in Messages.';
  }

  function accountBrief() {
    var acct = account();
    var person = profile();
    var due = fmtIso(acct.next_due);
    return [
      'Customer: ' + (person.name || ''),
      'Bank on the ledger: ' + (person.bank || ''),
      'Open principal: ' + money(acct.outstanding_principal),
      'Available: ' + money(acct.available),
      'Limit: ' + money(acct.credit_limit),
      'Next due: ' + (due || 'Not scheduled')
    ].join('\n');
  }

  function q1Label(s) { return { aiStatus: s.aiTyping ? 'Thinking…' : 'Online' }; }

  function askQ1(text) {
    var q = String(text || '').trim();
    if (!q) return;
    state.aiChat = state.aiChat.concat([{ from: 'me', text: q }]);
    state.aiTyping = true;
    paintMessages();
    var finishLocal = function () { settle(localAnswer(q)); };
    var settle = function (reply) {
      state.aiTyping = false;
      state.aiChat = state.aiChat.concat([{ from: 'bot', text: String(reply || '').trim() || localAnswer(q) }]);
      paintMessages();
    };
    var body = { message: q, brief: accountBrief(), screen: state.screen, applicationId: '' };
    fetch('/api/quik1/q1', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        var txt = String((j && (j.reply || j.text)) || '').trim();
        if (!txt) throw new Error('empty');
        settle(txt);
      })
      .catch(function () {
        var canClaude = typeof window !== 'undefined' && window.claude && window.claude.complete;
        if (!canClaude) { finishLocal(); return; }
        var system = 'You are Q1 inside Quik1. Answer only from the ledger facts below. Do not invent a rate, a fee, a debit, or a date.\n\n' + accountBrief();
        window.claude.complete({ system: system, messages: [{ role: 'user', content: q }] })
          .then(function (r) { settle(String(r || '').trim() || localAnswer(q)); })
          .catch(finishLocal);
      });
  }

  async function downloadStatement() {
    toast('Statements stay on the ledger. This phone does not download a bank file.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
