'use client'
import { useApp } from '@/contexts/AppContext'
import StatusBar from '@/components/ui/StatusBar'

export default function OfferScreen() {
  const { goto, showToast } = useApp()

  return (
    <>
      <StatusBar />
      <div className="scroll-area">
        <div className="screen-inner">
          <button className="back-btn" onClick={() => goto('upload')}>
            <svg viewBox="0 0 18 18"><path d="M11 14l-5-5 5-5" /></svg>
            Back
          </button>

          <div className="pill-badge pill-green" style={{ marginBottom: 24, display: 'inline-flex' }}>✓ AI Assessment Complete</div>

          <div className="offer-hero">
            <div className="offer-hero-label">Your approved credit limit</div>
            <div className="offer-hero-amount">R<em>3,500</em></div>
            <div className="offer-hero-sub">Based on your income of R14,200 / month</div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-label">Loan Terms</div>
            <div className="row-item"><span className="row-label">Monthly Interest</span><span className="row-value yellow">35%</span></div>
            <div className="row-item"><span className="row-label">Credit Type</span><span className="row-value">Revolving Credit</span></div>
            <div className="row-item"><span className="row-label">Debit Date</span><span className="row-value">25th of every month</span></div>
            <div className="row-item"><span className="row-label">First Cycle</span><span className="row-value">Month-to-Month</span></div>
            <div className="row-item"><span className="row-label">Contract</span><span className="row-value">Auto-renewed monthly</span></div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'white', marginBottom: 4 }}>⚡ DebiCheck Mandate Setup</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.5 }}>
              One-time bank authorisation. All future repayments collected automatically on your debit date.
            </div>
            <div className="form-group">
              <label className="form-label">Bank Name</label>
              <input className="form-input" type="text" placeholder="e.g. FNB, Absa, Nedbank" />
            </div>
            <div className="form-group">
              <label className="form-label">Account Number</label>
              <input className="form-input" type="text" placeholder="Your account number" />
            </div>
            <div className="form-group">
              <label className="form-label">Branch Code</label>
              <input className="form-input" type="text" placeholder="6-digit branch code" maxLength={6} />
            </div>
          </div>

          <button className="btn btn-yellow" onClick={() => goto('dashboard')}>
            Accept Offer &amp; Activate Mandate →
          </button>
          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            By accepting you agree to our Terms &amp; Conditions and authorise EcoLoans to debit your account via DebiCheck.
          </div>
        </div>
      </div>
    </>
  )
}
