import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Book, TableName } from '../domain/types'
import { buildSeed } from '../domain/seed'
import { DEFAULT_SETTINGS } from '../domain/factories'
import { todayIso } from '../domain/format'
import { normalizeLoan } from '../domain/loans'
import { loadRemoteBook, pushWholeBook, remoteEnabled, saveSettings, SQL_TABLE, upsertRows } from './remote'
import { useAuth } from './auth'
import { useToast } from './toast'

const KEY = 'ledger.book.v1'

export type SyncState = { mode: 'local' | 'supabase'; status: 'idle' | 'loading' | 'saving' | 'error'; error: string | null; lastSync: string | null }

interface BookCtx {
  book: Book
  today: string
  ready: boolean
  sync: SyncState
  /** Apply a pure op. Changed rows are persisted locally and (if connected) to Supabase. */
  commit: (fn: (b: Book) => Book, toastMsg?: string) => void
  /** Replace the whole book (import / reset). Pushes everything when connected. */
  replace: (b: Book, toastMsg?: string) => Promise<void>
  reload: () => Promise<void>
}

const Ctx = createContext<BookCtx | null>(null)

function emptyBook(): Book {
  return { clients: [], loans: [], applications: [], logbook: [], petty: [], expenses: [], bankTx: [], employees: [], settings: DEFAULT_SETTINGS }
}

/** Fill any fields missing from older saves and re-derive loan state. */
export function hydrate(raw: Partial<Book>): Book {
  const base = emptyBook()
  const b = { ...base, ...raw, settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) } } as Book
  for (const k of Object.keys(SQL_TABLE) as TableName[]) if (!Array.isArray(b[k])) (b as unknown as Record<string, unknown[]>)[k] = []
  b.loans = b.loans.map((l) => normalizeLoan({ ...l, schedule: Array.isArray(l.schedule) ? l.schedule : [] }))
  b.logbook = b.logbook.slice().sort((x, y) => y.at.localeCompare(x.at))
  return b
}

function loadLocal(): Book {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return hydrate(JSON.parse(raw))
  } catch {
    /* fall through to seed */
  }
  return buildSeed()
}

function saveLocal(b: Book) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b))
  } catch {
    /* quota or private mode — the in-memory book still works */
  }
}

/** Rows whose object identity changed between two books (ops never mutate in place). */
function diff(prev: Book, next: Book) {
  const out: { table: TableName; rows: object[] }[] = []
  for (const k of Object.keys(SQL_TABLE) as TableName[]) {
    const p = prev[k] as { id: string }[], n = next[k] as { id: string }[]
    if (p === n) continue
    const byId = new Map(p.map((r) => [r.id, r]))
    const rows = n.filter((r) => byId.get(r.id) !== r)
    if (rows.length) out.push({ table: k, rows })
  }
  return { tables: out, settings: prev.settings !== next.settings }
}

export function BookProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const toast = useToast()
  const [book, setBook] = useState<Book>(() => (remoteEnabled ? emptyBook() : loadLocal()))
  const [ready, setReady] = useState(!remoteEnabled)
  const [sync, setSync] = useState<SyncState>({ mode: remoteEnabled ? 'supabase' : 'local', status: 'idle', error: null, lastSync: null })
  const bookRef = useRef(book)
  bookRef.current = book
  const byRef = useRef('—')
  byRef.current = user?.name ?? '—'

  const reload = useCallback(async () => {
    if (!remoteEnabled) {
      setBook(loadLocal())
      return
    }
    setSync((s) => ({ ...s, status: 'loading' }))
    try {
      const remote = await loadRemoteBook()
      const b = hydrate(remote ?? {})
      setBook(b)
      saveLocal(b)
      setSync((s) => ({ ...s, status: 'idle', error: null, lastSync: new Date().toISOString() }))
    } catch (e) {
      // Offline or misconfigured: fall back to the last cached copy so the book is still readable.
      setBook(loadLocalCacheOnly())
      setSync((s) => ({ ...s, status: 'error', error: String((e as Error).message ?? e) }))
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    if (remoteEnabled && user) void reload()
  }, [user, reload])

  const push = useCallback(
    async (prev: Book, next: Book) => {
      if (!remoteEnabled) return
      const d = diff(prev, next)
      if (!d.tables.length && !d.settings) return
      setSync((s) => ({ ...s, status: 'saving' }))
      try {
        for (const t of d.tables) await upsertRows(t.table, t.rows, byRef.current)
        if (d.settings) await saveSettings(next.settings, byRef.current)
        setSync((s) => ({ ...s, status: 'idle', error: null, lastSync: new Date().toISOString() }))
      } catch (e) {
        const msg = String((e as Error).message ?? e)
        setSync((s) => ({ ...s, status: 'error', error: msg }))
        toast(`Not saved to Supabase — ${msg.slice(0, 90)}`, 'error')
      }
    },
    [toast],
  )

  const commit = useCallback<BookCtx['commit']>(
    (fn, toastMsg) => {
      const prev = bookRef.current
      const next = fn(prev)
      if (next === prev) return
      bookRef.current = next
      setBook(next)
      saveLocal(next)
      void push(prev, next)
      if (toastMsg) toast(toastMsg)
    },
    [push, toast],
  )

  const replace = useCallback<BookCtx['replace']>(
    async (b, toastMsg) => {
      const next = hydrate(b)
      bookRef.current = next
      setBook(next)
      saveLocal(next)
      if (remoteEnabled) {
        setSync((s) => ({ ...s, status: 'saving' }))
        try {
          await pushWholeBook(next, byRef.current)
          setSync((s) => ({ ...s, status: 'idle', error: null, lastSync: new Date().toISOString() }))
        } catch (e) {
          const msg = String((e as Error).message ?? e)
          setSync((s) => ({ ...s, status: 'error', error: msg }))
          toast(`Upload to Supabase failed — ${msg.slice(0, 90)}`, 'error')
          return
        }
      }
      if (toastMsg) toast(toastMsg)
    },
    [toast],
  )

  // "today" rolls over at midnight without a reload
  const [today, setToday] = useState(todayIso())
  useEffect(() => {
    const t = setInterval(() => setToday(todayIso()), 60_000)
    return () => clearInterval(t)
  }, [])

  const value = useMemo(() => ({ book, today, ready, sync, commit, replace, reload }), [book, today, ready, sync, commit, replace, reload])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function loadLocalCacheOnly(): Book {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return hydrate(JSON.parse(raw))
  } catch {
    /* ignore */
  }
  return emptyBook()
}

export function useBook() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useBook outside BookProvider')
  return c
}

/** The signed-in actor for ops. */
export function useActor() {
  const { user } = useAuth()
  return useMemo(() => ({ name: user?.name ?? '—' }), [user?.name])
}

export { buildSeed }
