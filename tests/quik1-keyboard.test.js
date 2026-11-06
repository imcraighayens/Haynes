// Ask Q1 composer tracks the iOS keyboard without moving the closed-keyboard dock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyKeyboardMode, measureOverlap, settleKeyboard, stepKeyboard } from '../quik1/keyboard-inset.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quik = fs.readFileSync(path.join(root, 'quik1/index.html'), 'utf8');
const keyboard = fs.readFileSync(path.join(root, 'quik1/keyboard-inset.js'), 'utf8');

function step(state, overlap, editing, hasFrame = true) {
  return stepKeyboard(state, overlap, editing, hasFrame);
}

test('overlap is the layout covered below the visual viewport', () => {
  assert.deepEqual(measureOverlap(844, 844, 844, 0), { paint: 0, layout: 0 });
  assert.deepEqual(measureOverlap(844, 844, 508, 0), { paint: 336, layout: 336 });
  // A pan shifts both measurements together when rects are visual-relative.
  assert.deepEqual(measureOverlap(804, 844, 508, 40), { paint: 296, layout: 296 });
  assert.deepEqual(measureOverlap(0, 0, 0, 0), { paint: 0, layout: 0 });
});

test('resting Safari chrome is learned and does not lift the dock', () => {
  let s = { rest: 0, open: false, primed: false };
  s = step(s, { paint: 104, layout: 104 }, false);
  assert.equal(s.primed, true);
  assert.equal(s.rest, 104);
  assert.equal(s.open, false);
  assert.equal(s.inset, 0);
  s = step(s, { paint: 110, layout: 110 }, true);
  assert.equal(s.open, false);
  assert.equal(s.inset, 0);
  assert.equal(s.rest, 104);
});

test('standalone keyboard lifts the composer by the full overlap', () => {
  let s = step({ rest: 0, open: false, primed: false }, { paint: 0, layout: 0 }, false);
  s = step(s, { paint: 0, layout: 0 }, true);
  assert.equal(s.open, false);
  s = step(s, { paint: 336, layout: 336 }, true);
  assert.equal(s.open, true);
  assert.equal(s.inset, 336);
  assert.equal(s.rest, 0);
});

test('Safari keyboard uses the full overlap, not the growth over the toolbar', () => {
  let s = step({ rest: 0, open: false, primed: false }, { paint: 104, layout: 104 }, false);
  s = step(s, { paint: 336, layout: 336 }, true);
  assert.equal(s.inset, 336);
  assert.equal(s.open, true);
  assert.equal(s.rest, 104);
});

test('a frame the browser already shifted lifts only the painted remainder', () => {
  let s = step({ rest: 0, open: false, primed: false }, { paint: 0, layout: 0 }, false);
  s = step(s, { paint: 34, layout: 336 }, true);
  assert.equal(s.open, true);
  assert.equal(s.inset, 34);
});

test('keyboard close follows the animation then snaps back onto the chrome', () => {
  let s = step({ rest: 0, open: false, primed: false }, { paint: 104, layout: 104 }, false);
  s = step(s, { paint: 336, layout: 336 }, true);
  s = step(s, { paint: 200, layout: 200 }, false);
  assert.equal(s.open, true);
  assert.equal(s.inset, 200);
  assert.equal(s.rest, 104);
  s = step(s, { paint: 104, layout: 104 }, false);
  assert.equal(s.open, false);
  assert.equal(s.inset, 0);
  assert.equal(s.rest, 104);
});

test('a viewport jump before focus does not become the resting chrome', () => {
  let s = step({ rest: 0, open: false, primed: false }, { paint: 104, layout: 104 }, false);
  s = step(s, { paint: 336, layout: 336 }, false);
  assert.equal(s.hold, true);
  assert.equal(s.open, false);
  assert.equal(s.inset, 0);
  assert.equal(s.rest, 104);
  s = step(s, { paint: 336, layout: 336 }, true);
  assert.equal(s.open, true);
  assert.equal(s.inset, 336);
});

test('settle after a held jump learns the current chrome', () => {
  const s = settleKeyboard(108);
  assert.equal(s.open, false);
  assert.equal(s.inset, 0);
  assert.equal(s.rest, 108);
  assert.equal(s.primed, true);
});

test('no frame and a missing viewport do not open keyboard mode', () => {
  const s = step({ rest: 40, open: true, primed: true }, { paint: 300, layout: 300 }, true, false);
  assert.equal(s.open, false);
  assert.equal(s.inset, 0);
  assert.equal(s.primed, true);
  assert.equal(s.rest, 40);
});

test('applyKeyboardMode toggles the hook the stylesheet reads', () => {
  const classes = new Set();
  const style = new Map();
  const el = {
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); }
    },
    style: {
      setProperty(k, v) { style.set(k, v); }
    }
  };
  applyKeyboardMode(el, { open: true, inset: 280 });
  assert.equal(classes.has('q-kb'), true);
  assert.equal(style.get('--q-kb'), '280px');
  applyKeyboardMode(el, { open: false, inset: 0 });
  assert.equal(classes.has('q-kb'), false);
  assert.equal(style.get('--q-kb'), '0px');
});

test('Ask Q1 and the chat sheet are wired to the visual viewport', () => {
  assert.match(quik, /<script type="module" src="keyboard-inset\.js"><\/script>/);
  assert.match(keyboard, /visualViewport/);
  assert.match(keyboard, /vv\.addEventListener\('resize'/);
  assert.match(keyboard, /vv\.addEventListener\('scroll'/);
  assert.match(keyboard, /\.q-ask, \.q-chat/);
  assert.match(quik, /class="q-dock q-ask"/);
  assert.match(quik, /class="q-ask-strip"/);
  assert.match(quik, /class="q-chat"/);
  assert.match(quik, /class="q-chat-bar"/);
  assert.match(quik, /html\.q-kb \.q-ask \{[^}]*bottom: var\(--q-kb, 0px\) !important/);
  assert.match(quik, /html\.q-kb \.q-ask \{[^}]*padding-bottom: 0 !important/);
  assert.match(quik, /html\.q-kb \.q-ask \{[^}]*animation: none !important/);
  assert.match(quik, /html\.q-kb \.q-chat \{[^}]*bottom: var\(--q-kb, 0px\) !important/);
  assert.match(quik, /html\.q-kb \.q-chat-bar \{[^}]*padding-bottom: 0 !important/);
  // Closed keyboard still uses the physical bottom and the home-indicator inset.
  assert.match(quik, /class="q-dock q-ask" style="position:absolute;right:18px;bottom:0;z-index:44;[^"]*padding-bottom:env\(safe-area-inset-bottom\);animation:q-float/);
  assert.match(quik, /class="q-dock" style="position:absolute;left:18px;bottom:0;z-index:45;padding-bottom:env\(safe-area-inset-bottom\)/);
  assert.match(quik, /height:\s*100lvh\s*!important/);
  assert.doesNotMatch(quik, /height:\s*100dvh\s*!important/);
  assert.match(quik, /user-scalable=no/);
  assert.match(quik, /placeholder="Ask Q1 anything" style="[^"]*font-size:16px/);
});
