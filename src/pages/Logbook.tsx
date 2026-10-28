import { useMemo, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { PageHeader } from '../shell/PageHeader'
import { useBook } from '../store/book'
import { Button } from '../ui/Button'
import { Empty, Input, Pill, Segmented, Select, type Tone } from '../ui/bits'
import { addDays, dateTimeLabel, zar } from '../domain/format'
import { download, toCsv } from '../ui/print'
import type { LogEntry } from '../domain/types'

/** Colour a log type by what kind of event it records. */
export function logTone(type: string): Tone {
  const t = type.toUpperCase()
  if (/PAYMENT|→ PAID|BANK IN|APPROVED|REPAID|UNBLOCKED|SETTLED/.test(t)) return 'green'
  if (/OVERDUE|ARCHIVED|WRITTEN|DECLINED|FAILED|BLOCKED|REMOVED|REVERS/.test(t)) return 'red'
  if (/PETTY|EXPENSE|BANK OUT|BANK BALANCE|SMS|CALL/.test(t)) return 'amber'
  if (/LOAN|APPLICATION|IMPORT|BANK REPORT/.test(t)) return 'blue'
  return 'mut'
}

type Range = 'all' | 'today' | '7d' | 'month'
const PAGE = 100

export function Logbook() {
  const { book, today } = useBook()
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [range, setRange] = useState<Range>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const types = useMemo(() => [...new Set(book.logbook.map((g) => g.type))].sort(), [book.logbook])

  const rows = useMemo(() => {
    const lo = from || (range === 'today' ? today : range === '7d' ? addDays(today, -6) : range === 'month' ? today.slice(0, 8) + '01' : '')
    const hi = to || ''
    const needle = q.trim().toLowerCase()
    return book.logbook.filter((g) => {
      const d = localDay(g.at)
      if (lo && d < lo) return false
      if (hi && d > hi) return false
      if (type && g.type !== type) return false
      if (needle && ![g.ref, g.customer, g.comment, g.by, g.type].some((v) => String(v).toLowerCase().includes(needle))) return false
      return true
    })
  }, [book.logbook, q, type, range, from, to, today])

  const exportCsv = () => {
    download(
      `ledger-logbook-${today}.csv`,
      toCsv([['Date', 'Type', 'Ref', 'Customer', 'Amount', 'By', 'Comment'], ...rows.map((g) => [g.at, g.type, g.ref, g.customer, g.amount, g.by, g.comment])]),
      'text/csv',
    )
  }

  return (
    <>
      <PageHeader
        title="Logbook"
        sub="Global audit trail"
        actions={<Button variant="outline" size="md" icon={<Download size={14} />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <Segmented<Range>
          size="sm"
          value={range}
          onChange={(v) => { setRange(v); setFrom(''); setTo(''); setLimit(PAGE) }}
          options={[{ value: 'all', label: 'All' }, { value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: 'month', label: 'This month' }]}
        />
        <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-semibold tracking-[0.1em]" style={{ color: 'var(--mut)' }}>
          FROM <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setLimit(PAGE) }} className="!w-[140px] !py-1.5" aria-label="From date" />
          TO <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setLimit(PAGE) }} className="!w-[140px] !py-1.5" aria-label="To date" />
        </div>
        <span className="ml-auto text-[10.5px] font-semibold tracking-[0.12em]" style={{ color: 'var(--mut)' }}>
          {Math.min(limit, rows.length)} OF {rows.length} ENTRIES
        </span>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--dim)' }} />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} placeholder="Search ref, customer, comment, person…" className="!pl-10" aria-label="Search logbook" />
        </div>
        <Select value={type} onChange={(e) => { setType(e.target.value); setLimit(PAGE) }} className="!w-auto min-w-[200px]" aria-label="Filter by type">
          <option value="">All event types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>

      <div className="panel overflow-hidden" style={{ background: 'var(--panel)' }}>
        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ background: 'var(--panel3)', color: 'var(--mut)' }}>
                <th className="px-4 py-3.5">Date / time</th>
                <th className="px-4 py-3.5">Type</th>
                <th className="px-4 py-3.5">Ref</th>
                <th className="px-4 py-3.5">Customer</th>
                <th className="px-4 py-3.5 text-right">Amount</th>
                <th className="px-4 py-3.5">By</th>
                <th className="px-4 py-3.5">Comment</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((g) => (
                <tr key={g.id} className="row-hover align-top" style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="whitespace-nowrap px-4 py-3 num" style={{ color: 'var(--mut)' }}>{dateTimeLabel(g.at)}</td>
                  <td className="px-4 py-3"><Pill tone={logTone(g.type)}>{g.type}</Pill></td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">{g.ref}</td>
                  <td className="px-4 py-3">{g.customer}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right num">{g.amount ? zar(g.amount) : '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3" style={{ color: 'var(--mut)' }}>{g.by}</td>
                  <td className="max-w-[420px] px-4 py-3" style={{ color: 'var(--mut)' }}>{g.comment || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile list */}
        <div className="md:hidden">
          {rows.slice(0, limit).map((g) => <MobileRow key={g.id} g={g} />)}
        </div>
        {!rows.length && <Empty>No log entries match these filters.</Empty>}
        {rows.length > limit && (
          <div className="flex justify-center p-4" style={{ borderTop: '1px solid var(--line)' }}>
            <Button variant="soft" size="sm" onClick={() => setLimit((l) => l + PAGE)}>Load {Math.min(PAGE, rows.length - limit)} more</Button>
          </div>
        )}
      </div>
      <p className="text-[11px] tracking-[0.04em]" style={{ color: 'var(--dim)' }}>
        THE LOGBOOK IS APPEND-ONLY — ENTRIES CANNOT BE EDITED OR DELETED. EVERY CHANGE TO THE BOOK WRITES ONE.
      </p>
    </>
  )
}

function MobileRow({ g }: { g: LogEntry }) {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3.5" style={{ borderTop: '1px solid var(--line)' }}>
      <div className="flex items-center justify-between gap-2">
        <Pill tone={logTone(g.type)}>{g.type}</Pill>
        <span className="text-[13px] font-semibold num">{g.amount ? zar(g.amount) : ''}</span>
      </div>
      <div className="text-[13px] font-semibold">{g.ref} · {g.customer}</div>
      {g.comment && <div className="text-[12px]" style={{ color: 'var(--mut)' }}>{g.comment}</div>}
      <div className="text-[11px]" style={{ color: 'var(--dim)' }}>{dateTimeLabel(g.at)} · {g.by}</div>
    </div>
  )
}

/** Local calendar day of a timestamp (YYYY-MM-DD). */
function localDay(at: string) {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at.slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
