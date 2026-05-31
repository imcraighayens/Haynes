import { useMemo } from 'react'
import { ArrowDownLeft, ArrowUpRight, Wallet, TrendingUp, TrendingDown } from 'lucide-react'
import { clsx } from 'clsx'
import { useData } from '../context/DataContext'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { money, fmtDate } from '../lib/format'
import type { LedgerType } from '../data/types'

const typeLabels: Record<LedgerType, string> = {
  loan_out: 'Loan Out',
  repayment: 'Repayment',
  petty_cash: 'Petty Cash',
  capital: 'Capital',
  expense: 'Expense',
}

const typeStyles: Record<LedgerType, string> = {
  loan_out: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  repayment: 'bg-green-500/15 text-green-600 dark:text-green-400',
  petty_cash: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  capital: 'bg-brand-500/15 text-brand-600 dark:text-brand-300',
  expense: 'bg-red-500/15 text-red-600 dark:text-red-400',
}

export function Ledger() {
  const { data } = useData()

  const { inflow, outflow, balance } = useMemo(() => {
    let inflow = 0
    let outflow = 0
    data.ledger.forEach((e) => (e.amount >= 0 ? (inflow += e.amount) : (outflow += e.amount)))
    return { inflow, outflow: Math.abs(outflow), balance: inflow + outflow }
  }, [data.ledger])

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">Ledger</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Every movement of money through your business.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Inflow" value={money(inflow)} tone="green" icon={<TrendingUp size={20} />} />
        <StatCard label="Total Outflow" value={money(outflow)} tone="red" icon={<TrendingDown size={20} />} />
        <StatCard
          label="Net Balance"
          value={money(balance)}
          tone={balance >= 0 ? 'brand' : 'red'}
          icon={<Wallet size={20} />}
        />
      </div>

      <Card className="p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-3 px-4 font-medium">Date</th>
                <th className="py-3 px-4 font-medium">Description</th>
                <th className="py-3 px-4 font-medium">Type</th>
                <th className="py-3 px-4 font-medium">Reference</th>
                <th className="py-3 px-4 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.ledger.map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                >
                  <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="py-3.5 px-4 text-slate-800 dark:text-white">{e.description}</td>
                  <td className="py-3.5 px-4">
                    <span className={clsx('rounded-full px-2.5 py-1 text-xs font-medium', typeStyles[e.type])}>
                      {typeLabels[e.type]}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-400 text-xs">{e.reference}</td>
                  <td
                    className={clsx(
                      'py-3.5 px-4 text-right font-semibold whitespace-nowrap',
                      e.amount >= 0 ? 'text-green-500' : 'text-red-500',
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {e.amount >= 0 ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                      {money(Math.abs(e.amount), true)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
