import { supabase, supabaseEnabled } from '../lib/supabase'
import type { Client, LedgerEntry, Loan, LogEntry } from './types'

/**
 * Remote persistence layer. Every function is a no-op when Supabase is not
 * configured (offline mode), so the same call sites work in both modes.
 * Writes are fire-and-forget from the UI's perspective: the local optimistic
 * update has already happened; these push the change to the database and
 * surface failures via the returned promise.
 */

export const remoteEnabled = supabaseEnabled

export async function insertClient(client: Client): Promise<void> {
  if (!remoteEnabled || !supabase) return
  const { error } = await supabase.from('clients').insert(client)
  if (error) throw new Error(`Failed to save client: ${error.message}`)
}

export async function updateClient(id: string, patch: Partial<Client>): Promise<void> {
  if (!remoteEnabled || !supabase) return
  const { error } = await supabase.from('clients').update(patch).eq('id', id)
  if (error) throw new Error(`Failed to update client: ${error.message}`)
}

export async function insertLoan(loan: Loan): Promise<void> {
  if (!remoteEnabled || !supabase) return
  const { error } = await supabase.from('loans').insert(loan)
  if (error) throw new Error(`Failed to save loan: ${error.message}`)
}

export async function updateLoan(id: string, patch: Partial<Loan>): Promise<void> {
  if (!remoteEnabled || !supabase) return
  const { error } = await supabase.from('loans').update(patch).eq('id', id)
  if (error) throw new Error(`Failed to update loan: ${error.message}`)
}

export async function deleteLoanRow(id: string): Promise<void> {
  if (!remoteEnabled || !supabase) return
  const { error } = await supabase.from('loans').delete().eq('id', id)
  if (error) throw new Error(`Failed to delete loan: ${error.message}`)
}

export async function insertLedger(entry: LedgerEntry): Promise<void> {
  if (!remoteEnabled || !supabase) return
  const { error } = await supabase.from('ledger').insert(entry)
  if (error) throw new Error(`Failed to save ledger entry: ${error.message}`)
}

export async function insertLog(entry: LogEntry): Promise<void> {
  if (!remoteEnabled || !supabase) return
  const { error } = await supabase.from('logs').insert(entry)
  if (error) throw new Error(`Failed to save log: ${error.message}`)
}

export async function deleteClientRows(ids: string[]): Promise<void> {
  if (!remoteEnabled || !supabase || ids.length === 0) return
  const { error } = await supabase.from('clients').delete().in('id', ids)
  if (error) throw new Error(`Failed to delete clients: ${error.message}`)
}

export async function deleteLoanRows(ids: string[]): Promise<void> {
  if (!remoteEnabled || !supabase || ids.length === 0) return
  const { error } = await supabase.from('loans').delete().in('id', ids)
  if (error) throw new Error(`Failed to delete loans: ${error.message}`)
}
