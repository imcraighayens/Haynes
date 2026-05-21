'use client'
import { useApp } from '@/contexts/AppContext'
import StatusBar from '@/components/ui/StatusBar'

export default function BorrowScreen() {
  const { goto, borrowAmt, setBorrowAmt, showToast, setConfirmData } = useApp()

  const val = parseInt(borrowAmt) || 0
  const interest = Math.round(val * 0.35)
  const total = val + interest

  const nk = (v: string) => {
    const next = borrowAmt === '0' ? v : borrowAmt + v
    if (parseInt(next) > 3500) { showToast('Max credit is R3,500'); return }
    if (next.length > 5) return
    setBorrowAmt(next)
  }

  const nd = () => setBorrowAmt(borrowAmt.slice(0, -1))

  const doBorrow = () => {
    if (val < 100) { showToast('Minimum borrow amount is R100'); return }
    if (val > 3500) { showToast('Maximum credit is R3,500'); return }
    setConfirmData({ amount: val, interest, total })
    goto('confirm')
  }

  return (
    <>
      <StatusBar />
      <div className="borrow-inner" style={{ overflowY: 'auto', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <button className="back-btn" style={{ marginBottom: 0 }} onClick={() => goto('dashboard')}>
            <svg viewBox="0 0 18 18"><path d="M11 14l-5-5 5-5" /></svg>
          </button>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'white' }}>How much do you need?</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Funds reflect instantly</div>
          </div>
        </div>

        <div className="avail-strip">
          <span className="avail-label">Available Credit</span>
          <span className="avail-val">R3,500.00</span>
        </div>

        <div className="amount-stage">
          <span className="amount-pre">R </span>
          <span className="amount-num">{val > 0 ? val.toLocaleString('en-ZA') : '0'}</span>
          <span className="amount-cursor" />
        </div>

        <div className="numpad">
          {['1','2','3','4','5','6','7','8','9'].map(k => (
            <button key={k} className="nkey" onClick={() => nk(k)}>{k}</button>
          ))}
          <button className="nkey empty" />
          <button className="nkey" onClick={() => nk('0')}>0</button>
          <button className="nkey del" onClick={nd}>⌫</button>
        </div>

        <div className="calc-card">
          <div className="calc-row">
            <span className="l">Loan Amount</span>
            <span className="r">R{val.toLocaleString('en-ZA')}</span>
          </div>
          <div className="calc-row">
            <span className="l">Interest (35%)</span>
            <span className="r">R{interest.toLocaleString('en-ZA')}</span>
          </div>
          <div className="calc-row total">
            <span className="l">Total Repayment</span>
            <span className="r">R{total.toLocaleString('en-ZA')}</span>
          </div>
          <div className="calc-row">
            <span className="l">Debit Date</span>
            <span className="r">25 Apr 2026</span>
          </div>
        </div>

        <button className="btn btn-yellow" onClick={doBorrow}>Confirm &amp; Borrow →</button>
        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: 'var(--text-dim)' }}>
          Maximum R3,500 · Interest charged on disbursement
        </div>
      </div>
    </>
  )
}
