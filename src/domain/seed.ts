import type { Application, Book, Client, Employee, Expense, Loan, LogEntry, PettyEntry } from './types'
import { blankClient, blankLoan, contractNo, DEFAULT_SETTINGS } from './factories'
import { addDays, addMonths, round2, todayIso } from './format'
import { buildSchedule, instalmentFor, normalizeLoan } from './loans'

/**
 * SYNTHETIC demo book. Every borrower, ID number and bank account below is
 * fictional: ID numbers start with 000000 (no valid birth date) and accounts
 * with 0000. Real borrower data never lives in this repository; load it via
 * Ledger › Data › Import (prototype book) or the NuPay bank-report import.
 *
 * Dates are generated relative to today so the dashboard always has
 * something due today, something overdue and something coming up.
 */
export function buildSeed(today = todayIso()): Book {
  const d = (n: number) => addDays(today, n)
  const at = (n: number) => `${d(n)}T08:00:00.000Z`

  const employees: Employee[] = [
    { id: 'e1', name: 'Craig Moatshe', email: 'craig@ecoloans.co.za', role: 'admin', active: true, approvalLimit: 50000, createdAt: at(-360) },
    { id: 'e2', name: 'Lerato Demo', email: 'lerato@example.com', role: 'agent', active: true, approvalLimit: 8000, createdAt: at(-345) },
    { id: 'e3', name: 'Sipho Demo', email: 'sipho@example.com', role: 'collections', active: true, approvalLimit: 0, createdAt: at(-200) },
  ]

  const people: [string, string, string, string, number, string, string][] = [
    // name, city, province, employer, net salary, bank, officer
    ['Thando Mokoena', 'Soweto', 'Gauteng', 'City Power', 14200, 'Capitec Bank', 'e2'],
    ['Ayanda Khumalo', 'Klerksdorp', 'North West', 'Department of Health', 18900, 'First National Bank (FNB)', 'e2'],
    ['Naledi Mahlangu', 'Midrand', 'Gauteng', 'Netcare', 22500, 'Standard Bank', 'e1'],
    ['Bongani Ndlovu', 'Rustenburg', 'North West', 'Platinum Mine Co', 16800, 'Capitec Bank', 'e2'],
    ['Zanele Mthembu', 'Tembisa', 'Gauteng', 'Gauteng Education', 15400, 'Absa', 'e1'],
    ['Kagiso Molefe', 'Mahikeng', 'North West', 'SAPS', 19800, 'Nedbank', 'e2'],
    ['Lindiwe Zulu', 'Katlehong', 'Gauteng', 'Shoprite', 9800, 'TymeBank', 'e1'],
    ['Pule Sekgobela', 'Pretoria North', 'Gauteng', 'Transnet', 24100, 'First National Bank (FNB)', 'e2'],
    ['Mpho Radebe', 'Vosloorus', 'Gauteng', 'Metro Police', 17300, 'Capitec Bank', 'e1'],
    ['Refilwe Tau', 'Potchefstroom', 'North West', 'North-West University', 20700, 'Standard Bank', 'e2'],
    ['Sibusiso Dube', 'Marikana', 'North West', 'Platinum Mine Co', 15900, 'African Bank', 'e1'],
    ['Nomsa Khoza', 'Kempton Park', 'Gauteng', 'OR Tambo Intl', 13100, 'Capitec Bank', 'e2'],
  ]

  const clients: Client[] = people.map(([name, city, province, employer, net, bank, officer], i) =>
    blankClient({
      id: `c${i + 1}`,
      ref: `EC-0${10 + i}`,
      name,
      idNumber: `000000${String(5000000 + i * 1371).slice(0, 7)}`,
      dob: null,
      email: `${name.split(' ')[0].toLowerCase()}@example.com`,
      phone: `060000${String(1000 + i * 37).padStart(4, '0')}`,
      address: `${10 + i * 7} Demo Street`,
      city,
      province,
      employment: 'Full-time',
      employer,
      jobTitle: ['Clerk', 'Staff Nurse', 'Developer', 'Artisan', 'Teacher', 'Constable'][i % 6],
      tenure: `${2 + (i % 7)} years`,
      netSalary: net,
      grossSalary: round2(net * 1.28),
      expenses: { rent: 3500 + (i % 4) * 500, transport: 1200, groceries: 2800, otherDebt: (i % 3) * 600, other: 500 },
      bank,
      branchCode: '470010',
      accountNo: `0000${String(410000 + i * 913)}`,
      accountType: i % 3 ? 'Savings Account' : 'Cheque Account',
      officerId: officer,
      score: [0, 30, 55, 72, 40, 65][i % 6],
      contract: { no: contractNo(i), signedOn: d(-300 + i * 20), signature: null },
      createdAt: at(-330 + i * 22),
      createdBy: officer === 'e1' ? 'Craig Moatshe' : 'Lerato Demo',
    }),
  )

  let seq = 70
  const mk = (clientId: string, principal: number, n: number, firstDue: number, opts: Partial<Loan> = {}): Loan => {
    const first = d(firstDue)
    const issued = addMonths(first, -1)
    return normalizeLoan(
      blankLoan({
        id: `l${seq}`,
        ref: `ECL-${String(seq++).padStart(3, '0')}`,
        clientId,
        principal,
        returnRatePct: 35,
        instalmentAmount: instalmentFor(principal, 35, n),
        schedule: buildSchedule(first, n),
        issuedOn: issued,
        createdAt: `${issued}T09:00:00.000Z`,
        statusAt: `${issued}T09:00:00.000Z`,
        issuedBy: 'Craig Moatshe',
        ...opts,
      }),
    )
  }

  const loans: Loan[] = [
    // settled history
    mk('c1', 4000, 1, -150, { instalmentsPaid: 1, statusAt: at(-150) }),
    mk('c2', 6000, 1, -120, { instalmentsPaid: 1, statusAt: at(-120) }),
    mk('c3', 3000, 1, -95, { instalmentsPaid: 1, statusAt: at(-95) }),
    mk('c5', 2500, 1, -70, { instalmentsPaid: 1, statusAt: at(-70) }),
    mk('c8', 8000, 2, -90, { instalmentsPaid: 2, statusAt: at(-60) }),
    mk('c1', 5000, 1, -40, { instalmentsPaid: 1, statusAt: at(-40) }),
    // open: due today
    mk('c2', 3000, 1, 0),
    mk('c4', 2000, 3, -61, { instalmentsPaid: 2, statusAt: at(-30) }),
    // open: past due, nobody updated (stale)
    mk('c6', 4500, 1, -9),
    mk('c7', 1500, 2, -40, { instalmentsPaid: 0 }),
    // open: marked overdue
    mk('c9', 6000, 1, -25, { status: 'overdue', statusAt: at(-20) }),
    // open: upcoming
    mk('c3', 7000, 2, 12),
    mk('c5', 3500, 6, -45, { instalmentsPaid: 2, statusAt: at(-14) }),
    mk('c10', 9000, 3, 20),
    mk('c11', 2000, 1, 5),
    mk('c12', 1200, 1, 28),
    // written off
    mk('c11', 1800, 1, -200, { status: 'written_off', writtenOffAt: at(-100), writeOffReason: 'Absconded — debit order stopped' }),
  ]

  // A loan picked up from a NuPay debit-order report: fixed debit incl. collection fee, principal not recorded.
  const bankFirst = d(-31)
  loans.push(
    normalizeLoan(
      blankLoan({
        id: 'lf1',
        ref: 'ECL-F01',
        clientId: 'c8',
        principal: null,
        principalDerived: true,
        returnRatePct: 35,
        instalmentAmount: 4666,
        collectionFee: 104.23,
        schedule: buildSchedule(bankFirst, 6),
        instalmentsPaid: 1,
        priorInstalments: 0,
        mandateId: '0000771234',
        issuedOn: addMonths(bankFirst, -1),
        createdAt: `${addMonths(bankFirst, -1)}T09:00:00.000Z`,
        statusAt: at(-30),
      }),
    ),
  )

  const logbook: LogEntry[] = loans
    .slice()
    .reverse()
    .map((l, i) => ({
      id: `g${i}`,
      at: l.createdAt,
      type: 'LOAN ISSUED',
      ref: l.ref,
      customer: clients.find((c) => c.id === l.clientId)?.name ?? '—',
      amount: l.principal ?? 0,
      by: l.issuedBy ?? 'Craig Moatshe',
      comment: `${l.schedule.length} instalment${l.schedule.length > 1 ? 's' : ''} · demo data`,
    }))
    .sort((a, b) => b.at.localeCompare(a.at))

  const petty: PettyEntry[] = [
    { id: 'p1', date: d(-12), amount: 350, category: 'travel', purpose: 'Fuel — client visits Klerksdorp', borrower: 'Lerato Demo', notes: '', status: 'APPROVED', by: 'Craig Moatshe', createdAt: at(-12) },
    { id: 'p2', date: d(-6), amount: 120, category: 'airtime', purpose: 'Collections airtime', borrower: 'Sipho Demo', notes: '', status: 'REPAID', by: 'Craig Moatshe', createdAt: at(-6) },
    { id: 'p3', date: d(-2), amount: 210, category: 'office', purpose: 'Printer paper & toner', borrower: '', notes: '', status: 'PENDING', by: 'Lerato Demo', createdAt: at(-2) },
  ]

  const expenses: Expense[] = [
    { id: 'x1', name: 'Office rent', amount: 4500, deletedAt: null },
    { id: 'x2', name: 'Debit-order platform', amount: 650, deletedAt: null },
    { id: 'x3', name: 'Data & airtime', amount: 400, deletedAt: null },
  ]

  const applications: Application[] = [
    {
      id: 'a1', ref: 'APP-1001', clientId: null, name: 'Palesa Demo', phone: '0600009911', email: 'palesa@example.com',
      idNumber: '0000009876543', employer: 'Clicks', jobTitle: 'Pharmacy assistant', netIncome: 12800, bank: 'Capitec Bank',
      amount: 2500, termMonths: 2, purpose: 'School fees', source: 'Walk-in', status: 'new', declineReason: null,
      decidedBy: null, decidedAt: null, loanId: null, createdAt: at(-1),
    },
    {
      id: 'a2', ref: 'APP-1002', clientId: 'c4', name: 'Bongani Ndlovu', phone: clients[3].phone, email: clients[3].email,
      idNumber: clients[3].idNumber, employer: clients[3].employer, jobTitle: clients[3].jobTitle, netIncome: 16800,
      bank: clients[3].bank, amount: 6000, termMonths: 3, purpose: 'Car repairs', source: 'Phone', status: 'reviewing',
      declineReason: null, decidedBy: null, decidedAt: null, loanId: null, createdAt: at(-3),
    },
  ]

  return {
    clients,
    loans,
    applications,
    logbook,
    petty,
    expenses,
    bankTx: [],
    employees,
    settings: { ...DEFAULT_SETTINGS, ncrRegNo: 'NCRCP-DEMO' },
  }
}
