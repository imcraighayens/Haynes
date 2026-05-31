import { useState } from 'react'
import { User, Percent, Database, Trash2, RotateCcw, Save, ShieldAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { Card, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { inputClass } from '../components/ui/Modal'
import { loadSettings, saveSettings } from '../lib/settings'

export function Settings() {
  const { user, updateProfile } = useAuth()
  const { data, clearSampleData, reset, remote } = useData()
  const toast = useToast()

  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [settings, setSettings] = useState(loadSettings)

  const isAdmin = user?.role === 'admin'
  const paidCount = data.loans.filter((l) => l.status === 'paid').length
  const activeCount = data.loans.length - paidCount

  function saveProfile() {
    updateProfile({ name, email })
    toast('Profile updated')
  }

  function savePrefs() {
    saveSettings(settings)
    toast('Preferences saved')
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">Settings</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Manage your profile, preferences and data.</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader title="Profile" subtitle="Your account details" />
        <div className="px-5 pb-5 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Display name</span>
            <div className="relative mt-1.5">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={inputClass + ' pl-9'} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Email</span>
            <input className={inputClass + ' mt-1.5'} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-300 px-2.5 py-1 text-xs font-medium capitalize">
              {user?.role} role
            </span>
          </div>
          <Button icon={<Save size={16} />} onClick={saveProfile}>
            Save profile
          </Button>
        </div>
      </Card>

      {/* Preferences */}
      <Card>
        <CardHeader title="Lending preferences" subtitle="Defaults applied to new loans" />
        <div className="px-5 pb-5 space-y-4">
          <label className="block max-w-xs">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Default interest rate (%)</span>
            <div className="relative mt-1.5">
              <Percent size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="number"
                min={0}
                className={inputClass + ' pl-9'}
                value={settings.defaultInterestRate}
                onChange={(e) => setSettings((s) => ({ ...s, defaultInterestRate: Number(e.target.value) }))}
              />
            </div>
          </label>
          <Button icon={<Save size={16} />} onClick={savePrefs}>
            Save preferences
          </Button>
        </div>
      </Card>

      {/* Data management — admin only */}
      <Card>
        <CardHeader
          title="Data management"
          subtitle="Clean up or reset your dashboard data"
          action={
            <span className="flex items-center gap-1.5 text-xs text-amber-500">
              <ShieldAlert size={14} /> Admin only
            </span>
          }
        />
        <div className="px-5 pb-5 space-y-4">
          {!isAdmin && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              You need the admin role to manage data.
            </p>
          )}

          <div className="grid sm:grid-cols-3 gap-3">
            <div className="surface-muted rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-slate-800 dark:text-white">{data.loans.length}</p>
              <p className="text-xs text-slate-400">Total loans</p>
            </div>
            <div className="surface-muted rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-green-500">{activeCount}</p>
              <p className="text-xs text-slate-400">Active (real)</p>
            </div>
            <div className="surface-muted rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-500">{paidCount}</p>
              <p className="text-xs text-slate-400">Paid / sample</p>
            </div>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-start gap-3">
              <Trash2 size={18} className="text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800 dark:text-white">Remove sample data</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Deletes the {paidCount} paid sample loan(s) and any clients with no active loans, keeping only the{' '}
                  {activeCount} real issued loans on the street. Capital, expenses and petty cash are preserved.
                </p>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                variant="danger"
                size="sm"
                disabled={!isAdmin || paidCount === 0}
                icon={<Trash2 size={15} />}
                onClick={() => {
                  if (confirm(`Remove ${paidCount} sample loan(s) and keep only active loans?`)) clearSampleData()
                }}
              >
                Remove {paidCount} sample loan(s)
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-white/5 p-4">
            <div className="flex items-start gap-3">
              <RotateCcw size={18} className="text-slate-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800 dark:text-white">Reset to demo data</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Restores the original seeded sample set. Useful for demos.
                </p>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                disabled={!isAdmin}
                icon={<RotateCcw size={15} />}
                onClick={() => {
                  if (confirm('Reset all data back to the seeded sample set?')) reset()
                }}
              >
                Reset demo data
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Database size={14} />
            {remote ? (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Connected to Supabase — changes persist to the database.
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Local mode — data is stored in your browser. Set Supabase env vars for shared storage.
              </span>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
