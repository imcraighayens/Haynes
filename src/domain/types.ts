/**
 * LEDGER domain model. Mirrors the prototype's ledjaa-db schema (v1.7) in
 * camelCase; the Supabase layer converts to snake_case columns.
 *
 * Dates are ISO strings: `YYYY-MM-DD` for calendar dates, full ISO for
 * timestamps. Money is plain numbers in ZAR, rounded to cents.
 */

export type Role = 'admin' | 'manager' | 'agent' | 'collections' | 'auditor'

export type LoanStatus = 'issued' | 'overdue' | 'paid' | 'settled_early' | 'written_off'

/** Status as shown in the UI, derived from the stored status + schedule + today. */
export type EffectiveStatus = 'issued' | 'duetoday' | 'overdue' | 'paid' | 'written_off'

export interface ClientExpenses {
  rent: number
  transport: number
  groceries: number
  otherDebt: number
  other: number
}

export interface ClientContract {
  /** Master credit agreement number, e.g. MC-0031 */
  no: string
  signedOn: string | null
  /** PNG data URL of the client's signature */
  signature: string | null
}

export interface Client {
  id: string
  /** Book reference, e.g. EC-032 */
  ref: string
  name: string
  idNumber: string | null
  dob: string | null
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  province: string | null
  employment: string | null
  employer: string | null
  jobTitle: string | null
  tenure: string | null
  netSalary: number
  grossSalary: number
  otherIncome: number
  expenses: ClientExpenses
  bank: string | null
  branchCode: string | null
  accountNo: string | null
  accountType: string | null
  officerId: string | null
  score: number
  blocked: boolean
  contract: ClientContract
  createdAt: string
  createdBy: string | null
  /** FICA / NCA retention: 5 years after last transaction */
  retainUntil: string | null
  deletedAt: string | null
}

export interface Loan {
  id: string
  /** Book reference, e.g. ECL-095 or ECL-F01 for bank-report loans */
  ref: string
  clientId: string
  applicationId: string | null
  /** Amount actually lent. null when not recorded (e.g. imported from a bank report). */
  principal: number | null
  /** True when principal was back-calculated from the instalment, not entered. */
  principalDerived: boolean
  /** Simple (not compound) return rate, e.g. 35 */
  returnRatePct: number
  /** Return per instalment (excludes the collection fee) */
  instalmentAmount: number
  /** Per-instalment collection fee passed to the client's debit (e.g. NuPay PIF). 0 for none. */
  collectionFee: number
  /** Every instalment date, earliest first (ISO) */
  schedule: string[]
  /** Instalments collected so far (index of the next one due) */
  instalmentsPaid: number
  /** Instalments that pre-date this schedule (bank-report loans picked up mid-way) */
  priorInstalments: number
  status: LoanStatus
  /** When the status was last set by a person or import */
  statusAt: string | null
  mandateId: string | null
  purpose: string
  issuedOn: string | null
  issuedBy: string | null
  officerId: string | null
  createdAt: string
  writtenOffAt: string | null
  writeOffReason: string | null
  deletedAt: string | null
}

export type ApplicationStatus = 'new' | 'reviewing' | 'approved' | 'declined'

export interface Application {
  id: string
  ref: string
  /** Set once matched or created */
  clientId: string | null
  name: string
  phone: string | null
  email: string | null
  idNumber: string | null
  employer: string | null
  jobTitle: string | null
  netIncome: number
  bank: string | null
  amount: number
  termMonths: number
  purpose: string
  source: string
  status: ApplicationStatus
  declineReason: string | null
  decidedBy: string | null
  decidedAt: string | null
  loanId: string | null
  createdAt: string
}

/** Activity logbook row — the audit trail. Append-only. */
export interface LogEntry {
  id: string
  at: string
  type: string
  ref: string
  customer: string
  amount: number
  by: string
  comment: string
}

export type PettyCategory = 'travel' | 'office' | 'airtime' | 'meals' | 'advance' | 'other'

export interface PettyEntry {
  id: string
  date: string
  amount: number
  category: PettyCategory
  purpose: string
  borrower: string
  notes: string
  /** Staff advances are tracked until repaid */
  status: PettyStatus
  by: string
  createdAt: string
}

export type PettyStatus = 'PENDING' | 'APPROVED' | 'REPAID' | 'DECLINED'

export interface Expense {
  id: string
  name: string
  /** Monthly amount */
  amount: number
  deletedAt: string | null
}

export interface BankTx {
  id: string
  at: string
  type: 'in' | 'out'
  amount: number
  ref: string
  label: string
  by: string
}

export interface Employee {
  id: string
  name: string
  email: string
  role: Role
  active: boolean
  /** Largest loan this user may approve; 0 = no approval authority */
  approvalLimit: number
  createdAt: string
}

export interface Settings {
  orgName: string
  orgLegalName: string
  ncrRegNo: string
  /** Default simple return rate for new loans */
  defaultReturnRatePct: number
  /** Default collection fee per debit instalment */
  defaultCollectionFee: number
  /** Monthly protection fee shown on settlement quotes (0 to omit) */
  protectionFee: number
  /** Opening bank balance and the timestamp it was set; transactions after it are added on. */
  bankOpeningBalance: number | null
  bankOpeningAt: string | null
  maskPii: boolean
  contractIntro: string
  contractClauses: string[]
}

export interface Book {
  clients: Client[]
  loans: Loan[]
  applications: Application[]
  logbook: LogEntry[]
  petty: PettyEntry[]
  expenses: Expense[]
  bankTx: BankTx[]
  employees: Employee[]
  settings: Settings
}

export type TableName = Exclude<keyof Book, 'settings'>
