import { useData } from '../context/DataContext'
import { Card } from '../components/ui/Card'
import { fmtDateTime } from '../lib/format'
import { Activity } from 'lucide-react'

export function Logbook() {
  const { data } = useData()
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">Activity Logbook</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">A complete audit trail of actions taken.</p>
      </div>

      <Card className="p-5">
        <div className="relative pl-6">
          <div className="absolute left-[9px] top-2 bottom-2 w-px bg-slate-200 dark:bg-white/10" />
          <div className="space-y-6">
            {data.logs.map((log) => (
              <div key={log.id} className="relative">
                <div className="absolute -left-[22px] top-1 h-4 w-4 rounded-full border-2 border-white dark:border-[#0d1430] bg-brand-500 grid place-items-center">
                  <Activity size={8} className="text-white" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800 dark:text-white">{log.action}</span>
                  <span className="text-xs text-slate-400">· {log.actor}</span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">{log.detail}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{fmtDateTime(log.date)}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}
