import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useBook } from '../../store/book'
import { collectionsByMonth, expectedReturn } from '../../domain/loans'
import { MONTH_NAMES, zar } from '../../domain/format'

const PAGE = 6

export function ExpectedReturnCard() {
  const { book, today } = useBook()
  const er = useMemo(() => expectedReturn(book.loans), [book.loans])
  const months = useMemo(() => collectionsByMonth(book.loans), [book.loans])
  const startIdx = Math.max(0, months.findIndex((m) => m.month >= today.slice(0, 7)) - 1)
  const [page, setPage] = useState(() => Math.floor(Math.max(0, startIdx) / PAGE))
  const pages = Math.max(1, Math.ceil(months.length / PAGE))
  const visible = months.slice(page * PAGE, page * PAGE + PAGE)
  const max = Math.max(1, ...visible.map((m) => m.amount))
  const pPct = er.total ? Math.round((er.principal / er.total) * 100) : 0

  return (
    <div className="panel flex flex-col p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Expected return</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[24px] font-extrabold num">{zar(er.total)}</span>
            <span className="text-[10.5px] font-semibold tracking-[0.1em]" style={{ color: 'var(--mut)' }}>{er.open} OPEN</span>
          </div>
        </div>
        <Link to="/ledger" className="text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>Ledger →</Link>
      </div>

      {er.total > 0 && (
        <div className="mt-3">
          <div className="flex h-2 overflow-hidden rounded-full" style={{ background: 'var(--panel3)' }}>
            <div style={{ width: `${pPct}%`, background: 'var(--blue)' }} />
            <div style={{ width: `${100 - pPct}%`, background: 'var(--acc)' }} />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px]">
            <span style={{ color: 'var(--mut)' }}>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: 'var(--blue)' }} />
              PRINCIPAL <b className="ml-1" style={{ color: 'var(--ink)' }}>{zar(er.principal, { cents: true })}</b> · {pPct}%
            </span>
            <span style={{ color: 'var(--mut)' }}>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: 'var(--acc)' }} />
              INTEREST <b className="ml-1" style={{ color: 'var(--ink)' }}>{zar(er.interest, { cents: true })}</b> · {100 - pPct}%
            </span>
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between">
        <div className="eyebrow">Collections by month</div>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {Array.from({ length: pages }, (_, i) => (
                <span key={i} className="h-1.5 rounded-full transition-all" style={{ width: i === page ? 16 : 6, background: i === page ? 'var(--acc)' : 'var(--line2)' }} />
              ))}
            </div>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="inline-flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-30" style={{ border: '1px solid var(--line2)' }} aria-label="Earlier months">
              <ChevronLeft size={13} />
            </button>
            <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className="inline-flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-30" style={{ border: '1px solid var(--line2)' }} aria-label="Later months">
              <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>

      {visible.length ? (
        <div className="mt-3 grid h-[220px] gap-2" style={{ gridTemplateColumns: `repeat(${PAGE}, minmax(0,1fr))` }}>
          {visible.map((m) => {
            const current = m.month === today.slice(0, 7)
            const h = Math.max(8, (m.amount / max) * 100)
            return (
              <div key={m.month} className="flex min-w-0 flex-col items-stretch justify-end">
                <div className="mb-1.5 text-center leading-tight">
                  <div className="truncate text-[11px] font-bold num">{zar(Math.round(m.amount))}</div>
                  <div className="truncate text-[8.5px] font-semibold tracking-[0.06em]" style={{ color: 'var(--mut)' }}>
                    {m.count} INST{m.count === 1 ? '' : 'S'}
                  </div>
                </div>
                <div
                  key={`${page}-${m.month}`}
                  className="grow-bar rounded-[10px]"
                  title={`${zar(m.amount)} · ${m.count} instalment${m.count === 1 ? '' : 's'}`}
                  style={{ height: `${h}%`, background: current ? 'var(--acc)' : 'linear-gradient(180deg, #4a4238, #2c2822)', boxShadow: current ? '0 8px 24px -8px rgba(195,245,60,.6)' : undefined }}
                />
                <div className="mt-2 text-center text-[9.5px] font-semibold tracking-[0.1em]" style={{ color: current ? 'var(--ink)' : 'var(--mut)' }}>
                  {MONTH_NAMES[+m.month.slice(5) - 1].toUpperCase()}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="py-10 text-center text-[13px]" style={{ color: 'var(--mut)' }}>Nothing left to collect.</div>
      )}
    </div>
  )
}
