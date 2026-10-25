import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { useBook } from '../../store/book'
import { useUi } from '../../store/ui'
import { collectionCalendar, nextCollectionDay } from '../../domain/loans'
import { DAY_NAMES, MONTH_NAMES, dateStamp, isoDate, zar } from '../../domain/format'

/** Glass month calendar of unpaid instalments; a day opens the due-day list. */
export function CollectionsCalendar() {
  const { book, today } = useBook()
  const ui = useUi()
  const cal = useMemo(() => collectionCalendar(book.loans), [book.loans])
  const next = useMemo(() => nextCollectionDay(book.loans, today), [book.loans, today])
  const start = next ?? today
  const [ym, setYm] = useState({ y: +start.slice(0, 4), m: +start.slice(5, 7) - 1 })

  const first = new Date(ym.y, ym.m, 1)
  const days = new Date(ym.y, ym.m + 1, 0).getDate()
  const cells: (string | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: days }, (_, i) => isoDate(new Date(ym.y, ym.m, i + 1)))]
  while (cells.length % 7) cells.push(null)

  const monthKey = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}`
  const monthDates = [...cal.keys()].filter((d) => d.startsWith(monthKey)).sort()
  const focus = next && next.startsWith(monthKey) ? next : monthDates.find((d) => d >= today) ?? monthDates[0] ?? null
  const focusAmt = focus ? cal.get(focus)?.amount ?? 0 : 0
  const step = (n: number) => setYm(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }))

  return (
    <div className="glass p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button onClick={() => step(-1)} className="inline-flex h-8 w-8 items-center justify-center rounded-full" style={{ border: '1px solid var(--calGlassLine)' }} aria-label="Previous month">
          <ChevronLeft size={14} />
        </button>
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-2.5">
          <span className="text-[13.5px] font-bold uppercase tracking-[0.04em]">{MONTH_NAMES[ym.m].toUpperCase()} {ym.y}</span>
          {focus && (
            <button onClick={() => ui.open({ kind: 'dueDay', date: focus })} className="rounded-full px-2.5 py-1 text-[9.5px] font-semibold tracking-[0.06em]" style={{ background: 'rgba(0,0,0,.45)', border: '1px solid var(--calGlassLine)', color: '#d8d6cc' }}>
              DUE {dateStamp(focus)} <b className="ml-1 text-[11px] text-white">{zar(focusAmt)}</b>
            </button>
          )}
        </div>
        <button onClick={() => step(1)} className="inline-flex h-8 w-8 items-center justify-center rounded-full" style={{ border: '1px solid var(--calGlassLine)' }} aria-label="Next month">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {DAY_NAMES.map((d) => (
          <div key={d} className="rounded-md py-1 text-center text-[9px] font-semibold tracking-[0.08em]" style={{ background: 'rgba(0,0,0,.35)', color: 'var(--calCellMut)' }}>
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />
          const has = cal.get(d)
          const isToday = d === today
          const isFocus = d === focus
          const wk = i % 7 === 0 || i % 7 === 6
          return (
            <button
              key={d}
              onClick={() => ui.open({ kind: 'dueDay', date: d })}
              title={has ? `${has.count} instalment${has.count > 1 ? 's' : ''} · ${zar(has.amount)}` : dateStamp(d)}
              className={clsx('relative flex h-[44px] flex-col items-center justify-center rounded-[12px] text-[12.5px] font-semibold transition hover:brightness-125 sm:h-[48px]')}
              style={{
                background: isFocus ? 'var(--acc)' : has ? 'var(--calCellHas)' : wk ? 'var(--calCellWk)' : 'var(--calCell)',
                color: isFocus ? 'var(--accInk)' : 'var(--calCellInk)',
                border: isToday ? '1.5px solid var(--calCellInk)' : `1px solid ${has ? 'var(--calCellHasLine)' : 'var(--calCellLine)'}`,
                boxShadow: isFocus ? '0 6px 18px -4px rgba(195,245,60,.5)' : undefined,
              }}
            >
              <span className="flex items-center gap-1">
                {+d.slice(8)}
                {has && (
                  <span className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[8.5px] font-bold" style={{ background: isFocus ? 'var(--accInk)' : 'var(--calCellInk)', color: isFocus ? 'var(--acc)' : 'var(--calCellHas)' }}>
                    {has.count}
                  </span>
                )}
              </span>
              {has && <span className="hidden text-[8.5px] font-medium opacity-80 sm:block">{zar(has.amount)}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
