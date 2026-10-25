import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send } from 'lucide-react'
import { Modal, CloseButton } from '../../ui/Modal'
import { Q1Face } from '../../shell/Q1Face'
import { useAuth } from '../../store/auth'
import { useBook } from '../../store/book'
import { useUi } from '../../store/ui'
import { answer, dailyBrief, QUICK, type Q1Action, type Q1Msg } from './brain'

/** Q1 — the console assistant. Answers locally from the book; nothing leaves the browser. */
export function Q1Panel({ onClose }: { onClose: () => void }) {
  const { book, today } = useBook()
  const { user } = useAuth()
  const ui = useUi()
  const nav = useNavigate()
  const seq = useRef(1)
  const brief = () => ({ id: seq.current++, from: 'q1' as const, ...dailyBrief(book, today, user?.name ?? '') })
  const [msgs, setMsgs] = useState<Q1Msg[]>(() => [brief()])
  const [draft, setDraft] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs])

  const ask = (q: string) => {
    if (!q.trim()) return
    const reply = answer(q, book, today)
    setMsgs((m) => [...m, { id: seq.current++, from: 'me', text: q.trim() }, { id: seq.current++, from: 'q1', ...reply }])
    setDraft('')
  }

  const run = (a: Q1Action) => {
    if (typeof a === 'object') {
      if ('loanId' in a) return ui.swap({ kind: 'loan', loanId: a.loanId })
      return ui.swap({ kind: 'client', clientId: a.clientId })
    }
    if (a === 'notifications') return ui.swap({ kind: 'notifications' })
    if (a === 'newLoan') return ui.swap({ kind: 'newLoan' })
    onClose()
    if (a === 'overdue') nav('/loans?tab=overdue')
    else if (a === 'ledger') nav('/ledger')
    else nav('/loans')
  }

  return (
    <Modal onClose={onClose} size="md" bare>
      <div className="flex items-center justify-between gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid var(--modalLine)' }}>
        <div className="flex items-center gap-3">
          <Q1Face size={40} />
          <div className="leading-tight">
            <div className="text-[15px] font-bold">Q1</div>
            <div className="text-[10.5px] font-semibold tracking-[0.08em]" style={{ color: 'var(--mut)' }}>ANSWERS FROM YOUR BOOK · ON THIS DEVICE</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMsgs([brief()])} className="rounded-lg px-2.5 py-1 text-[10.5px] font-bold tracking-[0.06em]" style={{ border: '1px solid var(--line2)' }}>
            NEW
          </button>
          <CloseButton onClick={onClose} />
        </div>
      </div>

      <div className="flex min-h-[320px] flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" style={{ background: 'var(--bg)' }} aria-live="polite">
        {msgs.map((m) =>
          m.from === 'me' ? (
            <div key={m.id} className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13.5px]" style={{ background: 'var(--acc)', color: 'var(--accInk)' }}>
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="max-w-[88%]">
              <div
                className="whitespace-pre-wrap rounded-2xl rounded-bl-md px-3.5 py-3 text-[13.5px] leading-relaxed"
                style={m.alert ? { background: 'var(--redSoft)', border: '1px solid var(--red)' } : { background: 'var(--panel2)', border: '1px solid var(--line)' }}
              >
                {m.text}
              </div>
              {m.chips && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.chips.map((c) => (
                    <button key={c.label} onClick={() => run(c.action)} className="rounded-full px-3 py-1.5 text-[11px] font-bold" style={{ background: 'var(--blueSoft)', border: '1px solid var(--blue)', color: 'var(--ink)' }}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        <div ref={end} />
      </div>

      <div className="flex flex-wrap gap-2 px-4 pt-3" style={{ background: 'var(--bg)' }}>
        {QUICK.map((q) => (
          <button key={q} onClick={() => ask(q)} className="rounded-full px-3 py-1.5 text-[11.5px] font-medium transition hover:brightness-125" style={{ border: '1px solid var(--line2)', color: 'var(--ink)' }}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-2 px-4 pb-4 pt-3"
        style={{ background: 'var(--bg)' }}
        onSubmit={(e) => {
          e.preventDefault()
          ask(draft)
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about loans, clients, the bank…" className="field h-12 flex-1" aria-label="Ask Q1" autoFocus />
        <button type="submit" disabled={!draft.trim()} className="inline-flex h-12 w-12 items-center justify-center rounded-xl disabled:opacity-50" style={{ background: '#0000fe', color: '#fff' }} aria-label="Send">
          <Send size={17} />
        </button>
      </form>
    </Modal>
  )
}
