import { Menu, Moon, Sun, Bell } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'

export function Topbar({ onMenu, title }: { onMenu: () => void; title: string }) {
  const { theme, toggle } = useTheme()
  return (
    <header className="gradient-header relative">
      <div className="flex items-center justify-between gap-4 px-4 sm:px-6 h-16">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onMenu}
            className="lg:hidden text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
          >
            <Menu size={22} />
          </button>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold text-slate-800 dark:text-white truncate">{title}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-300/70 hidden sm:block">
              Monitor and manage your loan service operations
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:block text-right mr-1">
            <p className="text-sm font-medium text-slate-800 dark:text-white">Ecoloan Dev</p>
            <p className="text-xs text-slate-400">ecoakcess@mail.com</p>
          </div>
          <button className="relative h-9 w-9 grid place-items-center rounded-full surface-muted text-slate-500 dark:text-slate-300">
            <Bell size={17} />
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-red-500" />
          </button>
          <button
            onClick={toggle}
            className="h-9 w-9 grid place-items-center rounded-full surface-muted text-slate-500 dark:text-slate-300"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </div>
    </header>
  )
}
