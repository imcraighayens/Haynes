import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * Global modal stack. Any screen can open any modal by kind; ModalHost
 * (src/features/ModalHost.tsx) renders the matching component.
 */
export type ModalSpec =
  | { kind: 'client'; clientId: string; tab?: ClientTab }
  | { kind: 'clientForm'; clientId?: string; section?: ClientTab }
  | { kind: 'contract'; clientId: string }
  | { kind: 'newLoan'; clientId?: string; applicationId?: string }
  | { kind: 'loan'; loanId: string }
  | { kind: 'loanEdit'; loanId: string }
  | { kind: 'loanStatus'; loanId: string }
  | { kind: 'settlement'; loanId: string }
  | { kind: 'bulkUpload' }
  | { kind: 'notifications' }
  | { kind: 'dueDay'; date: string }
  | { kind: 'petty' }
  | { kind: 'recon' }
  | { kind: 'application'; applicationId?: string }
  | { kind: 'confirm'; title: string; body: string; confirmLabel?: string; danger?: boolean; requireText?: string; reasonLabel?: string; onConfirm: (reason: string) => void }

export type ClientTab = 'overview' | 'loans' | 'personal' | 'employment' | 'banking' | 'affordability' | 'activity'

interface UiCtx {
  stack: ModalSpec[]
  open: (m: ModalSpec) => void
  /** Replace the top modal (e.g. hub → edit form) */
  swap: (m: ModalSpec) => void
  close: () => void
  closeAll: () => void
  /** PII is masked unless revealed for this session (and the role allows it) */
  revealed: boolean
  setRevealed: (v: boolean) => void
  navCollapsed: boolean
  setNavCollapsed: (v: boolean) => void
  /** Q1 assistant dock expanded */
  q1Open: boolean
  setQ1Open: (v: boolean) => void
}

const Ctx = createContext<UiCtx | null>(null)

export function UiProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ModalSpec[]>([])
  const [revealed, setRevealed] = useState(false)
  const [q1Open, setQ1Open] = useState(false)
  const [navCollapsed, setNavCollapsedState] = useState(() => {
    try {
      return localStorage.getItem('ledger.navCollapsed') === '1'
    } catch {
      return false
    }
  })
  const setNavCollapsed = useCallback((v: boolean) => {
    setNavCollapsedState(v)
    try {
      localStorage.setItem('ledger.navCollapsed', v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])
  const open = useCallback((m: ModalSpec) => setStack((s) => [...s, m]), [])
  const swap = useCallback((m: ModalSpec) => setStack((s) => [...s.slice(0, -1), m]), [])
  const close = useCallback(() => setStack((s) => s.slice(0, -1)), [])
  const closeAll = useCallback(() => setStack([]), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStack((s) => s.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo(
    () => ({ stack, open, swap, close, closeAll, revealed, setRevealed, navCollapsed, setNavCollapsed, q1Open, setQ1Open }),
    [stack, open, swap, close, closeAll, revealed, navCollapsed, setNavCollapsed, q1Open],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUi() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useUi outside UiProvider')
  return c
}
