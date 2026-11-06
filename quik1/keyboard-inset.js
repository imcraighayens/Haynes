// Pins the Ask Q1 composer to the top of the soft keyboard.
//
// The phone shell is position:fixed and 100lvh so the dock stays on the
// physical bottom when the keyboard is closed. That height does not shrink
// when iOS opens the keyboard, and env(safe-area-inset-bottom) stays put,
// so a bottom:0 bar floats or gets clipped. visualViewport is the piece
// that does change. While an Ask Q1 / chat field is focused we measure how
// much of the frame sits below the visual viewport and lift only the
// composer by that amount.

const DELTA = 24;
// Taller than Safari chrome and the home indicator, shorter than a phone keyboard.
const CHROME_MAX = 140;
const UNPRIMED_KEYBOARD = 160;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// paint: how far the frame's painted bottom extends below the visual viewport.
// layout: layout height minus the visible viewport (spec keyboard overlap).
export function measureOverlap(frameBottom, frameHeight, vvHeight, vvOffsetTop) {
  return {
    paint: Math.max(0, num(frameBottom) - num(vvHeight)),
    layout: Math.max(0, num(frameHeight) - num(vvHeight) - num(vvOffsetTop))
  };
}

function insetFor(paint, layout) {
  const lift = paint + 1 < layout ? paint : layout;
  return Math.round(Math.max(0, lift));
}

function idle(signal, primed) {
  return { inset: 0, rest: signal, open: false, hold: false, primed: primed !== false };
}

/**
 * @param {{rest?:number, open?:boolean, primed?:boolean}} state
 * @param {{paint?:number, layout?:number}} overlap
 * @param {boolean} editing Ask Q1 or the chat field is focused
 * @param {boolean} hasFrame .q-frame is in the document
 */
export function stepKeyboard(state, overlap, editing, hasFrame) {
  const prev = state || {};
  if (!hasFrame) {
    return { inset: 0, rest: num(prev.rest), open: false, hold: false, primed: !!prev.primed };
  }
  const paint = Math.max(0, num(overlap && overlap.paint));
  const layout = Math.max(0, num(overlap && overlap.layout));
  const signal = layout;
  const rest = num(prev.rest);
  const open = !!prev.open;
  const primed = !!prev.primed;

  if (!primed) {
    if (!editing) return { inset: 0, rest: signal, open: false, hold: false, primed: true };
    if (signal >= UNPRIMED_KEYBOARD) {
      return { inset: insetFor(paint, layout), rest: 0, open: true, hold: false, primed: true };
    }
    return { inset: 0, rest: 0, open: false, hold: false, primed: false };
  }

  const grew = signal - rest;
  if (!editing) {
    // Back to browser chrome. Learn it so the next keyboard still measures a delta.
    if (signal < CHROME_MAX) return idle(signal, true);
    if (open && grew >= DELTA) {
      return { inset: insetFor(paint, layout), rest, open: true, hold: false, primed: true };
    }
    // Viewport jumped before focus was reported. Don't treat the keyboard as chrome.
    if (!open && grew >= DELTA) {
      return { inset: 0, rest, open: false, hold: true, primed: true };
    }
    return idle(signal, true);
  }
  if (grew >= DELTA) {
    return { inset: insetFor(paint, layout), rest, open: true, hold: false, primed: true };
  }
  return { inset: 0, rest, open: false, hold: false, primed: true };
}

export function settleKeyboard(signal) {
  return idle(Math.max(0, num(signal)), true);
}

// Scroll when keyboard mode starts, and again on each visualViewport resize
// while it stays on, so the latest bubble stays above the composer.
export function shouldStickChat(wasOpen, open, viewportResized) {
  return !!open && (!wasOpen || !!viewportResized);
}

export function scrollChatLog(doc) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return 0;
  const lists = doc.querySelectorAll('.q-chat-log');
  let n = 0;
  for (let i = 0; i < lists.length; i++) {
    const el = lists[i];
    if (!el) continue;
    try {
      el.scrollTop = el.scrollHeight;
      n += 1;
    } catch (e) { /* a detached list should not break the dock */ }
  }
  return n;
}

export function applyKeyboardMode(root, next) {
  if (!root || !root.classList || !root.style) return;
  if (next && next.open) {
    root.classList.add('q-kb');
    root.style.setProperty('--q-kb', num(next.inset) + 'px');
  } else {
    root.classList.remove('q-kb');
    root.style.setProperty('--q-kb', '0px');
  }
}

export function askFieldFocused(doc) {
  const el = doc && doc.activeElement;
  if (!el || !el.closest) return false;
  return !!el.closest('.q-ask, .q-chat');
}

export function phoneLayout(doc, win) {
  const root = doc && doc.documentElement;
  if (root && root.classList && root.classList.contains('q-standalone')) return true;
  try {
    return !!(win && win.matchMedia && win.matchMedia('(max-width: 1023px), (pointer: coarse), (display-mode: standalone), (display-mode: fullscreen)').matches);
  } catch (e) {
    return false;
  }
}

function readFrame(doc, win) {
  const frame = doc.querySelector && doc.querySelector('.q-frame');
  const vv = win && win.visualViewport;
  if (!frame || !vv || typeof frame.getBoundingClientRect !== 'function') return null;
  if (!frame.offsetHeight || !vv.height) return null;
  const rect = frame.getBoundingClientRect();
  return measureOverlap(rect.bottom, frame.offsetHeight, vv.height, vv.offsetTop);
}

export function installKeyboardInset(doc, win) {
  if (!doc || !win || !doc.documentElement) return;
  // Older browsers have no visualViewport. Leave the dock at the physical
  // bottom instead of throwing or inventing a lift.
  const vv = win.visualViewport;
  if (!vv || typeof vv.addEventListener !== 'function') return;
  const root = doc.documentElement;
  let state = { rest: 0, open: false, primed: false };
  let raf = 0;
  let holdTimer = 0;
  let lastKey = '';
  let resizePending = false;

  function publish(next) {
    const key = (next.open ? '1' : '0') + ':' + next.inset;
    if (key === lastKey) return;
    lastKey = key;
    applyKeyboardMode(root, next);
  }

  function stickChat() {
    scrollChatLog(doc);
    if (typeof win.requestAnimationFrame !== 'function') return;
    win.requestAnimationFrame.call(win, function () {
      if (root.classList.contains('q-kb')) scrollChatLog(doc);
    });
  }

  function update() {
    raf = 0;
    const resized = resizePending;
    resizePending = false;
    const wasOpen = !!state.open;
    if (!phoneLayout(doc, win)) {
      if (root.classList.contains('q-kb')) publish({ open: false, inset: 0 });
      return;
    }
    const overlap = readFrame(doc, win);
    const hasFrame = !!overlap;
    const editing = askFieldFocused(doc);
    const next = stepKeyboard(state, overlap || { paint: 0, layout: 0 }, editing, hasFrame);
    state = { rest: next.rest, open: next.open, primed: next.primed };
    publish(next);
    if (shouldStickChat(wasOpen, next.open, resized)) stickChat();
    if (next.hold) {
      if (holdTimer) win.clearTimeout(holdTimer);
      holdTimer = win.setTimeout(function () {
        holdTimer = 0;
        if (!askFieldFocused(doc)) {
          const again = readFrame(doc, win);
          const signal = again ? again.layout : 0;
          state = settleKeyboard(signal);
          publish(state);
        }
      }, 500);
    }
    // Only undo a real document scroll. visualViewport.offsetTop is already
    // part of the overlap math; forcing it every frame fights iOS.
    const scrolled = win.scrollY || (doc.documentElement && doc.documentElement.scrollTop) || 0;
    if (next.open && scrolled) {
      try { win.scrollTo(0, 0); } catch (e) { /* ignore */ }
    }
  }

  function schedule() {
    if (raf) return;
    const run = function () { update(); };
    if (typeof win.requestAnimationFrame === 'function') {
      raf = win.requestAnimationFrame.call(win, run);
    } else {
      raf = win.setTimeout(run, 16);
    }
  }

  vv.addEventListener('resize', function () {
    resizePending = true;
    schedule();
  });
  vv.addEventListener('scroll', schedule);
  win.addEventListener('resize', schedule);
  win.addEventListener('orientationchange', schedule);
  doc.addEventListener('focusin', function () {
    schedule();
    win.setTimeout(schedule, 60);
    win.setTimeout(schedule, 320);
    win.setTimeout(schedule, 640);
  });
  doc.addEventListener('focusout', function () {
    schedule();
    win.setTimeout(schedule, 80);
    win.setTimeout(schedule, 360);
  });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', schedule);
  else schedule();
  win.setTimeout(schedule, 400);
  win.setTimeout(schedule, 1500);
}

const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
if (hasDom) installKeyboardInset(document, window);
