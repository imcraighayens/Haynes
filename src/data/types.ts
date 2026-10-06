export type LoanStatus = 'issued' | 'paid' | 'overdue' | 'due_today'

export interface Client {
  id: string
  name: string
  phone: string
  email?: string
  idNumber?: string
  address?: string
  createdAt: string
  /** active = has at least one outstanding loan */
  notes?: string
}

export interface Loan {
  id: string
  clientId: string
  clientName: string
  /** principal amount loaned out */
  amount: number
  /** interest rate as a fraction, e.g. 0.35 for 35% */
  interestRate: number
  /** amount expected back = amount * (1 + interestRate) */
  returnAmount: number
  status: LoanStatus
  issuedDate: string
  dueDate: string
  paidDate?: string
}

export type LedgerType = 'loan_out' | 'repayment' | 'petty_cash' | 'capital' | 'expense'

export interface LedgerEntry {
  id: string
  date: string
  type: LedgerType
  description: string
  /** positive = money in, negative = money out */
  amount: number
  reference?: string
}

export interface LogEntry {
  id: string
  date: string
  actor: string
  action: string
  detail: string
}

export type Role = 'admin' | 'manager' | 'agent' | 'viewer'

export interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  active: boolean
}

export interface DashboardData {
  clients: Client[]
  loans: Loan[]
  ledger: LedgerEntry[]
  logs: LogEntry[]
  team: TeamMember[]
}
