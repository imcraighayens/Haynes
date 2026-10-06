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

// Real, active clients — the borrowers with loans currently on the street.
const clients: Client[] = [
  { id: 'c1', name: 'Lovuyo Khoza', phone: '+27 82 145 9920', email: 'lovuyo.k@mail.com', idNumber: '9001125...', address: 'Soweto, JHB', createdAt: '2025-11-02' },
  { id: 'c2', name: 'Keabetswe Moatshe', phone: '+27 73 882 1140', email: 'kea.m@mail.com', address: 'Pretoria North', createdAt: '2025-11-14' },
  { id: 'c4', name: 'Viginia Morola', phone: '+27 81 220 4456', email: 'v.morola@mail.com', address: 'Tembisa', createdAt: '2025-10-20' },
  { id: 'c5', name: 'Nkele Moagi', phone: '+27 72 551 0098', email: 'nkele.m@mail.com', address: 'Katlehong', createdAt: '2026-01-09' },
  { id: 'c6', name: 'Nokuthula Patricia Montsho', phone: '+27 83 410 7765', email: 'patricia.m@mail.com', address: 'Vosloorus', createdAt: '2026-01-18' },
]

// The six real issued loans (mirrors the live dashboard).
const loans: Loan[] = [
  loan('l1', 'Lovuyo Khoza', 'c1', 12000, 'issued', '2026-05-26', '2026-06-25'),
  loan('l2', 'Keabetswe Moatshe', 'c2', 9000, 'issued', '2026-05-31', '2026-06-30'),
  loan('l4', 'Viginia Morola', 'c4', 2000, 'issued', '2026-05-31', '2026-06-30'),
  loan('l5', 'Viginia Morola', 'c4', 5000, 'issued', '2026-05-16', '2026-06-15'),
  loan('l6', 'Nkele Moagi', 'c5', 4000, 'issued', '2026-05-26', '2026-06-25'),
  loan('l7', 'Nokuthula Patricia Montsho', 'c6', 3000, 'issued', '2026-05-26', '2026-06-25'),
]

function buildLedger(loans: Loan[]): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    { id: 'led-cap1', date: '2025-10-01', type: 'capital', description: 'Initial capital injection', amount: 50000, reference: 'CAP-001' },
    { id: 'led-pc1', date: '2026-05-10', type: 'petty_cash', description: 'Office airtime & data', amount: -350, reference: 'PC-014' },
    { id: 'led-pc2', date: '2026-05-22', type: 'petty_cash', description: 'Transport — client visit', amount: -220, reference: 'PC-015' },
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
  { id: 'log4', date: '2026-05-26T11:22:00', actor: 'Ecoloan Dev', action: 'Loan issued', detail: 'Issued R12,000 to Lovuyo Khoza' },
  { id: 'log5', date: '2026-05-22T16:10:00', actor: 'Ecoloan Dev', action: 'Petty cash', detail: 'Logged R220 transport expense' },
]

const team: TeamMember[] = [
  { id: 't1', name: 'Ecoloan Dev', email: 'ecoakcess@mail.com', role: 'admin', active: true },
  { id: 't2', name: 'Naledi Mthembu', email: 'naledi@evolt.co.za', role: 'manager', active: true },
  { id: 't3', name: 'Kabelo Pretorius', email: 'kabelo@evolt.co.za', role: 'agent', active: true },
  { id: 't5', name: 'Auditor (read-only)', email: 'audit@evolt.co.za', role: 'viewer', active: true },
]

export const seedData: DashboardData = {
  clients,
  loans,
  ledger: buildLedger(loans),
  logs,
  team,
}
