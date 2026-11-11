// node --test tests/inbox-live.test.js
// Polls the signed-in staff inbox. Mocked timers and rows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../ledger/inbox-live.js', import.meta.url), 'utf8');
const HTML = fs.readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');

function load() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'inbox-live.js' });
  return sandbox.__ledgerInbox;
}

function clock() {
  const timers = new Map();
  let n = 0;
  return {
    timers,
    setInterval(fn, ms) { const id = ++n; timers.set(id, { fn, ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    async fire() {
      const jobs = [...timers.values()];
      for (const job of jobs) job.fn();
      await settle();
    }
  };
}

async function settle() {
  await new Promise(r => setTimeout(r, 0));
}

const live = load();

test('the inbox poll interval is between 15 and 30 seconds', () => {
  assert.ok(live.INTERVAL_MS >= 15000 && live.INTERVAL_MS <= 30000);
});

test('a new website row on the next poll appears once, without a reload', async () => {
  const ticks = clock();
  let rows = [{ id: 'qk_ap_0123456789ab', extId: 'ap_0123456789ab', source: 'Quik1 app', name: 'App Applicant', status: 'new' }];
  let fetches = 0;
  let reloaded = false;
  const feeds = [
    { applications: [] },
    { applications: [{ id: 'ew_aabbccddeeff', extId: 'ew_aabbccddeeff', source: 'Website', name: 'Web Applicant', status: 'new' }] }
  ];
  const selected = 'qk_ap_0123456789ab';
  let appViewId = selected;
  const handle = live.start({
    signedIn: () => true,
    hidden: () => false,
    fetchFeed: async () => {
      fetches += 1;
      return feeds[Math.min(fetches - 1, feeds.length - 1)];
    },
    onFeed: (feed) => {
      const merged = live.mergeInbox(rows, feed.applications);
      rows = merged.applications;
      appViewId = selected;
    },
    setInterval: ticks.setInterval,
    clearInterval: ticks.clearInterval,
    intervalMs: live.INTERVAL_MS
  });
  await settle();
  assert.equal(fetches, 1);
  assert.equal(rows.some(a => a.id === 'ew_aabbccddeeff'), false);
  assert.equal(reloaded, false);
  await ticks.fire();
  const site = rows.find(a => a.id === 'ew_aabbccddeeff');
  assert.ok(site, 'the website row is on screen after the next poll');
  assert.equal(site.source, 'Website');
  assert.equal(site.inboxFresh, true);
  assert.equal(appViewId, selected, 'the open row stays selected');
  assert.equal(reloaded, false);
  const before = rows.length;
  await ticks.fire();
  assert.equal(rows.length, before, 'polling the same row again does not duplicate it');
  assert.equal(rows.filter(a => a.id === 'ew_aabbccddeeff').length, 1);
  assert.equal(handle.stopped(), false);
  handle.stop();
});

test('merge keeps a website row when the inbox is closed and the feed is applied again', () => {
  const local = [{ id: 'ew_aabbccddeeff', extId: 'ew_aabbccddeeff', source: 'Website', name: 'Web Applicant', status: 'reviewing' }];
  const closed = local.slice();
  const merged = live.mergeInbox(closed, [
    { id: 'ew_aabbccddeeff', source: 'Website', status: 'new', name: 'Web Applicant' },
    { id: 'qk_ap_0123456789ab', source: 'Quik1 app', name: 'App Applicant' }
  ]);
  assert.equal(merged.applications.filter(a => a.id === 'ew_aabbccddeeff').length, 1);
  assert.equal(merged.applications.find(a => a.id === 'ew_aabbccddeeff'), local[0], 'the open row object is kept');
  assert.equal(merged.applications.find(a => a.id === 'ew_aabbccddeeff').status, 'reviewing');
  const quick = merged.applications.find(a => a.id === 'qk_ap_0123456789ab');
  assert.equal(quick.source, 'Quik1 app');
  const again = live.mergeInbox(merged.applications, []);
  assert.equal(again.applications.filter(a => a.id === 'ew_aabbccddeeff').length, 1);
  assert.equal(again.added.length, 0);
});

test('no polling when signed out, while hidden, or after a 401', async () => {
  const signedOut = clock();
  let fetches = 0;
  const idle = live.start({
    signedIn: () => false,
    hidden: () => false,
    fetchFeed: async () => { fetches += 1; return { applications: [] }; },
    setInterval: signedOut.setInterval,
    clearInterval: signedOut.clearInterval
  });
  await settle();
  await signedOut.fire();
  assert.equal(fetches, 0);
  assert.equal(signedOut.timers.size, 0);
  assert.equal(idle.stopped(), false);

  let hidden = true;
  const paused = clock();
  const listeners = {};
  const doc = {
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type) { delete listeners[type]; }
  };
  live.start({
    signedIn: () => true,
    hidden: () => hidden,
    document: doc,
    fetchFeed: async () => { fetches += 1; return { applications: [] }; },
    setInterval: paused.setInterval,
    clearInterval: paused.clearInterval
  });
  await settle();
  await paused.fire();
  assert.equal(fetches, 0, 'a hidden tab does not poll');
  hidden = false;
  listeners.visibilitychange();
  await settle();
  assert.equal(fetches, 1, 'showing the tab polls again');

  fetches = 0;
  const denied = clock();
  const handle = live.start({
    signedIn: () => true,
    hidden: () => false,
    fetchFeed: async () => {
      fetches += 1;
      const err = new Error('HTTP 401 Unauthorized');
      err.status = 401;
      throw err;
    },
    setInterval: denied.setInterval,
    clearInterval: denied.clearInterval
  });
  await settle();
  assert.equal(fetches, 1);
  assert.equal(denied.timers.size, 0, 'a 401 clears the timer');
  assert.equal(handle.stopped(), true);
  await handle.tick();
  assert.equal(fetches, 1, 'nothing is fetched after the 401');
});

test('the console wires the poll, keeps ew_ ids, and does not touch the Quik1Link outbox', () => {
  assert.match(HTML, /src="\.\/inbox-live\.js"/);
  assert.match(HTML, /signOut:\(e\)=>\{ if\(e&&e\.stopPropagation\)e\.stopPropagation\(\); this\.stopInboxPoll\(\)/);
  assert.match(HTML, /appClose:\(\)=>this\.setState\(\{appViewId:null\}\)/);
  assert.match(HTML, /live\.mergeInbox\(p\.applications/);
  assert.equal(/quik1-link|outbox/i.test(SRC), false);
  const at = HTML.indexOf('qkMap(r){');
  assert.ok(at > 0);
  let depth = 0;
  let started = false;
  let end = at;
  for (; end < HTML.length; end++) {
    if (HTML[end] === '{') { depth += 1; started = true; }
    else if (HTML[end] === '}') {
      depth -= 1;
      if (started && depth === 0) { end += 1; break; }
    }
  }
  const source = '(function(){ return { ' + HTML.slice(at, end) + ', todayStamp(){ return "01 NOV 2026"; } }; })()';
  const api = vm.runInNewContext(source, {});
  const site = api.qkMap({ id: 'ew_aabbccddeeff', name: 'Web Applicant', source: 'ecoloan_web', amount: 1500, status: 'new' });
  assert.equal(site.id, 'ew_aabbccddeeff');
  assert.equal(site.extId, 'ew_aabbccddeeff');
  assert.equal(site.source, 'Website');
  const plain = api.qkMap({ id: 'ap_0123456789ab', name: 'App Applicant', source: 'quik1', amount: 800, status: 'new' });
  assert.equal(plain.id, 'qk_ap_0123456789ab');
  assert.equal(plain.source, 'Quik1 app · via Q1');
  assert.equal(api.qkMap({ id: 'zz_001', name: 'Other Applicant', source: 'partner_api' }), null);
});
