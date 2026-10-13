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
];
