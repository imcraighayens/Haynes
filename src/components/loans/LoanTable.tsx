import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, MoreVertical, CheckCircle2, Trash2, Eye, Pencil, Download, ArrowUpDown } from 'lucide-react'
import { clsx } from 'clsx'
import type { Loan, LoanStatus } from '../../data/types'
import { useData } from '../../context/DataContext'
import { StatusBadge } from '../ui/Badge'
import { money, fmtDate, dueLabel } from '../../lib/format'
import { LoanDetailModal } from './LoanDetailModal'
import { NewLoanModal } from '../modals/NewLoanModal'
import { exportCsv } from '../../lib/csv'

type Tab = 'all' | LoanStatus
type SortKey = 'amount' | 'dueDate' | 'clientName'

export function LoanTable({ compact = false }: { compact?: boolean }) {
  const { data, markLoanPaid, deleteLoan } = useData()
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [detail, setDetail] = useState<Loan | null>(null)
  const [editing, setEditing] = useState<Loan | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'dueDate', dir: 'desc' })

  const counts = useMemo(() => {
    const c = { all: data.loans.length, issued: 0, paid: 0, overdue: 0, due_today: 0 }
    data.loans.forEach((l) => (c[l.status] += 1))
    return c
  }, [data.loans])

  const filtered = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return data.loans
      .filter((l) => tab === 'all' || l.status === tab)
      .filter((l) => l.clientName.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        if (sort.key === 'amount') return (a.amount - b.amount) * dir
        if (sort.key === 'clientName') return a.clientName.localeCompare(b.clientName) * dir
        return (a.dueDate < b.dueDate ? -1 : 1) * dir
      })
  }, [data.loans, tab, query, sort])

  const rows = compact ? filtered.slice(0, 6) : filtered

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  function handleExport() {
    exportCsv(
      `evolt-loans-${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((l) => ({
        Client: l.clientName,
        Amount: l.amount,
        Return: l.returnAmount,
        'Interest %': Math.round(l.interestRate * 100),
        Status: l.status,
        Issued: l.issuedDate,
        Due: l.dueDate,
        'Paid On': l.paidDate ?? '',
        Reference: l.id.toUpperCase(),
      })),
    )
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'all', label: 'All Loans', count: counts.all },
    { key: 'issued', label: 'Issued', count: counts.issued },
    { key: 'due_today', label: 'Due Today', count: counts.due_today },
    { key: 'overdue', label: 'Overdue', count: counts.overdue },
    { key: 'paid', label: 'Paid', count: counts.paid },
  ]

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by client name…"
              className="w-full h-12 rounded-xl pl-11 pr-4 text-sm surface-muted text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <button
            onClick={handleExport}
            className="h-12 px-4 inline-flex items-center justify-center gap-2 rounded-xl surface-muted text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
          >
            <Download size={16} /> Export CSV
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'rounded-lg px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors',
              tab === t.key
                ? 'bg-brand-600 text-white shadow-sm shadow-brand-900/30'
                : 'surface-muted text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10',
            )}
          >
            {t.label} <span className="opacity-70">({t.count})</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <Th onClick={() => toggleSort('clientName')} active={sort.key === 'clientName'}>
                Customer
              </Th>
              <Th onClick={() => toggleSort('amount')} active={sort.key === 'amount'}>
                Amount
              </Th>
              <th className="py-3 px-4 font-medium">Return</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <Th onClick={() => toggleSort('dueDate')} active={sort.key === 'dueDate'}>
                Loan Due
              </Th>
              <th className="py-3 px-4 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <LoanRow
                key={l.id}
                loan={l}
                menuOpen={menuFor === l.id}
                onMenu={() => setMenuFor(menuFor === l.id ? null : l.id)}
                onCloseMenu={() => setMenuFor(null)}
                onView={() => {
                  setDetail(l)
                  setMenuFor(null)
                }}
                onEdit={() => {
                  setEditing(l)
                  setMenuFor(null)
                }}
                onPaid={() => {
                  markLoanPaid(l.id)
                  setMenuFor(null)
                }}
                onDelete={() => {
                  if (confirm(`Delete the loan for ${l.clientName}? This cannot be undone.`)) deleteLoan(l.id)
                  setMenuFor(null)
                }}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-400">
                  No loans found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <LoanDetailModal loan={detail} onClose={() => setDetail(null)} onEdit={(l) => setEditing(l)} />
      <NewLoanModal open={!!editing} onClose={() => setEditing(null)} loan={editing} />
    </div>
  )
}

function Th({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active: boolean }) {
  return (
    <th className="py-3 px-4 font-medium">
      <button
        onClick={onClick}
        className={clsx('inline-flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200', active && 'text-brand-500 dark:text-brand-300')}
      >
        {children}
        <ArrowUpDown size={12} />
      </button>
    </th>
  )
}

function LoanRow({
  loan,
  menuOpen,
  onMenu,
  onCloseMenu,
  onView,
  onEdit,
  onPaid,
  onDelete,
}: {
  loan: Loan
  menuOpen: boolean
  onMenu: () => void
  onCloseMenu: () => void
  onView: () => void
  onEdit: () => void
  onPaid: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLTableCellElement>(null)
  const due = dueLabel(loan.dueDate)
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseMenu()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen, onCloseMenu])

  return (
    <tr className="border-t border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
      <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-white">
        <button onClick={onView} className="hover:text-brand-500 dark:hover:text-brand-300 transition-colors text-left">
          {loan.clientName}
        </button>
      </td>
      <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">{money(loan.amount)}</td>
      <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">{money(loan.returnAmount, true)}</td>
      <td className="py-3.5 px-4">
        <StatusBadge status={loan.status} />
      </td>
      <td className="py-3.5 px-4">
        <div className="flex flex-col">
          <span className="text-slate-700 dark:text-slate-200">{fmtDate(loan.dueDate)}</span>
          {loan.status !== 'paid' && (
            <span
              className={clsx(
                'text-[11px]',
                due.tone === 'late' && 'text-red-500',
                due.tone === 'soon' && 'text-amber-500',
                due.tone === 'ok' && 'text-slate-400',
              )}
            >
              {due.label}
            </span>
          )}
        </div>
      </td>
      <td ref={ref} className="py-3.5 px-4 text-right relative">
        <button
          onClick={onMenu}
          className="h-8 w-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-white transition-colors ml-auto"
        >
          <MoreVertical size={16} />
        </button>
        {menuOpen && (
          <div className="absolute right-4 top-12 z-20 w-44 rounded-xl surface p-1.5 text-left animate-scale-in">
            <button
              onClick={onView}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
            >
              <Eye size={15} /> View details
            </button>
            <button
              onClick={onEdit}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
            >
              <Pencil size={15} /> Edit loan
            </button>
            {loan.status !== 'paid' && (
              <button
                onClick={onPaid}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-green-600 dark:text-green-400 hover:bg-green-500/10"
              >
                <CheckCircle2 size={15} /> Mark as paid
              </button>
            )}
            <button
              onClick={onDelete}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10"
            >
              <Trash2 size={15} /> Delete loan
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}
