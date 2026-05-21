'use client'
import { useApp } from '@/contexts/AppContext'

export default function MandateModal() {
  const { modal, closeModal, showToast } = useApp()

  return (
    <div className={`modal-overlay${modal === 'mandate' ? ' open' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-title">DebiCheck Mandate</div>
        <div className="modal-sub">Your authorised debit order details</div>

        <div className="mandate-status">
          <div className="mandate-status-ico">✅</div>
          <div className="mandate-status-info">
            <h4>Mandate Active</h4>
            <p>Authorised &amp; confirmed by your bank</p>
          </div>
        </div>

        <div className="card">
          <div className="row-item"><span className="row-label">Bank</span><span className="row-value">GoTyme Bank</span></div>
          <div className="row-item"><span className="row-label">Account</span><span className="row-value" style={{ fontFamily: 'var(--mono)' }}>••••7010</span></div>
          <div className="row-item"><span className="row-label">Debit Date</span><span className="row-value">25th of every month</span></div>
          <div className="row-item"><span className="row-label">Mandate Ref</span><span className="row-value" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>ECL-2604-0042</span></div>
          <div className="row-item"><span className="row-label">Authorised</span><span className="row-value green">15 Jan 2026</span></div>
        </div>

        <div className="info-banner" style={{ marginTop: 14, marginBottom: 0, background: 'rgba(255,92,92,0.06)', borderColor: 'rgba(255,92,92,0.15)' }}>
          <strong style={{ color: 'var(--danger)' }}>Cancel mandate?</strong> This will suspend your Loop account until a new mandate is set up.
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => showToast('Contact support to update mandate')}>Update</button>
          <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => { closeModal(); showToast('Contact support to cancel mandate') }}>Cancel Mandate</button>
        </div>
      </div>
    </div>
  )
}
