import { useMemo, useState } from 'react'
import { Banknote, Wallet } from 'lucide-react'
import { useData } from '../context/DataContext'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { StatCard } from '../components/ui/StatCard'
import { LogPettyCashModal } from '../components/modals/LogPettyCashModal'
import { money, fmtDate } from '../lib/format'

export function PettyCash() {
  const { data } = useData()
  const [open, setOpen] = useState(false)

  const entries = useMemo(() => data.ledger.filter((e) => e.type === 'petty_cash'), [data.ledger])
  const total = useMemo(() => entries.reduce((s, e) => s + Math.abs(e.amount), 0), [entries])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Petty Cash</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Track small operational cash expenses.</p>
        </div>
        <Button icon={<Banknote size={16} />} onClick={() => setOpen(true)}>
          Log Petty Cash
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Total Petty Cash Spent" value={money(total)} tone="violet" icon={<Wallet size={20} />} />
        <StatCard label="Entries Logged" value={String(entries.length)} tone="brand" icon={<Banknote size={20} />} />
      </div>

      <Card className="p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-3 px-4 font-medium">Date</th>
                <th className="py-3 px-4 font-medium">Description</th>
                <th className="py-3 px-4 font-medium">Reference</th>
                <th className="py-3 px-4 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                >
                  <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="py-3.5 px-4 text-slate-800 dark:text-white">{e.description}</td>
                  <td className="py-3.5 px-4 text-slate-400 text-xs">{e.reference}</td>
                  <td className="py-3.5 px-4 text-right font-semibold text-red-500 whitespace-nowrap">
                    {money(Math.abs(e.amount), true)}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-slate-400">
                    No petty cash logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <LogPettyCashModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
