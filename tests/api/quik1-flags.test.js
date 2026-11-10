// Config gates for borrower PIN sign-in. Fail closed: only an exact "1" and a
// real production host or VERCEL_ENV turn the production rules on. These values
// are fixtures, not secrets.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { flagOn, deploymentHost, isProductionDeployment, borrowerPinLive, previewViewAsAllowed } from '../../api/_lib/quik1-flags.js';
import { sessionSecret } from '../../api/_lib/quik1-session.js';
import { storeBorrowerId } from '../../api/_lib/sa-id.js';

const SECRET = 'borrower-session-secret-for-tests-only';
const ID_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const HMAC_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const SA_ID = '9912314800084';
const BORROWER = 'qb_' + 'ab'.repeat(16);

const ENV_KEYS = [
  'QUIK1_BORROWER_PIN',
  'QUIK1_PREVIEW_VIEW_AS_CLIENT',
  'QUIK1_SESSION_SECRET',
  'QUIK1_ID_KEY',
  'QUIK1_ID_HMAC_KEY',
  'VERCEL_ENV'
];

function req(host) {
  return { headers: { host } };
}

function saveEnv() {
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] == null) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

describe('quik1 auth config gates', { concurrency: false }, () => {
  let saved;
  beforeEach(() => {
    saved = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });
  afterEach(() => restoreEnv(saved));

  test('flagOn is true only for the exact string 1', () => {
    assert.equal(flagOn('1'), true);
    for (const value of ['true', 'yes', ' 1', '1 ', 'on', '01', '1\n', '', '2']) {
      assert.equal(flagOn(value), false, JSON.stringify(value));
    }
    assert.equal(flagOn(undefined), false);
    assert.equal(flagOn(1), false);
  });

  test('a 31-character session secret stays off', () => {
    process.env.QUIK1_BORROWER_PIN = '1';
    process.env.QUIK1_SESSION_SECRET = 'a'.repeat(31);
    process.env.QUIK1_ID_KEY = ID_KEY;
    process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
    assert.equal(sessionSecret(), '');
    assert.equal(borrowerPinLive(req('preview.example')), false);
    assert.equal(borrowerPinLive(req('quik1.app')), false);
  });

  test('whitespace-only session and ID keys stay off', () => {
    process.env.QUIK1_BORROWER_PIN = '1';
    process.env.QUIK1_SESSION_SECRET = ' \t\n ';
    assert.equal(sessionSecret(), '');
    assert.equal(borrowerPinLive(req('preview.example')), false);

    process.env.QUIK1_SESSION_SECRET = SECRET;
    process.env.QUIK1_ID_KEY = '   ';
    process.env.QUIK1_ID_HMAC_KEY = '\n\t';
    assert.equal(borrowerPinLive(req('quik1.app')), false);
    process.env.VERCEL_ENV = 'production';
    assert.equal(borrowerPinLive(req('preview.example')), false);
  });

  test('truthy PIN flag strings stay off', () => {
    process.env.QUIK1_SESSION_SECRET = SECRET;
    process.env.QUIK1_ID_KEY = ID_KEY;
    process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
    for (const flag of ['true', 'yes', ' 1', '1 ']) {
      process.env.QUIK1_BORROWER_PIN = flag;
      assert.equal(borrowerPinLive(req('preview.example')), false, flag);
      assert.equal(borrowerPinLive(req('quik1.app')), false, flag);
      process.env.QUIK1_PREVIEW_VIEW_AS_CLIENT = flag;
      assert.equal(previewViewAsAllowed(req('preview.example')), false, flag);
    }
  });

  test('lookalike hosts are not production', () => {
    process.env.QUIK1_BORROWER_PIN = '1';
    process.env.QUIK1_SESSION_SECRET = SECRET;
    const near = [
      'ecoloans-six',
      'ecoloans-six.example',
      'ecoloans-six.vercel.app.evil.example',
      'not-ecoloans-six.vercel.app',
      'ecoloans-sixx.vercel.app',
      'attacker.ecoloans-six.vercel.app',
      'ecoloans-six.vercel.application',
      'prefix-ecoloans-six.vercel.app',
      'ecoloans-six-preview.vercel.app',
      'quik1.app.evil.example',
      'notquik1.app'
    ];
    for (const host of near) {
      assert.equal(isProductionDeployment(req(host)), false, host);
      assert.notEqual(deploymentHost(req(host)), 'ecoloans-six.vercel.app', host);
      assert.notEqual(deploymentHost(req(host)), 'quik1.app', host);
      assert.equal(borrowerPinLive(req(host)), true, host);
    }
    assert.equal(isProductionDeployment(req('ecoloans-six.vercel.app')), true);
    assert.equal(borrowerPinLive(req('ecoloans-six.vercel.app')), false);
  });

  test('a trailing-dot prod host is production and needs 64-hex keys', () => {
    process.env.QUIK1_BORROWER_PIN = '1';
    process.env.QUIK1_PREVIEW_VIEW_AS_CLIENT = '1';
    process.env.QUIK1_SESSION_SECRET = SECRET;
    for (const host of ['quik1.app.', 'QUIK1.APP.', 'quik1.app:443', 'QUIK1.APP.:443']) {
      assert.equal(deploymentHost(req(host)), 'quik1.app', host);
      assert.equal(isProductionDeployment(req(host)), true, host);
      assert.equal(borrowerPinLive(req(host)), false, host);
      assert.equal(previewViewAsAllowed(req(host)), false, host);
    }
    process.env.QUIK1_ID_KEY = ID_KEY;
    process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
    assert.equal(borrowerPinLive(req('quik1.app.')), true);
    assert.equal(borrowerPinLive(req('QUIK1.APP.')), true);
    assert.equal(previewViewAsAllowed(req('quik1.app.')), false);
    assert.equal(deploymentHost(req('ecoloans-six.vercel.app.')), 'ecoloans-six.vercel.app');
    assert.equal(isProductionDeployment(req('ecoloans-six.vercel.app.')), true);
  });

  test('VERCEL_ENV is trimmed, and an unknown env or host stays non-production', () => {
    process.env.QUIK1_BORROWER_PIN = '1';
    process.env.QUIK1_PREVIEW_VIEW_AS_CLIENT = '1';
    process.env.QUIK1_SESSION_SECRET = SECRET;
    process.env.VERCEL_ENV = 'production ';
    assert.equal(isProductionDeployment(req('preview.example')), true);
    assert.equal(borrowerPinLive(req('preview.example')), false);
    assert.equal(previewViewAsAllowed(req('preview.example')), false);

    for (const env of ['preview', ' preview', 'staging', 'productionn', '']) {
      process.env.VERCEL_ENV = env;
      assert.equal(isProductionDeployment(req('preview.example')), false, JSON.stringify(env));
      assert.equal(isProductionDeployment(req('unknown.example')), false, JSON.stringify(env));
      assert.equal(previewViewAsAllowed(req('unknown.example')), true, JSON.stringify(env));
    }
    delete process.env.VERCEL_ENV;
    assert.equal(isProductionDeployment(req('unknown.example')), false);
    assert.equal(borrowerPinLive(req('preview.example')), true);
    assert.equal(previewViewAsAllowed(req('preview.example')), true);
    assert.equal(isProductionDeployment(req('quik1.app..')), false);
  });

  test('63-character and non-hex ID keys keep production off, and valid 64-hex keys keep it on', () => {
    process.env.QUIK1_BORROWER_PIN = '1';
    process.env.QUIK1_SESSION_SECRET = SECRET;
    const short = 'a'.repeat(63);
    const nonHex = 'g'.repeat(64);
    const hosts = ['quik1.app', 'www.quik1.app', 'quik1ledger.com', 'www.quik1ledger.com', 'ecoloans-six.vercel.app'];
    for (const host of hosts) {
      process.env.QUIK1_ID_KEY = short;
      process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
      assert.equal(borrowerPinLive(req(host)), false, host + ' short key');
      process.env.QUIK1_ID_KEY = ID_KEY;
      process.env.QUIK1_ID_HMAC_KEY = short;
      assert.equal(borrowerPinLive(req(host)), false, host + ' short hmac');
      process.env.QUIK1_ID_KEY = nonHex;
      process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
      assert.equal(borrowerPinLive(req(host)), false, host + ' non-hex key');
      process.env.QUIK1_ID_KEY = ID_KEY;
      process.env.QUIK1_ID_HMAC_KEY = nonHex;
      assert.equal(borrowerPinLive(req(host)), false, host + ' non-hex hmac');
    }
    process.env.VERCEL_ENV = 'production ';
    process.env.QUIK1_ID_KEY = short;
    process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
    assert.equal(borrowerPinLive(req('preview.example')), false);

    process.env.QUIK1_ID_KEY = ID_KEY;
    process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
    for (const host of hosts) assert.equal(borrowerPinLive(req(host)), true, host);
    process.env.QUIK1_ID_KEY = ID_KEY.toUpperCase();
    process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY.toUpperCase();
    assert.equal(borrowerPinLive(req('quik1.app')), true);
    assert.equal(borrowerPinLive(req('preview.example')), true);

    delete process.env.VERCEL_ENV;
    process.env.QUIK1_ID_KEY = short;
    process.env.QUIK1_ID_HMAC_KEY = nonHex;
    assert.equal(borrowerPinLive(req('preview.example')), true);
  });

  test('ID storage returns 503 when the keys are invalid', async () => {
    const bad = ['   ', '\t', 'a'.repeat(63), 'g'.repeat(64), 'zz' + 'ab'.repeat(31)];
    for (const key of bad) {
      process.env.QUIK1_ID_KEY = key;
      process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
      await assert.rejects(() => storeBorrowerId(BORROWER, SA_ID), (err) => err.status === 503);
      process.env.QUIK1_ID_KEY = ID_KEY;
      process.env.QUIK1_ID_HMAC_KEY = key;
      await assert.rejects(() => storeBorrowerId(BORROWER, SA_ID), (err) => err.status === 503);
    }
  });
});
