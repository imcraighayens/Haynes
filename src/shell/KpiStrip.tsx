import { AlertTriangle, Banknote, TrendingUp, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBook } from '../store/book'
import { kpis } from '../domain/loans'
import { MONTH_NAMES, zar } from '../domain/format'

function Kpi({ bg, ink, label, value, sub, icon, onClick, glow }: { bg: string; ink: string; label: string; value: string; sub?: string; icon: ReactNode; onClick?: () => void; glow?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-[82px] items-center gap-4 rounded-[20px] px-4 text-left transition hover:-translate-y-0.5"
      style={{ background: bg, color: ink, border: '1px solid rgba(255,255,255,.14)', boxShadow: glow ?? 'var(--cardLift)' }}
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]" style={{ background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.22)' }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[10.5px] font-semibold tracking-[0.08em]" style={{ opacity: 0.85 }}>{label}</span>
        <span className="mt-1 block text-[18px] font-bold leading-tight num">{value}</span>
        {sub && <span className="block truncate text-[10px] font-medium" style={{ opacity: 0.85 }}>{sub}</span>}
      </span>
    </button>
  )
}

export function KpiStrip() {
  const { book, today } = useBook()
  const nav = useNavigate()
  const k = kpis(book, today)
  const month = `${MONTH_NAMES[+today.slice(5, 7) - 1].toUpperCase()} ${today.slice(0, 4)}`
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Kpi bg="var(--kpiBlue)" ink="#fff" label={`LOANED OUT · ${month}`} value={zar(k.loanedOutThisMonth)} icon={<Banknote size={16} />} onClick={() => nav('/loans')} />
      <Kpi bg="var(--kpiLime)" ink="#14170a" label="COLLECTION OUTSTANDING" value={zar(k.collectionOutstanding)} icon={<TrendingUp size={16} />} onClick={() => nav('/ledger')} glow="0 10px 30px -6px rgba(195,245,60,.45)" />
      <Kpi bg="var(--kpiOlive)" ink="#f5f4ee" label="ACTIVE CLIENTS" value={String(k.activeClients)} icon={<UserRound size={16} />} onClick={() => nav('/clients')} />
      <Kpi
        bg="var(--kpiRed)"
        ink="#fff"
        label="OVERDUE"
        value={zar(k.overdueAmount)}
        sub={`${k.overdueAccounts} account${k.overdueAccounts === 1 ? '' : 's'} · ${k.notUpdated} not updated`}
        icon={<AlertTriangle size={16} />}
        onClick={() => nav('/loans?tab=overdue')}
      />
    </div>
  )
}
