// Every intentional change to the delivered design lives here, applied by
// scripts/compile-template.mjs before compiling. Each `find` must match exactly
// `count` times (default 1) or the build fails — so a re-exported design can't
// silently drop or duplicate a change.
//
// Keep this list short. The brief is "the look stays as delivered".
export const overrides = [
  {
    id: 'splash-blank',
    why: 'Craig, 13 Oct 2026: remove the splash image and leave it blank. The illustration and its dimming overlay go; the black splash keeps the wordmark, dots and progress bar.',
    find:
      '        <video poster="/assets/img/illustration.png" ref="{{ splashVideoRef }}" preload="auto" sc-camel-disable-picture-in-picture="{{ true }}" sc-camel-auto-play="{{ true }}" muted="{{ true }}" loop="{{ true }}" sc-camel-plays-inline="{{ true }}" style="position:absolute;inset:0;z-index:0;width:100%;height:100%;object-fit:cover;opacity:.9"></video>\n' +
      '        <div style="position:absolute;inset:0;z-index:0;background:linear-gradient(180deg,rgba(0,0,0,.3),rgba(0,0,0,.6))"></div>\n',
    replace: '',
  },
  {
    id: 'initials-from-profile',
    why: 'The avatar fallback showed the demo persona\'s initials ("TM"). Bind to the signed-in customer (renders identically for the demo profile).',
    find: '<sc-if value="{{ noPhoto }}" hint-placeholder-val="{{ true }}">TM</sc-if>',
    replace: '<sc-if value="{{ noPhoto }}" hint-placeholder-val="{{ true }}">{{ initials }}</sc-if>',
    count: 5,
  },
  {
    id: 'sidebar-name-from-profile',
    why: 'Desktop sidebar showed the demo persona\'s name as static text.',
    find: '<span style="display:block;font-size:15px;font-weight:500">Thandi Mokoena</span>',
    replace: '<span style="display:block;font-size:15px;font-weight:500">{{ hdrName }}</span>',
  },
  {
    id: 'payout-account-from-profile',
    why: 'Tracker copy hard-coded the demo account ending 4471.',
    find: 'Funds land in the account ending 4471.',
    replace: 'Funds land in the account ending {{ payoutLast4 }}.',
  },
  {
    id: 'a11y-send-label',
    why: 'The Help chat send button is icon-only with no accessible name; screen readers announced "button". Invisible change.',
    find: '<button sc-camel-on-click="{{ onSend }}"',
    replace: '<button aria-label="Send message" sc-camel-on-click="{{ onSend }}"',
  },
];

// Patches to design/logic.js. Same rules: exact match, expected count, a reason.
export const logicOverrides = [
  {
    id: 'real-today',
    why: 'The prototype pinned "today" to 20 Aug 2026 for its screenshots. Production uses the real date (the parity check pins the clock instead).',
    find: 'new Date(2026,7,20)',
    replace: 'new Date()',
    count: 9,
  },
  {
    id: 'statement-logo-path',
    why: 'Statement PDFs referenced a logo path that does not exist in the bundle; point at the shipped wordmark.',
    find: "i.src='assets/quik1-yellow.png'",
    replace: "i.src='/assets/img/quik1-wordmark.png'",
  },
  {
    id: 'repay-bank-from-profile',
    why: 'Repayment copy hard-coded the demo bank (Capitec).',
    find: "' comes off your Capitec account on '",
    replace: "' comes off your '+String((s.profile&&s.profile.bank)||'bank').split(' ')[0]+' account on '",
  },
];
