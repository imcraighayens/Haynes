// Static smoke for the Ledger staff presentation. The boot test still drives the live book.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');

test('the staff nav is the original nine items plus NuPay', () => {
  const nav = "[['dashboard','DASHBOARD'],['loans','LOANS'],['applications','APPLICATIONS'],['messages','MESSAGES'],['clients','CLIENTS'],['logbook','LOGBOOK'],['ledger','ADMIN'],['petty','PETTY CASH'],['notifications','NOTIFICATIONS'],['nupay','NUPAY']]";
  assert.ok(html.includes(nav), 'sidebar keeps the 11 Nov items and NuPay');
  assert.equal((html.match(/class="nav-item"/g) || []).length, 1, 'one nav list');
  assert.match(html, /class="ledger-side"/);
  assert.match(html, /aria-label="Open menu"/);
  assert.match(html, /navDrawer/);
  assert.match(html, /@media \(max-width:820px\)/);
  assert.match(html, /placeholder="Search…"/);
  assert.match(html, /loanPrev/);
  assert.match(html, /appPrev/);
  assert.match(html, /lgPrev/);
});

test('d and src attributes are not raw templates', () => {
  const bad = [];
  const re = /(?:^|[\s<])(d|src)\s*=\s*(["'])([^"']*\{\{[^"']*)\2/g;
  for (const match of html.matchAll(re)) bad.push(match[1] + '=' + match[2] + match[3] + match[2]);
  assert.deepEqual(bad, []);
  assert.match(html, /sc-camel-d="\{\{ f\.i1 \}\}"/);
  assert.match(html, /sc-camel-src="\{\{ reelSrc \}\}"/);
  assert.match(html, /sc-camel-points="\{\{ chartLine \}\}"/);
  assert.match(html, /sc-camel-d="\{\{ s\.iconPath \}\}"/);
});

test('openQuik1Invite shows Unknown when the status fetch fails', () => {
  const blankStart = html.indexOf('q1Blank(c){');
  const blank = html.slice(blankStart, html.indexOf('q1FromStatus(base, j){', blankStart));
  assert.match(blank, /pinStatus:'None'/);
  const start = html.indexOf('openQuik1Invite(clientId, ev){');
  const fn = html.slice(start, html.indexOf('giveQuik1Access(){', start));
  const err = fn.slice(fn.indexOf(',(e)=>{'));
  assert.ok(err.length > 0);
  assert.match(err, /pinStatus:'Unknown'/);
  assert.doesNotMatch(err, /pinStatus:'None'/);
});

test('inviteView shows Unknown for a status fetch dropped from the map', () => {
  const start = html.indexOf('inviteView(c){');
  const fn = html.slice(start, html.indexOf('ensureInviteMap(){', start));
  assert.match(fn, /_inviteMiss\[c\.id\]/);
  assert.match(fn, /pin:missed\?'Unknown':\(\(j&&j\.pinStatus\)\|\|'None'\)/);
  const mapStart = html.indexOf('ensureInviteMap(){');
  const mapFn = html.slice(mapStart, html.indexOf('refreshInvites(){', mapStart));
  assert.match(mapFn, /if\(j\) map\[id\]=j; else miss\[id\]=true/);
  assert.match(mapFn, /this\._inviteMiss=miss/);
});

test('a failed Quik1 status fetch labels the Set PIN panel Unknown', () => {
  const start = html.indexOf('ensureQuik1Status(clientId){');
  assert.ok(start > 0);
  const fn = html.slice(start, html.indexOf('q1Digits(e){', start));
  assert.match(fn, /staffApi\('GET','\/quik1-access\/'\+encodeURIComponent\(clientId\)/);
  assert.match(fn, /q1FromStatus\(base, j\)/);
  assert.match(fn, /pinStatus:'Unknown'/);
  assert.doesNotMatch(fn, /pinStatus:'None'/);
  assert.match(html, /\{\{ q1PinStatus \}\}/);
  assert.match(html, /Set login PIN/);
  assert.equal(html.includes("Send a new invite instead. This client's Quik1 access stays locked until they redeem one."), false);
});

test('loan and client collections are tables with a search, status text, and paging', () => {
  assert.match(html, /role="table" aria-label="Loan book"/);
  assert.match(html, /data-col="ref">Ref number/);
  assert.match(html, /Days overdue/);
  assert.match(html, /EXPECTED RETURN/);
  assert.match(html, /MARKET NEWS/);
  assert.match(html, /data-screen-label="Applications inbox"/);
  assert.match(html, /data-screen-label="NuPay"/);
  assert.match(html, /q1Float: false/);
  assert.match(html, /Set a login PIN/);
  assert.match(html, /placeholder="Search…"/);
  assert.match(html, /No loans in this view/);
  assert.match(html, /No results for that search/);
  assert.match(html, /Set login PIN/);
  assert.doesNotMatch(html, /Give Quik1 access/);
  assert.doesNotMatch(html, /data-label="REVOKE ACCESS"/);
  assert.match(html, /Reset device/);
  assert.match(html, /\/quik1-devices\/reset/);
  assert.match(html, /Next instalment due/);
  assert.match(html, /Final due/);
  assert.doesNotMatch(html, /Invites off until launch/);
  assert.match(html, /borrowerPinLive/);
  assert.match(html, /RESEND INVITE/);
  assert.match(html, /Record payment/);
  assert.match(html, /held:\['Held'/);
  assert.match(html, /'release-held':\['Held'/);
  assert.match(html, /:focus-visible/);
});
