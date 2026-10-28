import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowUp, Mic, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { useAuth } from '../../store/auth'
import { useBook } from '../../store/book'
import { useUi } from '../../store/ui'
import { askQ1, offlineReason, q1Source, Q1Unavailable, type Q1Source } from './ask'
import { buildQ1Context, type Q1ActionSpec, type Q1Turn } from './protocol'
import { answer as offlineAnswer, dailyBrief, type Q1Action } from './brain'
import { Q1Orb } from './Q1Robot'

/**
 * Q1 — the floating assistant from the "Q1 Assistant Button" spec: a 60px
 * glowing orb bottom-right that expands into a dark-glass bar (type or speak,
 * en-ZA), with a chat sheet above it. Answers come from Claude (see ask.ts);
 * offline answers are labelled as such.
 */

type Chip = { label: string; local?: Q1Action; ai?: Q1ActionSpec }
interface Msg {
  id: number
  from: 'me' | 'q1'
  text: string
  alert?: boolean
  chips?: Chip[]
  note?: string
}

const SOURCE_LABEL: Record<Q1Source, string> = {
  preview: 'Claude · your account',
  server: 'Claude Opus 5.5',
  offline: 'Offline answers · AI not connected',
}

type SR = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
const SpeechRec = (): (new () => SR) | null =>
  typeof window === 'undefined' ? null : ((window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition ?? null)

const PAGE_OF: Record<string, string> = { '/': 'dashboard', '/loans': 'loans', '/applications': 'applications', '/clients': 'clients', '/logbook': 'logbook', '/ledger': 'ledger', '/petty-cash': 'petty' }

export function Q1Dock() {
  const { user } = useAuth()
  const { book, today } = useBook()
  const ui = useUi()
  const nav = useNavigate()
  const loc = useLocation()
  const open = ui.q1Open
  const [draft, setDraft] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [hover, setHover] = useState(false)
  const [listening, setListening] = useState(false)
  const [source, setSource] = useState<Q1Source>('offline')
  const [speak, setSpeak] = useState(() => {
    try {
      return localStorage.getItem('ledger.q1.speak') === '1'
    } catch {
      return false
    }
  })
  const input = useRef<HTMLInputElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const rec = useRef<SR | null>(null)
  const ctl = useRef<AbortController | null>(null)
  const idRef = useRef(1)
  const srOk = useMemo(() => !!SpeechRec(), [])

  useEffect(() => {
    void q1Source().then(setSource)
  }, [open])

  // Opening for the first time shows today's brief — computed locally, no AI call.
  useEffect(() => {
    if (!open || !user) return
    setMsgs((m) => {
      if (m.length) return m
      const b = dailyBrief(book, today, user.name)
      return [{ id: idRef.current++, from: 'q1', text: b.text, alert: b.alert, chips: b.chips?.map((c) => ({ label: c.label, local: c.action })) }]
    })
    window.setTimeout(() => input.current?.focus(), 120)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sheet.current?.scrollTo({ top: sheet.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, busy])

  useEffect(() => {
    try {
      localStorage.setItem('ledger.q1.speak', speak ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (!speak) window.speechSynthesis?.cancel()
  }, [speak])

  const say = useCallback(
    (text: string) => {
      if (!speak || !('speechSynthesis' in window)) return
      const u = new SpeechSynthesisUtterance(text.replace(/•/g, '').replace(/\bR (\d)/g, 'R$1'))
      u.lang = 'en-ZA'
      const v = window.speechSynthesis.getVoices().find((x) => x.lang === 'en-ZA') ?? window.speechSynthesis.getVoices().find((x) => x.lang.startsWith('en'))
      if (v) u.voice = v
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    },
    [speak],
  )

  const close = () => {
    ctl.current?.abort()
    try {
      rec.current?.stop()
    } catch {
      /* ignore */
    }
    ui.setQ1Open(false)
    setDraft('')
  }

  const runChip = (c: Chip) => {
    const go = (path: string) => {
      close()
      nav(path)
    }
    if (c.local) {
      const a = c.local
      if (a === 'notifications') return (ui.setQ1Open(false), ui.open({ kind: 'notifications' }))
      if (a === 'overdue') return go('/loans?tab=overdue')
      if (a === 'ledger') return go('/ledger')
      if (a === 'loans') return go('/loans')
      if (a === 'newLoan') return (ui.setQ1Open(false), ui.open({ kind: 'newLoan' }))
      if ('loanId' in a) return (ui.setQ1Open(false), ui.open({ kind: 'loan', loanId: a.loanId }))
      if ('clientId' in a) return (ui.setQ1Open(false), ui.open({ kind: 'client', clientId: a.clientId }))
      return
    }
    const a = c.ai!
    const loanBy = (ref: string | null) => book.loans.find((l) => !l.deletedAt && l.ref.toUpperCase() === (ref ?? '').toUpperCase())
    const clientBy = (ref: string | null) => book.clients.find((x) => !x.deletedAt && (x.ref.toUpperCase() === (ref ?? '').toUpperCase() || x.name.toLowerCase() === (ref ?? '').toLowerCase()))
    if (a.kind === 'open_loan') {
      const l = loanBy(a.ref)
      if (l) return (ui.setQ1Open(false), ui.open({ kind: 'loan', loanId: l.id }))
    }
    if (a.kind === 'open_client') {
      const x = clientBy(a.ref)
      if (x) return (ui.setQ1Open(false), ui.open({ kind: 'client', clientId: x.id }))
    }
    if (a.kind === 'new_loan') return (ui.setQ1Open(false), ui.open({ kind: 'newLoan', clientId: clientBy(a.ref)?.id }))
    if (a.kind === 'notifications') return (ui.setQ1Open(false), ui.open({ kind: 'notifications' }))
    if (a.kind === 'import_report') return (ui.setQ1Open(false), ui.open({ kind: 'recon' }))
    const page = a.page ?? 'dashboard'
    const path = { dashboard: '/', loans: '/loans', overdue: '/loans?tab=overdue', clients: '/clients', applications: '/applications', logbook: '/logbook', ledger: '/ledger', petty: '/petty-cash' }[page]
    return go(path)
  }

  const submit = async (text: string) => {
    const q = text.trim()
    if (!q || busy || !user) return
    setDraft('')
    const mine: Msg = { id: idRef.current++, from: 'me', text: q }
    setMsgs((m) => [...m, mine])
    setBusy(true)
    const history: Q1Turn[] = msgs
      .slice(1) // the opening brief is local, not part of the AI conversation
      .map((m) => ({ role: m.from === 'me' ? ('user' as const) : ('assistant' as const), content: m.text }))
    ctl.current = new AbortController()
    const ctx = buildQ1Context(book, today, user, PAGE_OF[loc.pathname] ?? loc.pathname)
    try {
      const r = await askQ1(q, history, ctx, ctl.current.signal)
      setSource(r.source)
      setMsgs((m) => [...m, { id: idRef.current++, from: 'q1', text: r.answer, chips: r.actions.map((a) => ({ label: a.label, ai: a })) }])
      say(r.answer)
    } catch (e) {
      if ((e as { code?: string }).code === 'cancelled' || (e as Error).name === 'AbortError') return
      if (e instanceof Q1Unavailable) {
        setSource('offline')
        const r = offlineAnswer(q, book, today)
        setMsgs((m) => [...m, { id: idRef.current++, from: 'q1', text: r.text, alert: r.alert, chips: r.chips?.map((c) => ({ label: c.label, local: c.action })), note: e.message || offlineReason() }])
        say(r.text)
      } else {
        setMsgs((m) => [...m, { id: idRef.current++, from: 'q1', text: (e as Error).message || 'Q1 could not answer just now.', alert: true }])
      }
    } finally {
      setBusy(false)
    }
  }

  const toggleMic = () => {
    const R = SpeechRec()
    if (!R) return
    if (listening) {
      try {
        rec.current?.stop()
      } catch {
        /* ignore */
      }
      return
    }
    const r = new R()
    rec.current = r
    r.lang = 'en-ZA'
    r.interimResults = true
    r.maxAlternatives = 1
    let fin = ''
    let live = ''
    r.onresult = (e) => {
      let t = ''
      for (let i = 0; i < e.results.length; i++) {
        t += e.results[i][0].transcript
        if (e.results[i].isFinal) fin = t
      }
      live = t
      setDraft(t)
    }
    r.onerror = () => setListening(false)
    r.onend = () => {
      setListening(false)
      void submit(fin || live)
    }
    setListening(true)
    setDraft('')
    try {
      r.start()
    } catch {
      setListening(false)
    }
  }

  const onOrb = () => {
    if (!open) return ui.setQ1Open(true)
    if (draft.trim()) return void submit(draft)
    close()
  }

  if (!user || ui.stack.length) return null
  const has = !!draft.trim()
  const width = open ? 'min(460px, calc(100vw - 36px))' : '60px'

  return (
    <div className="q1-font no-print fixed z-[80] flex flex-col items-end gap-3" style={{ right: 18, bottom: 40, width }}>
      {open && msgs.length > 0 && (
        <div
          role="log"
          aria-live="polite"
          aria-label="Q1 conversation"
          className="modal-in flex w-full flex-col overflow-hidden"
          style={{ maxHeight: 'min(62vh, 560px)', borderRadius: 24, border: '1.5px solid #3A4BFF', background: 'rgba(14,15,19,.9)', backdropFilter: 'blur(26px) saturate(180%)', WebkitBackdropFilter: 'blur(26px) saturate(180%)', boxShadow: '0 0 0 1px rgba(58,75,255,.35),0 0 14px rgba(40,60,255,.45),0 28px 48px -12px rgba(0,0,0,.6)' }}
        >
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3" style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-white">Q1</div>
              <div className="flex items-center gap-1.5 text-[10.5px]" style={{ color: source === 'offline' ? '#FDD10D' : '#9fb0ff' }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: source === 'offline' ? '#FDD10D' : '#39FF88' }} />
                {SOURCE_LABEL[source]}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {'speechSynthesis' in window && (
                <button onClick={() => setSpeak((s) => !s)} className="q1-press inline-flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10" aria-label={speak ? 'Stop reading answers aloud' : 'Read answers aloud'} title={speak ? 'Reading answers aloud' : 'Read answers aloud'}>
                  {speak ? <Volume2 size={16} /> : <VolumeX size={16} />}
                </button>
              )}
              <button onClick={() => setMsgs([])} className="q1-press inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-bold tracking-[0.06em] text-white/80 hover:bg-white/10" aria-label="New conversation">
                <RotateCcw size={13} /> NEW
              </button>
            </div>
          </div>
          <div ref={sheet} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
            {msgs.map((m) =>
              m.from === 'me' ? (
                <div key={m.id} className="ml-10 self-end whitespace-pre-wrap rounded-[18px] rounded-br-[6px] px-3.5 py-2 text-[14px] leading-snug" style={{ background: '#FDD10D', color: '#0B0620' }}>
                  {m.text}
                </div>
              ) : (
                <div key={m.id} className="mr-6 flex flex-col items-start gap-1.5 self-start">
                  <div className="whitespace-pre-wrap rounded-[18px] rounded-bl-[6px] px-3.5 py-2.5 text-[14px] leading-relaxed text-white" style={{ background: 'rgba(255,255,255,.07)', border: `1px solid ${m.alert ? 'rgba(255,90,79,.7)' : 'rgba(255,255,255,.1)'}` }}>
                    {m.text}
                  </div>
                  {m.note && <div className="px-1 text-[10.5px]" style={{ color: '#FDD10D' }}>{m.note}</div>}
                  {!!m.chips?.length && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.chips.map((c, i) => (
                        <button key={i} onClick={() => runChip(c)} className="q1-press rounded-full px-3 py-1.5 text-[11.5px] font-bold" style={{ border: '1px solid #3A4BFF', color: '#c9d2ff', background: 'rgba(58,75,255,.18)' }}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
            {busy && <div className="q1-thinking self-start px-1 text-[13px] font-medium">Q1 is thinking…</div>}
          </div>
        </div>
      )}

      <div
        className="flex items-center"
        style={{
          width: '100%', height: 60, boxSizing: 'border-box', border: '1.5px solid #3A4BFF', borderRadius: 30, background: 'rgba(14,15,19,.82)',
          backdropFilter: 'blur(26px) saturate(180%)', WebkitBackdropFilter: 'blur(26px) saturate(180%)', gap: 8, padding: open ? '0 6px 0 20px' : '0 6px',
          overflow: 'hidden', isolation: 'isolate',
          boxShadow: '0 0 0 1px rgba(58,75,255,.35),0 0 14px rgba(40,60,255,.65),0 0 32px rgba(40,60,255,.35),0 1px 0 rgba(255,255,255,.25) inset,0 -2px 6px rgba(0,0,0,.35) inset,0 2px 4px rgba(0,0,0,.25),0 10px 18px -4px rgba(0,0,0,.35),0 28px 48px -12px rgba(0,0,0,.55)',
          animation: open ? 'none' : 'q-float 4.2s ease-in-out infinite',
          transition: 'padding .48s cubic-bezier(.22,1,.36,1)',
        }}
      >
        {open && (
          <input
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit(draft)
              if (e.key === 'Escape') close()
            }}
            placeholder={listening ? 'Listening…' : 'Ask Q1 anything'}
            aria-label="Question for Q1"
            className="min-w-0 flex-1 border-0 bg-transparent text-white outline-none placeholder:text-white/50"
            style={{ fontSize: 16 }}
          />
        )}
        {open && srOk && (listening || !has) && (
          <button onClick={toggleMic} aria-label={listening ? 'Stop listening' : 'Speak'} className="q1-press grid h-10 w-10 flex-none place-items-center rounded-full" style={{ background: listening ? '#FDD10D' : 'rgba(255,255,255,.08)', color: listening ? '#0B0620' : '#fff', animation: listening ? 'q-mic-pulse 1.1s cubic-bezier(.33,1,.68,1) infinite' : 'none' }}>
            <Mic size={18} />
          </button>
        )}
        {open && has && (
          <button onClick={() => void submit(draft)} aria-label="Send" disabled={busy} className="q1-press grid h-10 w-10 flex-none place-items-center rounded-full disabled:opacity-50" style={{ background: '#FDD10D', color: '#0B0620', boxShadow: '0 4px 12px -4px rgba(253,209,13,.6)' }}>
            <ArrowUp size={18} strokeWidth={2.4} />
          </button>
        )}
        <button onClick={onOrb} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)} aria-label={open ? (has ? 'Send' : 'Close Q1') : 'Ask Q1'} aria-expanded={open} className="q1-press mx-1 flex-none rounded-full" style={{ background: 'none', border: 0, padding: 0 }}>
          <Q1Orb size={40} hover={hover} thinking={busy} halo={!open} />
        </button>
      </div>
    </div>
  )
}
