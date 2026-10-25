import type { Book, Settings, TableName } from '../domain/types'
import { supabase, supabaseEnabled } from '../lib/supabase'

/**
 * Supabase persistence. One table per collection, snake_case columns; nested
 * values (schedule, expenses, contract, contract_clauses) are jsonb.
 * See supabase/schema.sql.
 */

export const remoteEnabled = supabaseEnabled

export const SQL_TABLE: Record<TableName, string> = {
  clients: 'clients',
  loans: 'loans',
  applications: 'applications',
  logbook: 'audit_log',
  petty: 'petty_cash',
  expenses: 'expenses',
  bankTx: 'bank_tx',
  employees: 'employees',
}

const snake = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

export function toRow(obj: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) out[snake(k)] = v
  return out
}

export function fromRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'updated_at' || k === 'updated_by') continue
    // numeric columns come back as strings from PostgREST
    out[camel(k)] = typeof v === 'string' && NUMERIC.has(k) ? parseFloat(v) : v
  }
  return out as T
}

const NUMERIC = new Set([
  'net_salary', 'gross_salary', 'other_income', 'principal', 'return_rate_pct', 'instalment_amount', 'collection_fee',
  'amount', 'net_income', 'approval_limit', 'default_return_rate_pct', 'default_collection_fee', 'protection_fee',
  'bank_opening_balance',
])

export async function loadRemoteBook(): Promise<Partial<Book> | null> {
  if (!supabase) return null
  const keys = Object.keys(SQL_TABLE) as TableName[]
  const results = await Promise.all(keys.map((k) => supabase!.from(SQL_TABLE[k]).select('*')))
  const failed = results.find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  const book: Partial<Book> = {}
  keys.forEach((k, i) => {
    ;(book as Record<string, unknown>)[k] = (results[i].data ?? []).map((r) => fromRow(r as Record<string, unknown>))
  })
  const s = await supabase.from('settings').select('*').eq('id', 'org').maybeSingle()
  if (s.data) {
    const { id: _id, ...rest } = fromRow<Settings & { id: string }>(s.data as Record<string, unknown>)
    void _id
    book.settings = rest as Settings
  }
  return book
}

export async function upsertRows(table: TableName, rows: object[], by: string): Promise<void> {
  if (!supabase || !rows.length) return
  const now = new Date().toISOString()
  const { error } = await supabase
    .from(SQL_TABLE[table])
    .upsert(rows.map((r) => ({ ...toRow(r), updated_at: now, updated_by: by })), { onConflict: 'id' })
  if (error) throw new Error(`${SQL_TABLE[table]}: ${error.message}`)
}

export async function saveSettings(s: Settings, by: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase
    .from('settings')
    .upsert({ id: 'org', ...toRow(s), updated_at: new Date().toISOString(), updated_by: by }, { onConflict: 'id' })
  if (error) throw new Error(`settings: ${error.message}`)
}

/** Push every row of a book (used for first upload / import). */
export async function pushWholeBook(book: Book, by: string): Promise<void> {
  for (const k of Object.keys(SQL_TABLE) as TableName[]) {
    const rows = book[k] as object[]
    for (let i = 0; i < rows.length; i += 500) await upsertRows(k, rows.slice(i, i + 500), by)
  }
  await saveSettings(book.settings, by)
}
