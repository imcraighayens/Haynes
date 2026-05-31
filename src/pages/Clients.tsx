import { useMemo, useState } from 'react'
import { Search, UserPlus, Phone, Mail, MapPin } from 'lucide-react'
import { useData } from '../context/DataContext'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { AddClientModal } from '../components/modals/AddClientModal'
import { money } from '../lib/format'

export function Clients() {
  const { data } = useData()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const enriched = useMemo(() => {
    return data.clients
      .map((c) => {
        const loans = data.loans.filter((l) => l.clientId === c.id)
        const outstanding = loans.filter((l) => l.status !== 'paid')
        return {
          ...c,
          loanCount: loans.length,
          outstandingAmount: outstanding.reduce((s, l) => s + l.returnAmount, 0),
          totalBorrowed: loans.reduce((s, l) => s + l.amount, 0),
          active: outstanding.length > 0,
        }
      })
      .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
  }, [data, query])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Clients</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {data.clients.length} registered borrowers · {enriched.filter((c) => c.active).length} active
          </p>
        </div>
        <Button icon={<UserPlus size={16} />} onClick={() => setOpen(true)}>
          Add Client
        </Button>
      </div>

      <div className="relative">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="w-full h-12 rounded-xl pl-11 pr-4 text-sm surface-muted text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {enriched.map((c) => (
          <Card key={c.id} className="p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-full bg-brand-500/15 text-brand-500 dark:text-brand-300 grid place-items-center font-semibold">
                  {c.name
                    .split(' ')
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join('')}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-white truncate">{c.name}</p>
                  <span
                    className={
                      c.active
                        ? 'text-[11px] text-green-500 font-medium'
                        : 'text-[11px] text-slate-400 font-medium'
                    }
                  >
                    {c.active ? '● Active' : '○ Inactive'}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-1.5 text-sm text-slate-500 dark:text-slate-400">
              <p className="flex items-center gap-2">
                <Phone size={14} /> {c.phone}
              </p>
              {c.email && (
                <p className="flex items-center gap-2 truncate">
                  <Mail size={14} /> {c.email}
                </p>
              )}
              {c.address && (
                <p className="flex items-center gap-2">
                  <MapPin size={14} /> {c.address}
                </p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 dark:border-white/5 pt-4 text-center">
              <div>
                <p className="text-xs text-slate-400">Loans</p>
                <p className="font-semibold text-slate-800 dark:text-white">{c.loanCount}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Borrowed</p>
                <p className="font-semibold text-slate-800 dark:text-white">{money(c.totalBorrowed)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Owing</p>
                <p className="font-semibold text-amber-500">{money(c.outstandingAmount)}</p>
              </div>
            </div>
          </Card>
        ))}
        {enriched.length === 0 && (
          <p className="col-span-full text-center text-slate-400 py-10">No clients found.</p>
        )}
      </div>

      <AddClientModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
