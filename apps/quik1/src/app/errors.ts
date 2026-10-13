// Server error codes → the design's own toast/modal copy.
export type Notice = { title: string; body: string };

export class ApiError extends Error {
  constructor(public code: string) { super(code); }
}

const SUPPORT = 'applications@ecoloans.co.za';

export const NOTICES: Record<string, Notice> = {
  NO_ACCOUNT: { title: 'No account found', body: 'We could not find an account for this number. Tap Sign up to create one.' },
  ID_MISMATCH: { title: 'Details do not match', body: 'That ID number is not linked to this mobile number.' },
  IN_REVIEW: { title: 'Account still in review', body: `Your sign-up is with ${SUPPORT}. We will SMS you once it is approved.` },
  NOT_APPROVED: { title: 'Account not approved', body: `This sign-up was declined. Email ${SUPPORT} for help.` },
  TOO_MANY_CODES: { title: 'Too many codes', body: 'Wait 15 minutes before asking for another SMS code.' },
  WRONG_CODE: { title: 'That code is not right', body: 'Check the SMS and try again.' },
  CODE_EXPIRED: { title: 'Code expired', body: 'Codes last 5 minutes. Go back and ask for a new one.' },
  TOO_MANY_ATTEMPTS: { title: 'Too many tries', body: 'Go back and ask for a new SMS code.' },
  WRONG_PIN: { title: 'Wrong PIN', body: 'Try again. After 5 wrong tries the PIN locks for 30 minutes.' },
  PIN_LOCKED: { title: 'PIN locked', body: 'Too many wrong tries. Sign in with your number and ID, or wait 30 minutes.' },
  DEVICE_NOT_VERIFIED: { title: 'Verify this phone first', body: 'Sign in once with your number and ID. After that you can use your PIN here.' },
  NO_SAVED_ACCOUNT: { title: 'Sign in first', body: 'Sign in with your number and ID once. Then your PIN and Face ID work on this phone.' },
  ALREADY_REGISTERED: { title: 'You already have an account', body: 'That number or ID is already registered. Log in instead.' },
  BAD_ID: { title: 'Check your ID number', body: 'That is not a valid South African ID number.' },
  BAD_PHONE: { title: 'Check your number', body: 'Enter the 9 digits after +27, without the leading 0.' },
  WEAK_PIN: { title: 'Pick a harder PIN', body: 'Avoid 1234, 0000 and other easy patterns.' },
  CONSENT_REQUIRED: { title: 'Tick both boxes', body: 'We need both before we can open your account.' },
  // applications / loans
  ACCOUNT_NOT_APPROVED: { title: 'Account not approved yet', body: 'You can apply once our team has approved your account.' },
  TERM_LOCKED: { title: 'One-month loans for now', body: 'Longer terms unlock when you reach a 5-star rating.' },
  AMOUNT_OUT_OF_RANGE: { title: 'Choose another amount', body: 'Quik1 lends from R500 to R8 000.' },
  ABOVE_LIMIT: { title: 'Above your limit', body: 'That is more than you can draw right now.' },
  STATEMENTS_REQUIRED: { title: 'Statements needed', body: 'Your bank statement must pass verification before payout.' },
  PROOF_REQUIRED: { title: 'Proof of income needed', body: 'Upload your proof of income before payout.' },
  ID_REQUIRED: { title: 'ID needed', body: 'Capture your ID document before payout.' },
  OFFER_EXPIRED: { title: 'Offer expired', body: 'Offers last 24 hours. Apply again for a fresh decision.' },
  NETWORK: { title: 'No connection', body: 'Check your data or Wi-Fi and try again.' },
};

export function notice(e: unknown): Notice {
  const code = e instanceof ApiError ? e.code : 'SERVER_ERROR';
  return NOTICES[code] ?? { title: 'Something went wrong', body: 'Please try again. If it keeps happening, message us in Help.' };
}

/** Postgres RAISE 'CODE' arrives as message "CODE". */
export function codeOf(message: string | undefined): string {
  const m = /^[A-Z_]+$/.exec((message ?? '').trim());
  return m ? m[0] : 'SERVER_ERROR';
}
