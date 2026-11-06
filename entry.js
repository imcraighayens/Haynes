/* Public Ledger entrance. Staff sign-in uses the same-origin Ledger API only. */
(function () {
  var SESSION = '/api/ledger/session';
  var LOGIN = '/api/ledger/login';
  var CONSOLE = '/ledger/';
  var root = document.querySelector('[data-entry]');
  if (!root) return;

  function text(el, value) {
    if (el) el.textContent = value == null ? '' : String(value);
  }

  function consolePath() {
    var next = '';
    try { next = new URLSearchParams(location.search).get('next') || ''; } catch (e) { next = ''; }
    if (next === '/ledger' || next === '/ledger/') return CONSOLE;
    return CONSOLE;
  }

  function sessionSignal() {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(8000);
    return undefined;
  }

  function readSession() {
    return fetch(SESSION, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
      signal: sessionSignal()
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json().then(function (body) { return body && body.ok ? body : null; }, function () { return null; });
    }, function () { return null; });
  }

  var kind = root.getAttribute('data-entry');

  if (kind === 'home') {
    var enter = document.getElementById('enter');
    var session = document.getElementById('session');
    readSession().then(function (body) {
      if (!body) return;
      var name = body.staff && body.staff.displayName ? String(body.staff.displayName) : '';
      if (session) {
        session.hidden = false;
        text(session, name ? ('Signed in as ' + name + '.') : 'A staff session is already open.');
      }
      if (enter) {
        enter.href = CONSOLE;
        text(enter, 'Continue');
      }
    });
    return;
  }

  if (kind !== 'login') return;

  var form = document.getElementById('staff-login');
  var email = document.getElementById('email');
  var password = document.getElementById('password');
  var submit = document.getElementById('submit');
  var status = document.getElementById('status');
  var toggle = document.getElementById('toggle-password');
  var pending = false;

  function setStatus(message) {
    text(status, message || '');
  }

  function setPending(on) {
    pending = on;
    if (submit) {
      submit.disabled = on;
      text(submit, on ? 'Signing in' : 'Sign in');
    }
    if (form) {
      if (on) form.setAttribute('aria-busy', 'true');
      else form.removeAttribute('aria-busy');
    }
  }

  try {
    if (new URLSearchParams(location.search).get('notice') === 'unavailable') {
      setStatus('Sign-in is unavailable right now.');
    }
  } catch (e) {}

  readSession().then(function (body) {
    if (body) location.replace(consolePath());
  });

  if (toggle && password) {
    toggle.addEventListener('click', function () {
      var show = password.getAttribute('type') === 'password';
      password.setAttribute('type', show ? 'text' : 'password');
      toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
      text(toggle, show ? 'Hide' : 'Show');
    });
  }

  if (!form) return;
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (pending) return;
    var mail = email ? String(email.value || '').trim() : '';
    var pass = password ? String(password.value || '') : '';
    if (email) email.setAttribute('aria-invalid', mail ? 'false' : 'true');
    if (password) password.setAttribute('aria-invalid', pass ? 'false' : 'true');
    if (!mail || !pass) {
      setStatus('Enter your staff email and password.');
      if (!mail && email) email.focus();
      else if (password) password.focus();
      return;
    }
    setPending(true);
    setStatus('');
    fetch(LOGIN, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: mail, password: pass })
    }).then(function (res) {
      if (res.ok) {
        if (password) password.value = '';
        location.replace(consolePath());
        return;
      }
      setPending(false);
      if (password) {
        password.value = '';
        password.setAttribute('aria-invalid', 'true');
        password.focus();
      }
      if (res.status === 503) setStatus('Sign-in is unavailable right now.');
      else if (res.status === 401 || res.status === 403) setStatus('Sign-in failed. Check your email and password.');
      else setStatus('Sign-in could not be reached. Try again.');
    }, function () {
      setPending(false);
      setStatus('Sign-in could not be reached. Try again.');
    });
  });
})();
