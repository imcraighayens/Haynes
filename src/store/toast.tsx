import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Tone = 'ok' | 'error'
interface Toast { id: number; msg: string; tone: Tone }

const Ctx = createContext<((msg: string, tone?: Tone) => void) | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((msg: string, tone: Tone = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, msg, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3200)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[300] flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-in rounded-full px-5 py-2.5 text-[12.5px] font-semibold tracking-wide"
            style={{
              background: t.tone === 'error' ? 'var(--red)' : 'var(--ink)',
              color: t.tone === 'error' ? '#fff' : 'var(--bg)',
              boxShadow: 'var(--shadow)',
            }}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast outside ToastProvider')
  return c
}
