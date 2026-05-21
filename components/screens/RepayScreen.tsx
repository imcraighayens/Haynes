'use client'
import { useApp } from '@/contexts/AppContext'
import StatusBar from '@/components/ui/StatusBar'

export default function RepayScreen() {
  const { goto, showToast } = useApp()

  const doEarlyRepay = () => {
    showToast('Processing early repayment...')
    setTimeout(() => {
      showToast('Repayment successful! R3,500 available ✓')
      setTimeout(() => goto('dashboard'), 800)
    }, 1200)
  }

  return (
    <>
      <StatusBar />
      <div className="scroll-area">
        <div className="repay-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <button className="back-btn" style={{ marginBottom: 0 }} onClick={() => goto('dashboard')}>
              <svg viewBox="0 0 18 18"><path d="M11 14l-5-5 5-5" /></svg>
            </button>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'white' }}>Repay Early</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Save on interest</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14, textAlign: 'center', padding: 24 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Amount outstanding</div>
            <div style={{ fontSize: 46, fontWeight: 900, color: 'white', letterSpacing: -2, fontFamily: 'var(--mono)' }}>R2,700</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>Due 25 Apr 2026 via DebiCheck</div>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <div className="row-item"><span className="row-label">Principal Borrowed</span><span className="row-value">R2,000</span></div>
            <div className="row-item"><span className="row-label">Interest (35%)</span><span className="row-value yellow">R700</span></div>
            <div className="row-item"><span className="row-label">Total Due</span><span className="row-value">R2,700</span></div>
            <div className="row-item"><span className="row-label">After Repayment</span><span className="row-value green">R3,500 available</span></div>
          </div>

          <div className="info-banner">
            <strong>Early repayment:</strong> If you repay before the 25th, no additional interest accrues. Your credit loops back immediately after confirmation.
          </div>

          <button className="btn btn-yellow" style={{ marginTop: 20 }} onClick={doEarlyRepay}>Pay R2,700 Now →</button>
          <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => goto('dashboard')}>Cancel</button>
        </div>
      </div>
    </>
  )
}
