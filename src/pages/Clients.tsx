import { useMemo, useState } from 'react'
import { Ban, Search, UserPlus } from 'lucide-react'
import { PageHeader } from '../shell/PageHeader'
import { useBook } from '../store/book'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import { can } from '../domain/permissions'
import { clientLoans, isOpen, outstanding } from '../domain/loans'
import { dateLabel, maskTail, zar } from '../domain/format'
import { Button } from '../ui/Button'
import { Empty, Input, Pill, Segmented } from '../ui/bits'
import { officerName, scopeClients, useMyEmployeeId, usePiiVisible } from '../features/clients/shared'

type View = 'active' | 'archived'

export function Clients() {
  const { book } = useBook()
  const { user } = useAuth()
  const ui = useUi()
  const myId = useMyEmployeeId()
  const showPii = usePiiVisible()
  const [q, setQ] = useState('')
  const [view, setView] = useState<View>('active')

  const scoped = useMemo(() => scopeClients(book.clients, user!.role, myId), [book.clients, user, myId])
  const onBook = scoped.filter((c) => !c.deletedAt)
  const archived = scoped.filter((c) => c.deletedAt)

  const rows = useMemo(() => {
    const src = view === 'active' ? onBook : archived
    const k = q.trim().toLowerCase()
    const list = k
      ? src.filter((c) => [c.name, c.ref, c.phone, c.employer, c.city, officerName(book, c.officerId)].some((v) => (v ?? '').toLowerCase().includes(k)) || (c.idNumber ?? '').endsWith(k))
      : src
    return list
      .map((c) => {
        const ls = clientLoans(book.loans, c.id).filter(isOpen)
        return { c, open: ls.length, owed: ls.reduce((s, l) => s + outstanding(l), 0) }
      })
      .sort((a, b) => b.c.createdAt.localeCompare(a.c.createdAt))
  }, [view, onBook, archived, q, book])

  const idCell = (v: string | null) => (showPii ? v ?? '—' : maskTail(v))

  return (
    <>
      <PageHeader
        title="Clients"
        sub={`${onBook.length} ON BOOK`}
        actions={can(user!.role, 'client.create') && <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => ui.open({ kind: 'clientForm' })}>Add client</Button>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--dim)' }} />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ref, phone, employer, officer…" className="!h-12 !rounded-2xl !pl-11" aria-label="Search clients" />
        </div>
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: 'active', label: `On book · ${onBook.length}` },
            { value: 'archived', label: `Archived · ${archived.length}` },
          ]}
        />
      </div>

      <div className="overflow-hidden rounded-[22px]" style={{ background: 'var(--calGlass)', border: '1px solid var(--calGlassLine)', boxShadow: 'var(--cardLift)', backdropFilter: 'blur(26px) saturate(1.6)' }}>
        {/* desktop table */}
        <table className="hidden w-full text-left md:table">
          <thead>
            <tr className="text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)', background: 'rgba(0,0,0,.25)' }}>
              <th className="w-12 py-4 pl-5 font-semibold">#</th>
              <th className="py-4 font-semibold">Ref</th>
              <th className="py-4 font-semibold">Customer</th>
              <th className="py-4 font-semibold">ID number</th>
              <th className="py-4 text-right font-semibold">Open loans</th>
              <th className="py-4 pl-6 font-semibold">Added</th>
              <th className="py-4 pr-5 font-semibold">Officer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, open, owed }, i) => (
              <tr
                key={c.id}
                onClick={() => ui.open({ kind: 'client', clientId: c.id })}
                className="cursor-pointer text-[13.5px] transition hover:bg-[var(--rowHover)]"
                style={{ borderTop: '1px solid var(--calCellLine)', opacity: c.deletedAt ? 0.6 : 1 }}
              >
                <td className="py-3 pl-5 num" style={{ color: 'var(--dim)' }}>{i + 1}</td>
                <td className="py-3 num" style={{ color: 'var(--mut)' }}>{c.ref}</td>
                <td className="py-3 font-semibold">
                  <span className="inline-flex items-center gap-2">
                    {c.name}
                    {c.blocked && <Pill tone="red"><Ban size={10} className="mr-1" />Blocked</Pill>}
                  </span>
                </td>
                <td className="py-3 font-mono text-[12.5px]" style={{ color: 'var(--mut)' }}>{idCell(c.idNumber)}</td>
                <td className="py-3 text-right num">
                  {open ? (
                    <span>
                      <span className="font-semibold">{zar(owed)}</span>
                      <span className="ml-1.5 text-[11px]" style={{ color: 'var(--dim)' }}>· {open}</span>
                    </span>
                  ) : (
                    <span style={{ color: 'var(--dim)' }}>—</span>
                  )}
                </td>
                <td className="py-3 pl-6 num" style={{ color: 'var(--mut)' }}>{dateLabel(c.createdAt)}</td>
                <td className="py-3 pr-5" style={{ color: 'var(--mut)' }}>{officerName(book, c.officerId)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* mobile cards */}
        <ul className="divide-y md:hidden" style={{ borderColor: 'var(--calCellLine)' }}>
          {rows.map(({ c, open, owed }) => (
            <li key={c.id}>
              <button onClick={() => ui.open({ kind: 'client', clientId: c.id })} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left" style={{ opacity: c.deletedAt ? 0.6 : 1 }}>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[14px] font-semibold">
                    <span className="truncate">{c.name}</span>
                    {c.blocked && <Pill tone="red">Blocked</Pill>}
                  </span>
                  <span className="mt-0.5 block text-[11.5px]" style={{ color: 'var(--mut)' }}>
                    {c.ref} · {idCell(c.idNumber)} · {officerName(book, c.officerId)}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[12.5px] num">
                  {open ? <span className="font-semibold">{zar(owed)}</span> : <span style={{ color: 'var(--dim)' }}>—</span>}
                  <span className="block text-[10.5px]" style={{ color: 'var(--dim)' }}>{dateLabel(c.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {!rows.length && (
          <Empty>
            {q ? `No clients match “${q}”.` : view === 'archived' ? 'No archived clients.' : 'No clients on the book yet — add your first client.'}
          </Empty>
        )}
      </div>

      <p className="px-2 text-[10.5px] font-medium uppercase tracking-[0.06em]" style={{ color: 'var(--dim)' }}>
        {showPii ? 'Full PII visible — revealed for this session' : 'ID numbers masked — full PII visible only with elevated access'}
        {view === 'archived' && ' · archived clients are read-only and kept for the 5-year retention period'}
      </p>
    </>
  )
}
