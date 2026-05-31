import type { DashboardData, Loan, Client, LedgerEntry, LogEntry, TeamMember } from './types'

const RATE = 0.35

function loan(
  id: string,
  clientName: string,
  clientId: string,
  amount: number,
  status: Loan['status'],
  issuedDate: string,
  dueDate: string,
  paidDate?: string,
): Loan {
  return {
    id,
    clientId,
    clientName,
    amount,
    interestRate: RATE,
    returnAmount: Math.round(amount * (1 + RATE) * 100) / 100,
    status,
    issuedDate,
    dueDate,
    paidDate,
  }
}

const clients: Client[] = [
  { id: 'c1', name: 'Lovuyo Khoza', phone: '+27 82 145 9920', email: 'lovuyo.k@mail.com', idNumber: '9001125...', address: 'Soweto, JHB', createdAt: '2025-11-02' },
  { id: 'c2', name: 'Keabetswe Moatshe', phone: '+27 73 882 1140', email: 'kea.m@mail.com', address: 'Pretoria North', createdAt: '2025-11-14' },
  { id: 'c3', name: 'Ntobifuthi Cynthia Modise', phone: '+27 60 992 7781', email: 'cynthia.m@mail.com', address: 'Mamelodi', createdAt: '2025-12-01' },
  { id: 'c4', name: 'Viginia Morola', phone: '+27 81 220 4456', email: 'v.morola@mail.com', address: 'Tembisa', createdAt: '2025-10-20' },
  { id: 'c5', name: 'Nkele Moagi', phone: '+27 72 551 0098', email: 'nkele.m@mail.com', address: 'Katlehong', createdAt: '2026-01-09' },
  { id: 'c6', name: 'Nokuthula Patricia Montsho', phone: '+27 83 410 7765', email: 'patricia.m@mail.com', address: 'Vosloorus', createdAt: '2026-01-18' },
  { id: 'c7', name: 'Thabo Mahlangu', phone: '+27 79 330 2211', email: 'thabo.m@mail.com', address: 'Daveyton', createdAt: '2026-02-02' },
  { id: 'c8', name: 'Refilwe Sithole', phone: '+27 84 778 9012', email: 'refilwe.s@mail.com', address: 'Alexandra', createdAt: '2026-02-21' },
  { id: 'c9', name: 'Sipho Dlamini', phone: '+27 71 009 5533', email: 'sipho.d@mail.com', address: 'Soweto, JHB', createdAt: '2026-03-04' },
  { id: 'c10', name: 'Lerato Khumalo', phone: '+27 82 661 7788', email: 'lerato.k@mail.com', address: 'Midrand', createdAt: '2026-03-15' },
  { id: 'c11', name: 'Bongani Ndlovu', phone: '+27 76 223 4490', email: 'bongani.n@mail.com', address: 'Springs', createdAt: '2026-04-01' },
  { id: 'c12', name: 'Palesa Mokoena', phone: '+27 83 990 1102', email: 'palesa.m@mail.com', address: 'Benoni', createdAt: '2026-04-19' },
  { id: 'c13', name: 'Andile Zulu', phone: '+27 74 556 6677', email: 'andile.z@mail.com', address: 'Kempton Park', createdAt: '2026-05-06' },
]

const loans: Loan[] = [
  loan('l1', 'Lovuyo Khoza', 'c1', 12000, 'issued', '2026-05-26', '2026-06-25'),
  loan('l2', 'Keabetswe Moatshe', 'c2', 9000, 'issued', '2026-05-31', '2026-06-30'),
  loan('l3', 'Ntobifuthi Cynthia Modise', 'c3', 1350, 'paid', '2026-04-29', '2026-05-29', '2026-05-27'),
  loan('l4', 'Viginia Morola', 'c4', 2000, 'issued', '2026-05-31', '2026-06-30'),
  loan('l5', 'Viginia Morola', 'c4', 5000, 'issued', '2026-05-16', '2026-06-15'),
  loan('l6', 'Nkele Moagi', 'c5', 4000, 'issued', '2026-05-26', '2026-06-25'),
  loan('l7', 'Nokuthula Patricia Montsho', 'c6', 3000, 'issued', '2026-05-26', '2026-06-25'),
  loan('l8', 'Viginia Morola', 'c4', 2700, 'paid', '2026-03-16', '2026-04-15', '2026-04-12'),
  loan('l9', 'Lovuyo Khoza', 'c1', 10000, 'paid', '2026-01-26', '2026-02-25', '2026-02-24'),
  loan('l10', 'Viginia Morola', 'c4', 3000, 'paid', '2026-01-16', '2026-02-15', '2026-02-14'),
  loan('l11', 'Thabo Mahlangu', 'c7', 6000, 'paid', '2026-02-10', '2026-03-12', '2026-03-10'),
  loan('l12', 'Refilwe Sithole', 'c8', 4500, 'paid', '2026-03-01', '2026-03-31', '2026-03-29'),
  loan('l13', 'Sipho Dlamini', 'c9', 8000, 'paid', '2026-03-12', '2026-04-11', '2026-04-08'),
  loan('l14', 'Lerato Khumalo', 'c10', 2500, 'paid', '2026-03-22', '2026-04-21', '2026-04-20'),
  loan('l15', 'Bongani Ndlovu', 'c11', 7000, 'paid', '2026-04-05', '2026-05-05', '2026-05-03'),
  loan('l16', 'Palesa Mokoena', 'c12', 3500, 'paid', '2026-04-19', '2026-05-19', '2026-05-18'),
  loan('l17', 'Andile Zulu', 'c13', 5500, 'paid', '2026-01-10', '2026-02-09', '2026-02-07'),
  loan('l18', 'Thabo Mahlangu', 'c7', 4000, 'paid', '2025-12-15', '2026-01-14', '2026-01-13'),
  loan('l19', 'Sipho Dlamini', 'c9', 6500, 'paid', '2025-12-20', '2026-01-19', '2026-01-18'),
  loan('l20', 'Lerato Khumalo', 'c10', 3000, 'paid', '2026-02-22', '2026-03-24', '2026-03-22'),
]

function buildLedger(loans: Loan[]): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    { id: 'led-cap1', date: '2025-10-01', type: 'capital', description: 'Initial capital injection', amount: 50000, reference: 'CAP-001' },
    { id: 'led-pc1', date: '2026-05-10', type: 'petty_cash', description: 'Office airtime & data', amount: -350, reference: 'PC-014' },
    { id: 'led-pc2', date: '2026-05-22', type: 'petty_cash', description: 'Transport — client visit', amount: -220, reference: 'PC-015' },
    { id: 'led-exp1', date: '2026-05-05', type: 'expense', description: 'FlutterFlow subscription', amount: -1200, reference: 'EXP-009' },
  ]
  loans.forEach((l) => {
    entries.push({
      id: `led-out-${l.id}`,
      date: l.issuedDate,
      type: 'loan_out',
      description: `Loan disbursed — ${l.clientName}`,
      amount: -l.amount,
      reference: l.id.toUpperCase(),
    })
    if (l.status === 'paid' && l.paidDate) {
      entries.push({
        id: `led-in-${l.id}`,
        date: l.paidDate,
        type: 'repayment',
        description: `Repayment received — ${l.clientName}`,
        amount: l.returnAmount,
        reference: l.id.toUpperCase(),
      })
    }
  })
  return entries.sort((a, b) => (a.date < b.date ? 1 : -1))
}

const logs: LogEntry[] = [
  { id: 'log1', date: '2026-05-31T09:12:00', actor: 'Ecoloan Dev', action: 'Loan issued', detail: 'Issued R9,000 to Keabetswe Moatshe' },
  { id: 'log2', date: '2026-05-31T08:40:00', actor: 'Ecoloan Dev', action: 'Loan issued', detail: 'Issued R2,000 to Viginia Morola' },
  { id: 'log3', date: '2026-05-27T14:05:00', actor: 'Ecoloan Dev', action: 'Repayment', detail: 'Ntobifuthi Cynthia Modise repaid R1,822.50' },
  { id: 'log4', date: '2026-05-26T11:22:00', actor: 'Ecoloan Dev', action: 'Loan issued', detail: 'Issued R12,000 to Lovuyo Khoza' },
  { id: 'log5', date: '2026-05-22T16:10:00', actor: 'Ecoloan Dev', action: 'Petty cash', detail: 'Logged R220 transport expense' },
  { id: 'log6', date: '2026-05-18T10:00:00', actor: 'Ecoloan Dev', action: 'Repayment', detail: 'Palesa Mokoena repaid R4,725.00' },
]

const team: TeamMember[] = [
  { id: 't1', name: 'Ecoloan Dev', email: 'ecoakcess@mail.com', role: 'admin', active: true },
  { id: 't2', name: 'Naledi Mthembu', email: 'naledi@evolt.co.za', role: 'manager', active: true },
  { id: 't3', name: 'Kabelo Pretorius', email: 'kabelo@evolt.co.za', role: 'agent', active: true },
  { id: 't4', name: 'Zinhle Ncube', email: 'zinhle@evolt.co.za', role: 'agent', active: false },
  { id: 't5', name: 'Auditor (read-only)', email: 'audit@evolt.co.za', role: 'viewer', active: true },
]

export const seedData: DashboardData = {
  clients,
  loans,
  ledger: buildLedger(loans),
  logs,
  team,
}
