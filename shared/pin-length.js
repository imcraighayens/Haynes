// Quik1 borrower PINs are this many digits. Server code imports the export.
// Loaded in the browser as a module, it also publishes the same value on
// globalThis so Ledger and Quik1 can read it without a bundler.
export const QUIK1_PIN_LENGTH = 5;

globalThis.QUIK1_PIN_LENGTH = QUIK1_PIN_LENGTH;
