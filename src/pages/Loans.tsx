import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Clock, Download, Layers, Search, Upload, XCircle, ArrowUpRight } from 'lucide-react'
import type { EffectiveStatus, Loan } from '../domain/types'
import {
  effectiveStatus, instalmentNo, isStale, live, nextDue, principalOf, tabTotals, totalReturn, debitAmount, type TabKey,
} from '../domain/loans'
import { can } from '../domain/permissions'
import { dateLabel, dateStamp, zar } from '../domain/format'
import { PageHeader } from '../shell/PageHeader'
import { useAuth } from '../store/auth'
import { useBook } from '../store/book'
import { useUi } from '../store/ui'
import { Button } from '../ui/Button'
import { Empty, StatusPill } from '../ui/bits'
import { Menu } from '../ui/Menu'
import { download, toCsv } from '../ui/print'
import { useClientMap, useLoanMenu } from '../features/loans/shared'

const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  { key: 'all', label: 'ALL', icon: <Layers size={14} /> },
  { key: 'issued', label: 'ISSUED', icon: <ArrowUpRight size={14} /> },
  { key: 'duetoday', label: 'DUE TODAY', icon: <Clock size={14} /> },
  { key: 'overdue', label: 'OVERDUE', icon: <AlertTriangle size={14} /> },
  { key: 'paid', label: 'PAID', icon: <CheckCircle2 size={14} /> },
  { key: 'written_off', label: 'WRITTEN OFF', icon: <XCircle size={14} /> },
]

type SortKey = 'ref' | 'customer' | 'lent' | 'return' | 'status' | 'due'
const STATUS_ORDER: Record<EffectiveStatus, number> = { overdue: 0, duetoday: 1, issued: 2, paid: 3, written_off: 4 }

interface Row {
  loan: Loan
  customer: string
  status: EffectiveStatus
  stale: boolean
  due: string | null
  lent: number
  ret: number
}

export function Loans() {
  const { book, today } = useBook()
  const { user } = useAuth()
  const ui = useUi()
  const clients = useClientMap()
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab') as TabKey | null
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : 'all'
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 })
  const role = user?.role ?? 'auditor'

  const totals = useMemo(() => tabTotals(book.loans, today), [book.loans, today])

  const rows: Row[] = useMemo(() => {
    const term = q.trim().toLowerCase()
    const out = live(book.loans)
      .map((loan) => {
        const c = clients.get(loan.clientId)
        return {
          loan,
          customer: c?.name ?? '—',
          status: effectiveStatus(loan, today),
          stale: isStale(loan, today),
          due: nextDue(loan) ?? loan.schedule[loan.schedule.length - 1] ?? null,
          lent: principalOf(loan),
          ret: totalReturn(loan),
        }
      })
      .filter((r) => tab === 'all' || r.status === tab)
      .filter(
        (r) =>
          !term ||
          r.loan.ref.toLowerCase().includes(term) ||
          r.customer.toLowerCase().includes(term) ||
          (r.loan.mandateId ?? '').toLowerCase().includes(term) ||
          (clients.get(r.loan.clientId)?.ref ?? '').toLowerCase().includes(term),
      )
    const cmp = (a: Row, b: Row) => {
      switch (sort.key) {
        case 'ref': return a.loan.ref.localeCompare(b.loan.ref, undefined, { numeric: true })
        case 'customer': return a.customer.localeCompare(b.customer)
        case 'lent': return a.lent - b.lent
        case 'return': return a.ret - b.ret
        case 'status': return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        case 'due': return (a.due ?? '').localeCompare(b.due ?? '')
      }
    }
    // tie-break on due date, then ref, so equal groups stay in collection order
    return out.sort((a, b) => cmp(a, b) * sort.dir || (a.due ?? '').localeCompare(b.due ?? '') || a.loan.ref.localeCompare(b.loan.ref, undefined, { numeric: true }))
  }, [book.loans, clients, today, tab, q, sort])

  const setTab = (k: TabKey) => {
    const p = new URLSearchParams(params)
    if (k === 'all') p.delete('tab')
    else p.set('tab', k)
    setParams(p, { replace: true })
  }

  const exportCsv = () => {
    const head = ['Ref', 'Client ref', 'Customer', 'Lent', 'Lent derived', 'Return rate %', 'Instalment', 'Collection fee', 'Instalments', 'Paid', 'Total return', 'Status', 'Next due', 'Mandate', 'Issued on']
    const body = rows.map((r) => [
      r.loan.ref, clients.get(r.loan.clientId)?.ref ?? '', r.customer, r.lent, r.loan.principalDerived ? 'yes' : 'no', r.loan.returnRatePct,
      r.loan.instalmentAmount, r.loan.collectionFee, r.loan.schedule.length, r.loan.instalmentsPaid, r.ret, r.status, r.due ?? '', r.loan.mandateId ?? '', r.loan.issuedOn ?? '',
    ])
    download(`ledger-loans-${today}.csv`, toCsv([head, ...body]), 'text/csv')
  }

  const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))

  return (
    <>
      <PageHeader
        title="Loans"
        sub="Loan book"
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} aria-label="Export loans as CSV" title="Export CSV" className="!w-10 !px-0">
              <Download size={15} />
            </Button>
            {can(role, 'petty.create') && <Button variant="dark" onClick={() => ui.open({ kind: 'petty' })}>Log petty cash</Button>}
            {can(role, 'loan.create') && <Button variant="blue" icon={<Upload size={14} />} onClick={() => ui.open({ kind: 'bulkUpload' })}>Bulk upload</Button>}
            {can(role, 'loan.create') && <Button variant="primary" onClick={() => ui.open({ kind: 'newLoan' })}>New loan</Button>}
          </>
        }
      />

      <label className="relative block">
        <Search size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2" style={{ color: 'var(--dim)' }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search ref, client or mandate…"
          aria-label="Search loans"
          className="h-[46px] w-full rounded-[16px] pl-12 pr-4 text-[14px]"
          style={{ background: 'var(--panel)', border: '1px solid var(--line2)', color: 'var(--ink)' }}
        />
      </label>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6" role="tablist" aria-label="Loan status">
        {TABS.map((t) => {
          const active = t.key === tab
          const v = totals[t.key]
          const tone = t.key === 'overdue' ? 'var(--red)' : t.key === 'paid' ? 'var(--green)' : t.key === 'duetoday' ? 'var(--amber)' : 'var(--mut)'
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className="flex min-h-[84px] flex-col justify-between rounded-[18px] p-3.5 text-left transition hover:-translate-y-0.5"
              style={
                active
                  ? { background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)', boxShadow: 'var(--cardLift)' }
                  : { background: 'var(--panel)', color: v.count ? 'var(--ink)' : 'var(--dim)', border: '1px solid var(--line)', boxShadow: 'var(--cardLift)' }
              }
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-[9px]" style={active ? { background: 'var(--panel)', color: 'var(--ink)' } : { background: 'var(--panel3)', color: v.count ? tone : 'var(--dim)' }}>
                  {t.icon}
                </span>
                <span className="text-[10.5px] font-semibold tracking-[0.08em]">{t.label}</span>
                <span className="ml-auto inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold" style={active ? { background: 'var(--panel)', color: 'var(--ink)' } : { background: 'var(--panel3)', color: 'var(--mut)' }}>
                  {v.count}
                </span>
              </div>
              <div className="mt-2 text-[18px] font-bold num">{zar(v.amount)}</div>
            </button>
          )
        })}
      </div>

      {/* Desktop table: grid rows so each row is one rounded card */}
      <div className="hidden overflow-hidden rounded-[22px] md:block" style={{ background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: 'var(--cardLift)' }}>
        <div className="overflow-x-auto" role="table" aria-label="Loan book">
          <div className="min-w-[880px] px-2 pb-2">
            <div role="row" className={`${GRID} pt-4 pb-1 text-[11px] font-bold tracking-[0.08em]`} style={{ color: 'var(--ink)' }}>
              <Th k="ref" sort={sort} onSort={toggleSort} className="pl-8">REF NUMBER</Th>
              <Th k="customer" sort={sort} onSort={toggleSort}>CUSTOMER</Th>
              <Th k="lent" sort={sort} onSort={toggleSort}>LENT</Th>
              <Th k="return" sort={sort} onSort={toggleSort} className="justify-center">RETURN</Th>
              <Th k="status" sort={sort} onSort={toggleSort} className="justify-center">STATUS</Th>
              <Th k="due" sort={sort} onSort={toggleSort} className="justify-center">LOAN DUE</Th>
              <div role="columnheader" className="pr-4 text-right">ACTION</div>
            </div>
            <div role="rowgroup" className="flex flex-col gap-2">
              {rows.map((r) => (
                <LoanRow key={r.loan.id} row={r} />
              ))}
            </div>
          </div>
        </div>
        {!rows.length && <Empty>{q ? `No loans match “${q}”.` : 'No loans in this view.'}</Empty>}
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {rows.map((r) => (
          <LoanCard key={r.loan.id} row={r} />
        ))}
        {!rows.length && (
          <div className="panel">
            <Empty>{q ? `No loans match “${q}”.` : 'No loans in this view.'}</Empty>
          </div>
        )}
      </div>
    </>
  )
}

const GRID = 'grid grid-cols-[minmax(110px,1fr)_minmax(170px,2fr)_minmax(110px,1.2fr)_minmax(120px,1.2fr)_minmax(110px,1fr)_minmax(120px,1.1fr)_64px] items-center gap-x-2'

function Th({ k, sort, onSort, children, className }: { k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; children: ReactNode; className?: string }) {
  const active = sort.key === k
  return (
    <div role="columnheader" className={`flex px-1 ${className ?? ''}`} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => onSort(k)} className="inline-flex items-center gap-1 uppercase tracking-[0.08em]">
        {children}
        {active && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </div>
  )
}

function DueCell({ loan, due, status }: { loan: Loan; due: string | null; status: EffectiveStatus }) {
  const { no, total } = instalmentNo(loan)
  return (
    <div className="leading-tight">
      <div className="text-[13.5px] font-semibold" style={{ color: status === 'overdue' ? 'var(--ink)' : undefined }}>{dateStamp(due)}</div>
      {total > 1 && <div className="mt-0.5 text-[10px] font-semibold tracking-[0.08em]" style={{ color: 'var(--mut)' }}>INST {no}/{total}</div>}
    </div>
  )
}

function ReturnCell({ loan, ret }: { loan: Loan; ret: number }) {
  return (
    <div className="leading-tight">
      <div className="text-[15px] font-bold num" style={{ color: 'var(--blue)' }}>{zar(ret)}</div>
      {loan.collectionFee > 0 && (
        <div className="mt-0.5 text-[9.5px] font-semibold tracking-[0.06em]" style={{ color: 'var(--mut)' }}>DEBIT {zar(debitAmount(loan))}</div>
      )}
    </div>
  )
}

function StatusCell({ status, stale }: { status: EffectiveStatus; stale: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <StatusPill status={status} />
      {stale && (
        <span className="text-[8.5px] font-bold tracking-[0.1em]" style={{ color: 'var(--amber)' }} title="An instalment date passed and nobody updated this loan">
          NOT UPDATED
        </span>
      )}
    </div>
  )
}

function LoanRow({ row }: { row: Row }) {
  const ui = useUi()
  const menu = useLoanMenu(row.loan)
  const { loan, status } = row
  const overdue = status === 'overdue'
  return (
    <div
      role="row"
      tabIndex={0}
      className={`${GRID} cursor-pointer rounded-[16px] py-3.5 transition hover:brightness-110 focus-visible:outline-2`}
      style={{ background: overdue ? 'var(--rowOverdue)' : 'var(--panel2)', border: `1px solid ${overdue ? 'rgba(224,138,118,.22)' : 'var(--line)'}` }}
      onClick={() => ui.open({ kind: 'loan', loanId: loan.id })}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && ui.open({ kind: 'loan', loanId: loan.id })}
    >
      <div role="cell" className="pl-8 font-mono text-[13px]" style={{ color: 'var(--mut)' }}>{loan.ref}</div>
      <div role="cell" className="min-w-0 px-1">
        <button
          className="max-w-full truncate text-left text-[14.5px] font-semibold hover:underline"
          style={{ color: overdue ? 'var(--red)' : 'var(--ink)' }}
          onClick={(e) => {
            e.stopPropagation()
            ui.open({ kind: 'client', clientId: loan.clientId })
          }}
        >
          {row.customer}
        </button>
      </div>
      <div role="cell" className="px-1">
        <div className="text-[14px] font-semibold num">{zar(row.lent)}</div>
        {loan.principalDerived && <div className="text-[9.5px] font-semibold tracking-[0.06em]" style={{ color: 'var(--dim)' }} title="Not recorded — back-calculated from the return">DERIVED</div>}
      </div>
      <div role="cell" className="text-center"><ReturnCell loan={loan} ret={row.ret} /></div>
      <div role="cell" className="text-center"><StatusCell status={status} stale={row.stale} /></div>
      <div role="cell" className="text-center"><DueCell loan={loan} due={row.due} status={status} /></div>
      <div role="cell" className="pr-3 text-right" onClick={(e) => e.stopPropagation()}>
        <Menu items={menu} label={`Actions for ${loan.ref}`} />
      </div>
    </div>
  )
}

function LoanCard({ row }: { row: Row }) {
  const ui = useUi()
  const menu = useLoanMenu(row.loan)
  const { loan, status } = row
  return (
    <div
      className="rounded-[18px] p-4"
      style={{ background: status === 'overdue' ? 'var(--rowOverdue)' : 'var(--panel)', border: '1px solid var(--line)', boxShadow: 'var(--cardLift)' }}
      onClick={() => ui.open({ kind: 'loan', loanId: loan.id })}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[11.5px]" style={{ color: 'var(--mut)' }}>{loan.ref}</div>
          <div className="truncate text-[15px] font-semibold">{row.customer}</div>
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <StatusCell status={status} stale={row.stale} />
          <Menu items={menu} label={`Actions for ${loan.ref}`} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <div className="text-[9.5px] font-semibold tracking-[0.08em]" style={{ color: 'var(--mut)' }}>LENT</div>
          <div className="font-semibold num">{zar(row.lent)}</div>
        </div>
        <div>
          <div className="text-[9.5px] font-semibold tracking-[0.08em]" style={{ color: 'var(--mut)' }}>RETURN</div>
          <ReturnCell loan={loan} ret={row.ret} />
        </div>
        <div>
          <div className="text-[9.5px] font-semibold tracking-[0.08em]" style={{ color: 'var(--mut)' }}>DUE</div>
          <div className="font-semibold">{dateLabel(row.due)}</div>
        </div>
      </div>
    </div>
  )
}
