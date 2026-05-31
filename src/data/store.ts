import type { DashboardData } from './types'
import { seedData } from './seed'
import { supabase, supabaseEnabled } from '../lib/supabase'

const KEY = 'evolt.dashboard.v2'

/** Local (offline) persistence ------------------------------------------------ */
export function loadLocal(): DashboardData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as DashboardData
  } catch {
    /* ignore */
  }
  const fresh = structuredClone(seedData)
  saveLocal(fresh)
  return fresh
}

export function saveLocal(data: DashboardData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* ignore quota errors */
  }
}

export function resetLocal(): DashboardData {
  const fresh = structuredClone(seedData)
  saveLocal(fresh)
  return fresh
}

/** Supabase (online) hydration ----------------------------------------------- */
export async function loadRemote(): Promise<DashboardData | null> {
  if (!supabaseEnabled || !supabase) return null
  try {
    const [clients, loans, ledger, logs, team] = await Promise.all([
      supabase.from('clients').select('*'),
      supabase.from('loans').select('*'),
      supabase.from('ledger').select('*'),
      supabase.from('logs').select('*'),
      supabase.from('team').select('*'),
    ])
    if (clients.error || loans.error) return null
    return {
      clients: clients.data ?? [],
      loans: loans.data ?? [],
      ledger: ledger.data ?? [],
      logs: logs.data ?? [],
      team: team.data ?? [],
    } as DashboardData
  } catch {
    return null
  }
}

export const usingRemote = supabaseEnabled
