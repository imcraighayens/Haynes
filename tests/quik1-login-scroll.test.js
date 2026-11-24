// The design login does not scroll. Spacing from the layout pass stays:
// 96px logo, 36px headline, 26px side padding. Email-link buttons stay off.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quik = fs.readFileSync(path.join(root, 'quik1/index.html'), 'utf8');

test('the login column does not scroll and keeps the design spacing', () => {
  assert.match(quik, /class="q-login" style="[^"]*overflow:hidden/);
  assert.equal(quik.includes('overflow-y:auto;scrollbar-width:none;position:relative;z-index:1;display:flex;flex-direction:column;gap:22px'), false);
  assert.match(quik, /width:96px;height:auto;display:block;margin-bottom:16px/);
  assert.match(quik, /font-size:36px;font-weight:500;line-height:1\.08;letter-spacing:-\.035em;text-wrap:balance">\{\{ loginHead \}\}/);
  assert.match(quik, /Are you short before payday/);
  assert.match(quik, /label:'Face ID'/);
  assert.match(quik, /label:'PIN'/);
  assert.match(quik, /label:'Sign in'/);
  assert.match(quik, /label:'Sign up'/);
  assert.match(quik, /pinPhase:known\?'sign':'idpin'/);
  assert.match(quik, /Your SA ID, then your '/);
  assert.equal(quik.includes('>Email me a link<'), false);
  assert.equal(quik.includes('>Use ID number<'), false);
  assert.match(quik, /showMethods:false/);
});
