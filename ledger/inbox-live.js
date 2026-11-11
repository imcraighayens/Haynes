/* inbox-live.js — poll the signed-in staff inbox and merge rows by id.
 *
 * Classic script, loaded with ledger-sync.js. The console calls start() while a
 * staff session is open. The timer pauses while the tab is hidden and stops on
 * a 401 or sign-out. New rows are prepended; an id already on screen is kept
 * as the user left it (no duplicate, no selection reset).
 */
(function (W) {
  'use strict';

  var INTERVAL_MS = 20000;

  function mergeInbox(local, incoming) {
    var seen = Object.create(null);
    var out = [];
    var added = [];
    (Array.isArray(local) ? local : []).forEach(function (row) {
      if (!row || row.id == null || row.id === '' || seen[row.id]) return;
      seen[row.id] = true;
      out.push(row);
    });
    var fresh = [];
    (Array.isArray(incoming) ? incoming : []).forEach(function (row) {
      if (!row || row.id == null || row.id === '' || seen[row.id]) return;
      seen[row.id] = true;
      var copy = {};
      Object.keys(row).forEach(function (key) { copy[key] = row[key]; });
      copy.inboxFresh = true;
      fresh.push(copy);
      added.push(copy.id);
    });
    return { applications: fresh.concat(out), added: added };
  }

  function shouldPoll(opts) {
    opts = opts || {};
    if (opts.stopped) return false;
    if (!opts.signedIn) return false;
    if (opts.hidden) return false;
    return true;
  }

  function stopOnAuthError(err) {
    if (!err) return false;
    var status = err.status || err.statusCode;
    if (status === 401) return true;
    var msg = String(err.message || err || '');
    return /\b401\b/.test(msg) || /Unauthorized/i.test(msg);
  }

  function start(opts) {
    opts = opts || {};
    var stopped = false;
    var timer = null;
    var doc = opts.document || null;
    var onVis = null;
    function hidden() { return typeof opts.hidden === 'function' ? !!opts.hidden() : false; }
    function signedIn() { return typeof opts.signedIn === 'function' ? !!opts.signedIn() : false; }
    function stop() {
      stopped = true;
      if (timer != null && typeof opts.clearInterval === 'function') opts.clearInterval(timer);
      timer = null;
      if (onVis && doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVis);
      onVis = null;
    }
    function tick() {
      if (stopped || !signedIn() || hidden()) return Promise.resolve(false);
      return Promise.resolve().then(function () { return opts.fetchFeed(); }).then(function (feed) {
        if (stopped) return false;
        if (typeof opts.onFeed === 'function') opts.onFeed(feed);
        return true;
      }, function (err) {
        if (stopOnAuthError(err)) stop();
        return false;
      });
    }
    var handle = { stop: stop, tick: tick, stopped: function () { return stopped; } };
    if (!signedIn()) return handle;
    if (doc && typeof doc.addEventListener === 'function') {
      onVis = function () { if (!hidden() && !stopped && signedIn()) tick(); };
      doc.addEventListener('visibilitychange', onVis);
    }
    if (typeof opts.setInterval === 'function') {
      timer = opts.setInterval(function () { tick(); }, opts.intervalMs || INTERVAL_MS);
    }
    tick();
    return handle;
  }

  W.__ledgerInbox = {
    INTERVAL_MS: INTERVAL_MS,
    mergeInbox: mergeInbox,
    shouldPoll: shouldPoll,
    stopOnAuthError: stopOnAuthError,
    start: start
  };
})(typeof window !== 'undefined' ? window : globalThis);
