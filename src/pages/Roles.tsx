import { ShieldCheck, RotateCcw } from 'lucide-react'
import { clsx } from 'clsx'
import { useData } from '../context/DataContext'
import { Card, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import type { Role } from '../data/types'

const roleStyles: Record<Role, string> = {
  admin: 'bg-brand-500/15 text-brand-600 dark:text-brand-300',
  manager: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  agent: 'bg-green-500/15 text-green-600 dark:text-green-400',
  viewer: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
}

const permissionMatrix: { feature: string; admin: boolean; manager: boolean; agent: boolean; viewer: boolean }[] = [
  { feature: 'View dashboard', admin: true, manager: true, agent: true, viewer: true },
  { feature: 'Issue loans', admin: true, manager: true, agent: true, viewer: false },
  { feature: 'Mark repayments', admin: true, manager: true, agent: true, viewer: false },
  { feature: 'Add / edit clients', admin: true, manager: true, agent: true, viewer: false },
  { feature: 'Delete loans', admin: true, manager: true, agent: false, viewer: false },
  { feature: 'Manage ledger', admin: true, manager: true, agent: false, viewer: false },
  { feature: 'Manage team & roles', admin: true, manager: false, agent: false, viewer: false },
]

export function Roles() {
  const { data, reset } = useData()

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Roles &amp; Permissions</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage who can do what across the platform.</p>
        </div>
        <Button
          variant="outline"
          icon={<RotateCcw size={16} />}
          onClick={() => {
            if (confirm('Reset all dashboard data back to the seed sample? This clears local changes.')) reset()
          }}
        >
          Reset demo data
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Team Members" subtitle={`${data.team.length} members`} />
          <div className="px-5 pb-5 space-y-3">
            {data.team.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-xl surface-muted p-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-brand-500/15 text-brand-500 dark:text-brand-300 grid place-items-center text-sm font-semibold">
                    {m.name
                      .split(' ')
                      .slice(0, 2)
                      .map((n) => n[0])
                      .join('')}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-white truncate">{m.name}</p>
                    <p className="text-xs text-slate-400 truncate">{m.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={clsx('rounded-full px-2.5 py-1 text-xs font-medium capitalize', roleStyles[m.role])}>
                    {m.role}
                  </span>
                  <span
                    className={clsx(
                      'h-2 w-2 rounded-full',
                      m.active ? 'bg-green-500' : 'bg-slate-400',
                    )}
                    title={m.active ? 'Active' : 'Inactive'}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Permission Matrix" subtitle="Capabilities per role" />
          <div className="px-5 pb-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 text-left font-medium">Feature</th>
                  <th className="py-2 font-medium">Admin</th>
                  <th className="py-2 font-medium">Mgr</th>
                  <th className="py-2 font-medium">Agent</th>
                  <th className="py-2 font-medium">Viewer</th>
                </tr>
              </thead>
              <tbody>
                {permissionMatrix.map((row) => (
                  <tr key={row.feature} className="border-t border-slate-100 dark:border-white/5">
                    <td className="py-2.5 text-left text-slate-700 dark:text-slate-200">{row.feature}</td>
                    {(['admin', 'manager', 'agent', 'viewer'] as const).map((r) => (
                      <td key={r} className="py-2.5 text-center">
                        {row[r] ? (
                          <ShieldCheck size={16} className="inline text-green-500" />
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
