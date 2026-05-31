import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PieChart as PieIcon,
  Users,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Wallet,
  PlusCircle,
  UserPlus,
  Banknote,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from 'recharts'
import { useData } from '../context/DataContext'
import { useTheme } from '../context/ThemeContext'
import { computeMetrics, monthlySeries, statusBreakdown } from '../lib/metrics'
import { StatCard } from '../components/ui/StatCard'
import { Card, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { LoanTable } from '../components/loans/LoanTable'
import { money, compactMoney, fmtDateTime } from '../lib/format'
import { NewLoanModal } from '../components/modals/NewLoanModal'
import { AddClientModal } from '../components/modals/AddClientModal'
import { LogPettyCashModal } from '../components/modals/LogPettyCashModal'

export function Dashboard() {
  const { data } = useData()
  const { theme } = useTheme()
  const metrics = useMemo(() => computeMetrics(data), [data])
  const series = useMemo(() => monthlySeries(data.loans), [data.loans])
  const breakdown = useMemo(() => statusBreakdown(data.loans), [data.loans])

  const [newLoan, setNewLoan] = useState(false)
  const [addClient, setAddClient] = useState(false)
  const [pettyCash, setPettyCash] = useState(false)

  const axisColor = theme === 'dark' ? '#64748b' : '#94a3b8'
  const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'

  return (
    <div className="space-y-6">
      {/* Quick actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Welcome back, Ecoloan 👋</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Here's what's happening with your loan book today.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={<Banknote size={16} />} onClick={() => setPettyCash(true)}>
            Log Petty Cash
          </Button>
          <Button variant="secondary" icon={<UserPlus size={16} />} onClick={() => setAddClient(true)}>
            Add Client
          </Button>
          <Button icon={<PlusCircle size={16} />} onClick={() => setNewLoan(true)}>
            New Loan
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total Loans" value={String(metrics.totalLoans)} tone="brand" icon={<PieIcon size={20} />} />
        <StatCard label="Active Clients" value={String(metrics.activeClients)} tone="violet" icon={<Users size={20} />} />
        <StatCard
          label="Total Loaned Out"
          value={money(metrics.totalLoanedOut)}
          tone="amber"
          icon={<TrendingUp size={20} />}
        />
        <StatCard
          label="Expected Return"
          value={money(metrics.expectedReturn)}
          tone="green"
          icon={<TrendingUp size={20} />}
          delta={{ value: `${money(metrics.expectedProfit)} profit`, up: true }}
        />
        <StatCard
          label="Overdue Amount"
          value={money(metrics.overdueAmount)}
          tone="red"
          icon={metrics.overdueAmount > 0 ? <AlertTriangle size={20} /> : <TrendingDown size={20} />}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Disbursed vs Collected" subtitle="Last 6 months (ZAR)" />
          <div className="h-64 px-2 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="disb" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3366ff" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#3366ff" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="coll" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="label" stroke={axisColor} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  stroke={axisColor}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => compactMoney(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: theme === 'dark' ? '#0d1430' : '#fff',
                    border: '1px solid rgba(127,127,127,0.2)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => money(v)}
                />
                <Area type="monotone" dataKey="disbursed" name="Disbursed" stroke="#3366ff" fill="url(#disb)" strokeWidth={2} />
                <Area type="monotone" dataKey="collected" name="Collected" stroke="#22c55e" fill="url(#coll)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Loan Status" subtitle="Distribution across the book" />
          <div className="h-64 flex flex-col items-center justify-center px-4 pb-4">
            <ResponsiveContainer width="100%" height="80%">
              <PieChart>
                <Pie data={breakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                  {breakdown.map((s) => (
                    <Cell key={s.name} fill={s.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: theme === 'dark' ? '#0d1430' : '#fff',
                    border: '1px solid rgba(127,127,127,0.2)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-3">
              {breakdown.map((s) => (
                <div key={s.name} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  {s.name} ({s.value})
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Secondary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Collected This Month"
          value={money(metrics.collectedThisMonth)}
          tone="green"
          icon={<Wallet size={20} />}
        />
        <StatCard
          label="Outstanding Principal"
          value={money(metrics.outstanding)}
          tone="amber"
          icon={<TrendingUp size={20} />}
        />
        <StatCard label="Repayment Rate" value={`${metrics.repaymentRate}%`} tone="brand" icon={<PieIcon size={20} />} />
      </div>

      {/* Recent loans + activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent Loans"
            subtitle="Latest loan activity"
            action={
              <Link to="/loans">
                <Button variant="ghost" size="sm">
                  View all →
                </Button>
              </Link>
            }
          />
          <div className="px-3 pb-4">
            <LoanTable compact />
          </div>
        </Card>

        <Card>
          <CardHeader title="Activity Feed" subtitle="What's been happening" />
          <div className="px-5 pb-5 space-y-4">
            {data.logs.slice(0, 7).map((log) => (
              <div key={log.id} className="flex gap-3">
                <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 dark:text-slate-200">{log.detail}</p>
                  <p className="text-[11px] text-slate-400">{fmtDateTime(log.date)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <NewLoanModal open={newLoan} onClose={() => setNewLoan(false)} />
      <AddClientModal open={addClient} onClose={() => setAddClient(false)} />
      <LogPettyCashModal open={pettyCash} onClose={() => setPettyCash(false)} />
    </div>
  )
}
