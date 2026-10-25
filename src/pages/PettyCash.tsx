import { useMemo, useState } from 'react'
import { Check, Download, RotateCcw, Wallet, X } from 'lucide-react'
import { PageHeader } from '../shell/PageHeader'
import { useActor, useBook } from '../store/book'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import * as ops from '../store/ops'
import { can } from '../domain/permissions'
import { dateLabel, monthKey, round2, zar } from '../domain/format'
import type { PettyEntry, PettyStatus } from '../domain/types'
import { Button } from '../ui/Button'
import { Empty, Pill, Segmented, type Tone } from '../ui/bits'
import { Menu } from '../ui/Menu'
import { download, toCsv } from '../ui/print'
import { PETTY_CATEGORIES } from '../features/petty/LogPettyModal'

const STATUS_TONE: Record<PettyStatus, Tone> = { PENDING: 'amber', APPROVED: 'blue', REPAID: 'green', DECLINED: 'red' }
const CAT_LABEL = Object.fromEntries(PETTY_CATEGORIES.map((c) => [c.value, c.label]))

type Filter = 'all' | PettyStatus

/** An entry still owed back to the float: a pending/approved payment to a named person. */
const isOutstanding = (p: PettyEntry) => !!p.borrower && (p.status === 'PENDING' || p.status === 'APPROVED')

export function PettyCash() {
  const { book, commit, today } = useBook()
  const actor = useActor()
  const { user } = useAuth()
  const ui = useUi()
  const [filter, setFilter] = useState<Filter>('all')
  const canLog = !!user && can(user.role, 'petty.create')
  const canDecide = !!user && can(user.role, 'bank.manage')

  const totals = useMemo(() => {
    const live = book.petty.filter((p) => p.status !== 'DECLINED')
    const mk = monthKey(today)
    const month = live.filter((p) => monthKey(p.date) === mk)
    const out = book.petty.filter(isOutstanding)
    return {
      month: round2(month.reduce((s, p) => s + p.amount, 0)),
      monthCount: month.length,
      outstanding: round2(out.reduce((s, p) => s + p.amount, 0)),
      outCount: out.length,
      pending: book.petty.filter((p) => p.status === 'PENDING').length,
      all: round2(live.reduce((s, p) => s + p.amount, 0)),
    }
  }, [book.petty, today])

  const rows = useMemo(
    () => book.petty.filter((p) => filter === 'all' || p.status === filter).slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [book.petty, filter],
  )

  const setStatus = (p: PettyEntry, s: PettyStatus) => commit((b) => ops.setPettyStatus(b, p.id, s, actor), `${zar(p.amount)} → ${s}`)

  const actions = (p: PettyEntry) => [
    { label: 'Approve', icon: <Check size={14} />, onClick: () => setStatus(p, 'APPROVED'), hidden: p.status !== 'PENDING' },
    { label: 'Mark repaid', icon: <RotateCcw size={14} />, onClick: () => setStatus(p, 'REPAID'), hidden: p.status === 'REPAID' || p.status === 'DECLINED' },
    { label: 'Decline', icon: <X size={14} />, danger: true, onClick: () => setStatus(p, 'DECLINED'), hidden: p.status !== 'PENDING' },
    { label: 'Reopen', icon: <RotateCcw size={14} />, onClick: () => setStatus(p, 'PENDING'), hidden: p.status === 'PENDING' },
  ]

  const exportCsv = () =>
    download(`ledger-petty-cash-${today}.csv`, toCsv([['Date', 'Category', 'Purpose', 'Paid to', 'Amount', 'Status', 'Logged by', 'Notes'], ...rows.map((p) => [p.date, p.category, p.purpose, p.borrower, p.amount, p.status, p.by, p.notes])]), 'text/csv')

  return (
    <>
      <PageHeader
        title="Petty cash"
        sub="Office float"
        actions={
          <>
            <Button variant="outline" icon={<Download size={14} />} onClick={exportCsv} disabled={!rows.length}>Export</Button>
            {canLog && <Button variant="dark" onClick={() => ui.open({ kind: 'petty' })}>Log petty cash</Button>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="THIS MONTH" value={zar(totals.month)} sub={`${totals.monthCount} entr${totals.monthCount === 1 ? 'y' : 'ies'}`} />
        <Stat label="OUTSTANDING ADVANCES" value={zar(totals.outstanding)} sub={`${totals.outCount} not yet repaid`} tone={totals.outstanding ? 'var(--amber)' : undefined} />
        <Stat label="AWAITING APPROVAL" value={String(totals.pending)} sub="pending entries" tone={totals.pending ? 'var(--amber)' : undefined} />
        <Stat label="ALL TIME" value={zar(totals.all)} sub="excluding declined" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Filter>
          size="sm"
          value={filter}
          onChange={setFilter}
          options={(['all', 'PENDING', 'APPROVED', 'REPAID', 'DECLINED'] as Filter[]).map((v) => ({ value: v, label: v === 'all' ? 'All' : v }))}
        />
        <span className="text-[10.5px] font-semibold tracking-[0.12em]" style={{ color: 'var(--mut)' }}>{rows.length} ENTRIES</span>
      </div>

      <div className="panel overflow-hidden">
        <div className="md:hidden">
          {rows.map((p) => (
            <div key={p.id} className="flex items-start gap-3 px-4 py-3.5" style={{ borderTop: '1px solid var(--line)' }}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={STATUS_TONE[p.status]}>{p.status}</Pill>
                  <span className="text-[11px]" style={{ color: 'var(--dim)' }}>{CAT_LABEL[p.category] ?? p.category}</span>
                </div>
                <div className="mt-1 text-[13.5px] font-semibold">{p.purpose}</div>
                <div className="text-[11.5px]" style={{ color: 'var(--mut)' }}>{dateLabel(p.date)}{p.borrower ? ` · ${p.borrower}` : ''} · {p.by}</div>
              </div>
              <div className="text-right text-[14px] font-bold num">{zar(p.amount)}</div>
              {canDecide && <Menu label={`Actions for ${p.purpose}`} items={actions(p)} />}
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ background: 'var(--panel3)', color: 'var(--mut)' }}>
                <th className="px-4 py-3.5">Date</th>
                <th className="px-4 py-3.5">Category</th>
                <th className="px-4 py-3.5">Purpose</th>
                <th className="px-4 py-3.5">Paid to</th>
                <th className="px-4 py-3.5 text-right">Amount</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Logged by</th>
                <th className="w-12 px-2 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="row-hover" style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="whitespace-nowrap px-4 py-3 num" style={{ color: 'var(--mut)' }}>{dateLabel(p.date)}</td>
                  <td className="px-4 py-3"><Pill tone="mut">{CAT_LABEL[p.category] ?? p.category}</Pill></td>
                  <td className="px-4 py-3 font-medium">{p.purpose}{p.notes && <div className="text-[11.5px] font-normal" style={{ color: 'var(--dim)' }}>{p.notes}</div>}</td>
                  <td className="px-4 py-3">{p.borrower || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold num">{zar(p.amount)}</td>
                  <td className="px-4 py-3"><Pill tone={STATUS_TONE[p.status]}>{p.status}</Pill></td>
                  <td className="whitespace-nowrap px-4 py-3" style={{ color: 'var(--mut)' }}>{p.by}</td>
                  <td className="px-2 py-3">
                    {canDecide && (
                      <Menu label={`Actions for ${p.purpose}`} items={actions(p)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <Empty icon={<Wallet size={22} />}>
            No petty cash {filter === 'all' ? 'logged yet' : `marked ${filter.toLowerCase()}`}.
            {canLog && filter === 'all' && <Button variant="primary" size="sm" className="mt-2" onClick={() => ui.open({ kind: 'petty' })}>Log the first entry</Button>}
          </Empty>
        )}
      </div>
    </>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="panel px-5 py-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 text-[22px] font-bold num" style={{ color: tone ?? 'var(--ink)' }}>{value}</div>
      <div className="text-[11.5px]" style={{ color: 'var(--dim)' }}>{sub}</div>
    </div>
  )
}
