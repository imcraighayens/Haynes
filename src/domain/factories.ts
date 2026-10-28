import type { Client, Loan, Settings } from './types'
import { addYears } from './internal'
import { todayIso, uid } from './format'

export const DEFAULT_CLAUSES = [
  'The client acknowledges the affordability assessment conducted at issue.',
  'The client agrees to the stated return rate of {rate} per advance.',
  'The client authorises a debit-order mandate on the account provided.',
  'On default, the agreed collections process applies.',
  'This agreement is signed once and reused for every subsequent advance.',
]

export const DEFAULT_SETTINGS: Settings = {
  orgName: 'Ecoloans',
  orgLegalName: 'Ecoloans (Pty) Ltd',
  ncrRegNo: 'NCRCP18811',
  companyRegNo: '2023/848161/07',
  tagline: 'Personal & business loans',
  address: '4533 Ext 7 East, Jouberton, Klerksdorp, 2574',
  contactEmail: 'info@ecoloan.co.za',
  contactPhone: '+27 79 101 0243',
  website: 'ecoloan.co.za',
  defaultReturnRatePct: 35,
  defaultCollectionFee: 0,
  protectionFee: 241.25,
  bankOpeningBalance: null,
  bankOpeningAt: null,
  maskPii: true,
  contractIntro:
    'This Master Credit Agreement is entered into between {org} and {client} (ID {id}). It governs all present and future loan advances to the client; individual advances are captured per transaction under the terms signed here.',
  contractClauses: DEFAULT_CLAUSES,
}

export function blankClient(patch: Partial<Client> = {}): Client {
  const created = patch.createdAt ?? new Date().toISOString()
  return {
    id: uid('c_'),
    ref: '',
    name: '',
    idNumber: null,
    dob: null,
    email: null,
    phone: null,
    address: null,
    city: null,
    province: null,
    employment: null,
    employer: null,
    jobTitle: null,
    tenure: null,
    netSalary: 0,
    grossSalary: 0,
    otherIncome: 0,
    expenses: { rent: 0, transport: 0, groceries: 0, otherDebt: 0, other: 0 },
    bank: null,
    branchCode: null,
    accountNo: null,
    accountType: null,
    officerId: null,
    score: 0,
    blocked: false,
    contract: { no: '', signedOn: null, signature: null },
    createdAt: created,
    createdBy: null,
    retainUntil: addYears(created.slice(0, 10), 5),
    deletedAt: null,
    ...patch,
  }
}

export function blankLoan(patch: Partial<Loan> = {}): Loan {
  return {
    id: uid('l_'),
    ref: '',
    clientId: '',
    applicationId: null,
    principal: 0,
    principalDerived: false,
    returnRatePct: 35,
    instalmentAmount: 0,
    collectionFee: 0,
    schedule: [todayIso()],
    instalmentsPaid: 0,
    priorInstalments: 0,
    status: 'issued',
    statusAt: null,
    mandateId: null,
    contractRef: null,
    paidDates: [],
    purpose: 'Personal',
    issuedOn: todayIso(),
    issuedBy: null,
    officerId: null,
    createdAt: new Date().toISOString(),
    writtenOffAt: null,
    writeOffReason: null,
    deletedAt: null,
    ...patch,
  }
}

export const expensesTotal = (c: Client) =>
  c.expenses.rent + c.expenses.transport + c.expenses.groceries + c.expenses.otherDebt + c.expenses.other

export function contractNo(index: number) {
  return `MC-${String(31 + index).padStart(4, '0')}`
}

/** Fill {org} {client} {id} {rate} placeholders in contract text. */
export function fillContract(s: string, v: { org: string; client: string; id: string; rate: string }) {
  return s.split('{org}').join(v.org).split('{client}').join(v.client).split('{id}').join(v.id).split('{rate}').join(v.rate)
}
