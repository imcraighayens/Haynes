import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Client, DashboardData, LedgerEntry, Loan, LogEntry } from '../data/types'
import { loadLocal, saveLocal, resetLocal, loadRemote, usingRemote } from '../data/store'
import { useToast } from './ToastContext'

interface NewLoanInput {
  clientId: string
  amount: number
  interestRate: number
  issuedDate: string
  dueDate: string
}

interface NewClientInput {
  name: string
  phone: string
  email?: string
  idNumber?: string
  address?: string
}

interface PettyCashInput {
  description: string
  amount: number
  date: string
}

interface DataCtx {
  data: DashboardData
  remote: boolean
  addClient: (input: NewClientInput) => Client
  addLoan: (input: NewLoanInput) => Loan
  markLoanPaid: (loanId: string) => void
  deleteLoan: (loanId: string) => void
  logPettyCash: (input: PettyCashInput) => void
  reset: () => void
}

const Ctx = createContext<DataCtx | null>(null)

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function recomputeLoanStatuses(loans: Loan[]): Loan[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return loans.map((l) => {
    if (l.status === 'paid') return l
    const due = new Date(l.dueDate)
    due.setHours(0, 0, 0, 0)
    let status: Loan['status'] = 'issued'
    if (due.getTime() === today.getTime()) status = 'due_today'
    else if (due.getTime() < today.getTime()) status = 'overdue'
    return { ...l, status }
  })
}

export function DataProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [data, setData] = useState<DashboardData>(() => {
    const local = loadLocal()
    return { ...local, loans: recomputeLoanStatuses(local.loans) }
  })

  // Hydrate from Supabase if configured.
  useEffect(() => {
    if (!usingRemote) return
    loadRemote().then((remote) => {
      if (remote) setData({ ...remote, loans: recomputeLoanStatuses(remote.loans) })
    })
  }, [])

  // Persist to local store on every change (offline mode).
  useEffect(() => {
    if (!usingRemote) saveLocal(data)
  }, [data])

  function pushLog(action: string, detail: string): LogEntry {
    return {
      id: uid('log'),
      date: new Date().toISOString(),
      actor: 'Ecoloan Dev',
      action,
      detail,
    }
  }

  const addClient: DataCtx['addClient'] = (input) => {
    const client: Client = {
      id: uid('c'),
      name: input.name,
      phone: input.phone,
      email: input.email,
      idNumber: input.idNumber,
      address: input.address,
      createdAt: new Date().toISOString().slice(0, 10),
    }
    setData((d) => ({
      ...d,
      clients: [client, ...d.clients],
      logs: [pushLog('Client added', `Added new client ${client.name}`), ...d.logs],
    }))
    toast(`${client.name} added as a client`)
    return client
  }

  const addLoan: DataCtx['addLoan'] = (input) => {
    const client = data.clients.find((c) => c.id === input.clientId)
    const returnAmount = Math.round(input.amount * (1 + input.interestRate) * 100) / 100
    const loan: Loan = {
      id: uid('l'),
      clientId: input.clientId,
      clientName: client?.name ?? 'Unknown',
      amount: input.amount,
      interestRate: input.interestRate,
      returnAmount,
      status: 'issued',
      issuedDate: input.issuedDate,
      dueDate: input.dueDate,
    }
    const ledgerEntry: LedgerEntry = {
      id: uid('led'),
      date: input.issuedDate,
      type: 'loan_out',
      description: `Loan disbursed — ${loan.clientName}`,
      amount: -loan.amount,
      reference: loan.id.toUpperCase(),
    }
    setData((d) => ({
      ...d,
      loans: recomputeLoanStatuses([loan, ...d.loans]),
      ledger: [ledgerEntry, ...d.ledger],
      logs: [pushLog('Loan issued', `Issued R${loan.amount.toLocaleString()} to ${loan.clientName}`), ...d.logs],
    }))
    toast(`Loan of R${loan.amount.toLocaleString()} issued to ${loan.clientName}`)
    return loan
  }

  const markLoanPaid: DataCtx['markLoanPaid'] = (loanId) => {
    const target = data.loans.find((l) => l.id === loanId)
    if (target && target.status !== 'paid') {
      toast(`${target.clientName}'s loan marked as paid · R${target.returnAmount.toLocaleString()} collected`)
    }
    setData((d) => {
      const loan = d.loans.find((l) => l.id === loanId)
      if (!loan || loan.status === 'paid') return d
      const paidDate = new Date().toISOString().slice(0, 10)
      const ledgerEntry: LedgerEntry = {
        id: uid('led'),
        date: paidDate,
        type: 'repayment',
        description: `Repayment received — ${loan.clientName}`,
        amount: loan.returnAmount,
        reference: loan.id.toUpperCase(),
      }
      return {
        ...d,
        loans: d.loans.map((l) => (l.id === loanId ? { ...l, status: 'paid', paidDate } : l)),
        ledger: [ledgerEntry, ...d.ledger],
        logs: [pushLog('Repayment', `${loan.clientName} repaid R${loan.returnAmount.toLocaleString()}`), ...d.logs],
      }
    })
  }

  const deleteLoan: DataCtx['deleteLoan'] = (loanId) => {
    setData((d) => {
      const loan = d.loans.find((l) => l.id === loanId)
      return {
        ...d,
        loans: d.loans.filter((l) => l.id !== loanId),
        logs: loan ? [pushLog('Loan deleted', `Removed loan for ${loan.clientName}`), ...d.logs] : d.logs,
      }
    })
    toast('Loan deleted', 'info')
  }

  const logPettyCash: DataCtx['logPettyCash'] = (input) => {
    const entry: LedgerEntry = {
      id: uid('led'),
      date: input.date,
      type: 'petty_cash',
      description: input.description,
      amount: -Math.abs(input.amount),
      reference: uid('PC').toUpperCase(),
    }
    setData((d) => ({
      ...d,
      ledger: [entry, ...d.ledger],
      logs: [pushLog('Petty cash', `Logged R${Math.abs(input.amount).toLocaleString()} — ${input.description}`), ...d.logs],
    }))
    toast(`Petty cash logged · R${Math.abs(input.amount).toLocaleString()}`)
  }

  const reset: DataCtx['reset'] = () => {
    const fresh = resetLocal()
    setData({ ...fresh, loans: recomputeLoanStatuses(fresh.loans) })
    toast('Demo data reset to sample set', 'info')
  }

  const value = useMemo<DataCtx>(
    () => ({ data, remote: usingRemote, addClient, addLoan, markLoanPaid, deleteLoan, logPettyCash, reset }),
    [data],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}
