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

  if (kind === 'apply') {
    var applyForm = document.getElementById('company-apply');
    var notice = document.getElementById('notice');
    var applyStatus = document.getElementById('status');
    var applySubmit = document.getElementById('submit');
    var company = document.getElementById('company');
    var contact = document.getElementById('contact');
    var workEmail = document.getElementById('email');
    var phone = document.getElementById('phone');
    var applyPending = false;

    function applyText(message) {
      text(applyStatus, message || '');
    }

    fetch('/api/company/status', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
      signal: sessionSignal()
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }, function () { return null; }).then(function (body) {
      if (!notice || !body || body.configured !== false) return;
      text(notice, 'Subscription billing is not set up. This page cannot save an application or take payment.');
    });

    if (!applyForm) return;
    applyForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (applyPending) return;
      var companyName = company ? String(company.value || '').trim() : '';
      var contactName = contact ? String(contact.value || '').trim() : '';
      var mail = workEmail ? String(workEmail.value || '').trim() : '';
      var tel = phone ? String(phone.value || '').trim() : '';
      if (company) company.setAttribute('aria-invalid', companyName.length >= 2 ? 'false' : 'true');
      if (contact) contact.setAttribute('aria-invalid', contactName.length >= 2 ? 'false' : 'true');
      if (workEmail) workEmail.setAttribute('aria-invalid', mail.indexOf('@') > 0 ? 'false' : 'true');
      if (companyName.length < 2 || contactName.length < 2 || mail.indexOf('@') < 1) {
        applyText('Enter the company name, your name, and a work email.');
        return;
      }
      applyPending = true;
      if (applySubmit) {
        applySubmit.disabled = true;
        text(applySubmit, 'Checking');
      }
      applyText('');
      fetch('/api/company/apply', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: companyName, contact: contactName, email: mail, phone: tel })
      }).then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body || {} };
        }, function () { return { ok: res.ok, status: res.status, body: {} }; });
      }, function () { return { ok: false, status: 0, body: {} }; }).then(function (result) {
        applyPending = false;
        if (applySubmit) {
          applySubmit.disabled = false;
          text(applySubmit, 'Apply');
        }
        var saved = !!(result.body && result.body.saved === true);
        if (saved) {
          applyText('The application was saved.');
          return;
        }
        if (result.status === 400 && result.body && result.body.error) {
          applyText(String(result.body.error));
          return;
        }
        applyText('Nothing was saved and nothing was charged. Company onboarding is not configured.');
      });
    });
    return;
  }

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

  if (kind === 'forgot') {
    var forgotForm = document.getElementById('staff-forgot');
    var forgotEmail = document.getElementById('email');
    var forgotStatus = document.getElementById('status');
    var forgotSubmit = document.getElementById('submit');
    var forgotPending = false;
    if (!forgotForm) return;
    forgotForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (forgotPending) return;
      var mail = forgotEmail ? String(forgotEmail.value || '').trim() : '';
      if (mail.indexOf('@') < 1) {
        text(forgotStatus, 'Enter an email address.');
        return;
      }
      forgotPending = true;
      if (forgotSubmit) {
        forgotSubmit.disabled = true;
        text(forgotSubmit, 'Sending');
      }
      text(forgotStatus, '');
      fetch('/api/ledger/recover', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mail })
      }).then(function (res) {
        return { status: res.status };
      }, function () { return { status: 0 }; }).then(function (result) {
        forgotPending = false;
        if (forgotSubmit) {
          forgotSubmit.disabled = false;
          text(forgotSubmit, 'Send reset link');
        }
        if (forgotEmail) forgotEmail.value = '';
        if (result.status === 503) text(forgotStatus, 'Password reset is unavailable right now.');
        else if (result.status === 429) text(forgotStatus, 'Wait a moment, then try again.');
        else text(forgotStatus, 'If that email belongs to an active staff account, a reset link is on its way.');
      });
    });
    return;
  }

  if (kind === 'reset') {
    var resetForm = document.getElementById('staff-reset');
    var resetMissing = document.getElementById('reset-missing');
    var resetStatus = document.getElementById('status');
    var resetPassword = document.getElementById('password');
    var resetConfirm = document.getElementById('confirm');
    var resetSubmit = document.getElementById('submit');
    var resetToggle = document.getElementById('toggle-password');
    var resetPending = false;
    var params = new URLSearchParams(location.search);
    var tokenHash = params.get('token_hash') || '';
    var tokenType = params.get('type') || 'recovery';
    if (location.search) history.replaceState(null, '', location.pathname);
    var usable = tokenType === 'recovery' && /^[A-Za-z0-9_-]{20,512}$/.test(tokenHash);
    if (!usable) {
      if (resetForm) resetForm.hidden = true;
      if (resetMissing) resetMissing.hidden = false;
      return;
    }
    if (resetMissing) resetMissing.hidden = true;
    if (resetForm) resetForm.hidden = false;
    if (resetToggle && resetPassword) {
      resetToggle.addEventListener('click', function () {
        var show = resetPassword.getAttribute('type') === 'password';
        resetPassword.setAttribute('type', show ? 'text' : 'password');
        resetToggle.setAttribute('aria-pressed', show ? 'true' : 'false');
        text(resetToggle, show ? 'Hide' : 'Show');
      });
    }
    if (!resetForm) return;
    resetForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (resetPending) return;
      var next = resetPassword ? String(resetPassword.value || '') : '';
      var again = resetConfirm ? String(resetConfirm.value || '') : '';
      if (next.length < 8 || next !== again) {
        text(resetStatus, next.length < 8 ? 'Use at least 8 characters.' : 'Those passwords do not match.');
        return;
      }
      resetPending = true;
      if (resetSubmit) {
        resetSubmit.disabled = true;
        text(resetSubmit, 'Updating');
      }
      text(resetStatus, '');
      fetch('/api/ledger/recover/complete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_hash: tokenHash, password: next })
      }).then(function (res) {
        return { status: res.status };
      }, function () { return { status: 0 }; }).then(function (result) {
        resetPending = false;
        if (resetPassword) resetPassword.value = '';
        if (resetConfirm) resetConfirm.value = '';
        tokenHash = '';
        if (result.status === 200) {
          if (resetForm) resetForm.hidden = true;
          text(resetStatus, 'Password updated. Sign in with the new password.');
          return;
        }
        if (resetSubmit) {
          resetSubmit.disabled = false;
          text(resetSubmit, 'Update password');
        }
        if (result.status === 503) text(resetStatus, 'Password reset is unavailable right now.');
        else if (result.status === 429) text(resetStatus, 'Wait a moment, then try again.');
        else text(resetStatus, 'This reset link is invalid or has expired.');
      });
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
