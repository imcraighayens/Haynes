'use client'
import { useApp } from '@/contexts/AppContext'

export default function ConfirmScreen() {
  const { goto, confirmData } = useApp()
  const { amount, interest, total } = confirmData

  return (
    <div className="confirm-wrap">
      <div className="success-ring">
        <svg viewBox="0 0 46 46" fill="none" stroke="var(--success)" strokeWidth="3">
          <path d="M11 23l8 8 16-16" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="confirm-title">Money&apos;s on its way! 🎉</div>
      <div className="confirm-amount">R{(amount || 2000).toLocaleString('en-ZA')}</div>
      <div className="confirm-msg">
        Your loan has been disbursed. Contract generated. DebiCheck mandate active for{' '}
        <strong style={{ color: 'white' }}>25 Apr 2026</strong>.
      </div>
      <div className="card" style={{ textAlign: 'left', marginBottom: 24 }}>
        <div className="row-item">
          <span className="row-label">Loan Amount</span>
          <span className="row-value">R{(amount || 2000).toLocaleString('en-ZA')}</span>
        </div>
        <div className="row-item">
          <span className="row-label">Interest (35%)</span>
          <span className="row-value">R{(interest || 700).toLocaleString('en-ZA')}</span>
        </div>
        <div className="row-item">
          <span className="row-label">Total Due</span>
          <span className="row-value yellow">R{(total || 2700).toLocaleString('en-ZA')}</span>
        </div>
        <div className="row-item">
          <span className="row-label">Debit Date</span>
          <span className="row-value">25 Apr 2026</span>
        </div>
        <div className="row-item">
          <span className="row-label">Contract</span>
          <span className="row-value green">✓ Generated</span>
        </div>
      </div>
      <button className="btn btn-yellow" onClick={() => goto('dashboard')}>Back to Dashboard</button>
    </div>
  )
}
