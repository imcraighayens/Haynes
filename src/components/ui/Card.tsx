import { clsx } from 'clsx'
import type { ReactNode } from 'react'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('surface rounded-2xl', className)}>{children}</div>
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-5 pb-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-white">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
