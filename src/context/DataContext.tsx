import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Client, DashboardData, LedgerEntry, Loan, LogEntry } from '../data/types'
import { loadLocal, saveLocal, resetLocal, loadRemote, usingRemote } from '../data/store'
import {
  insertClient,
  insertLoan,
  updateLoan,
  deleteLoanRow,
  insertLedger,
  insertLog,
  deleteClientRows,
  deleteLoanRows,
} from '../data/repo'
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
  /** Remove all sample/paid history, keeping only real issued loans and their clients. */
  clearSampleData: () => void
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

  /** Run remote writes; on failure surface a toast (local state is already updated). */
  function syncRemote(work: () => Promise<void>, label: string) {
    if (!usingRemote) return
    work().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      toast(`${label} did not sync to the database: ${msg}`, 'error')
    })
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
    const log = pushLog('Client added', `Added new client ${client.name}`)
    setData((d) => ({
      ...d,
      clients: [client, ...d.clients],
      logs: [log, ...d.logs],
    }))
    toast(`${client.name} added as a client`)
    syncRemote(async () => {
      await insertClient(client)
      await insertLog(log)
    }, 'New client')
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
    const log = pushLog('Loan issued', `Issued R${loan.amount.toLocaleString()} to ${loan.clientName}`)
    setData((d) => ({
      ...d,
      loans: recomputeLoanStatuses([loan, ...d.loans]),
      ledger: [ledgerEntry, ...d.ledger],
      logs: [log, ...d.logs],
    }))
    toast(`Loan of R${loan.amount.toLocaleString()} issued to ${loan.clientName}`)
    syncRemote(async () => {
      await insertLoan(loan)
      await insertLedger(ledgerEntry)
      await insertLog(log)
    }, 'New loan')
    return loan
  }

  const markLoanPaid: DataCtx['markLoanPaid'] = (loanId) => {
    const target = data.loans.find((l) => l.id === loanId)
    if (!target || target.status === 'paid') return
    const paidDate = new Date().toISOString().slice(0, 10)
    const ledgerEntry: LedgerEntry = {
      id: uid('led'),
      date: paidDate,
      type: 'repayment',
      description: `Repayment received — ${target.clientName}`,
      amount: target.returnAmount,
      reference: target.id.toUpperCase(),
    }
    const log = pushLog('Repayment', `${target.clientName} repaid R${target.returnAmount.toLocaleString()}`)
    toast(`${target.clientName}'s loan marked as paid · R${target.returnAmount.toLocaleString()} collected`)
    setData((d) => ({
      ...d,
      loans: d.loans.map((l) => (l.id === loanId ? { ...l, status: 'paid', paidDate } : l)),
      ledger: [ledgerEntry, ...d.ledger],
      logs: [log, ...d.logs],
    }))
    syncRemote(async () => {
      await updateLoan(loanId, { status: 'paid', paidDate })
      await insertLedger(ledgerEntry)
      await insertLog(log)
    }, 'Repayment')
  }

  const deleteLoan: DataCtx['deleteLoan'] = (loanId) => {
    const loan = data.loans.find((l) => l.id === loanId)
    const log = loan ? pushLog('Loan deleted', `Removed loan for ${loan.clientName}`) : null
    setData((d) => ({
      ...d,
      loans: d.loans.filter((l) => l.id !== loanId),
      logs: log ? [log, ...d.logs] : d.logs,
    }))
    toast('Loan deleted', 'info')
    syncRemote(async () => {
      await deleteLoanRow(loanId)
      if (log) await insertLog(log)
    }, 'Loan deletion')
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
    const log = pushLog('Petty cash', `Logged R${Math.abs(input.amount).toLocaleString()} — ${input.description}`)
    setData((d) => ({
      ...d,
      ledger: [entry, ...d.ledger],
      logs: [log, ...d.logs],
    }))
    toast(`Petty cash logged · R${Math.abs(input.amount).toLocaleString()}`)
    syncRemote(async () => {
      await insertLedger(entry)
      await insertLog(log)
    }, 'Petty cash')
  }

  const reset: DataCtx['reset'] = () => {
    const fresh = resetLocal()
    setData({ ...fresh, loans: recomputeLoanStatuses(fresh.loans) })
    toast('Demo data reset to sample set', 'info')
  }

  const clearSampleData: DataCtx['clearSampleData'] = () => {
    // Keep only loans that are currently outstanding (issued / due today / overdue) —
    // these represent real, active money on the street. Drop the paid sample history.
    const realLoans = recomputeLoanStatuses(data.loans).filter((l) => l.status !== 'paid')
    const realLoanIds = new Set(realLoans.map((l) => l.id))
    const realClientIds = new Set(realLoans.map((l) => l.clientId))
    const removedLoanIds = data.loans.filter((l) => !realLoanIds.has(l.id)).map((l) => l.id)
    const removedClientIds = data.clients.filter((c) => !realClientIds.has(c.id)).map((c) => c.id)
    // Keep ledger entries only for surviving loans, plus capital/expense/petty-cash entries.
    const realRefs = new Set(realLoans.map((l) => l.id.toUpperCase()))
    const realLedger = data.ledger.filter(
      (e) =>
        (e.reference && realRefs.has(e.reference)) ||
        e.type === 'capital' ||
        e.type === 'expense' ||
        e.type === 'petty_cash',
    )
    const log = pushLog('Data cleanup', `Removed ${removedLoanIds.length} sample loan(s); kept ${realLoans.length} active`)
    setData((d) => ({
      ...d,
      loans: realLoans,
      clients: d.clients.filter((c) => realClientIds.has(c.id)),
      ledger: realLedger,
      logs: [log, ...d.logs],
    }))
    toast('Sample data cleared — only active loans remain', 'success')
    syncRemote(async () => {
      await deleteLoanRows(removedLoanIds)
      await deleteClientRows(removedClientIds)
      await insertLog(log)
    }, 'Data cleanup')
  }

  const value = useMemo<DataCtx>(
    () => ({ data, remote: usingRemote, addClient, addLoan, markLoanPaid, deleteLoan, logPettyCash, reset, clearSampleData }),
    [data],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}
