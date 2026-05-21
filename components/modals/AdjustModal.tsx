'use client'
import { useApp } from '@/contexts/AppContext'

export default function AdjustModal() {
  const { modal, closeModal, showToast } = useApp()

  return (
    <div className={`modal-overlay${modal === 'adjust' ? ' open' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-title">Adjust Credit Offer</div>
        <div className="modal-sub">Override AI recommendation before approving</div>

        <div className="card">
          <div className="adjust-row">
            <label>AI Recommended</label>
            <span style={{ color: 'var(--yellow)', fontWeight: 800, fontFamily: 'var(--mono)' }}>R2,500</span>
          </div>
          <div className="adjust-row">
            <label>Adjusted Amount</label>
            <input className="adjust-input" type="text" defaultValue="R2,500" />
          </div>
          <div className="adjust-row">
            <label>Reason</label>
          </div>
          <textarea
            style={{
              width: '100%',
              background: 'var(--charcoal-3)',
              border: '1.5px solid var(--border)',
              borderRadius: 10,
              color: 'white',
              fontFamily: 'var(--font)',
              fontSize: 13,
              padding: 12,
              resize: 'none',
              outline: 'none',
              marginTop: 6,
            }}
            rows={3}
            placeholder="Optional note for this adjustment..."
          />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn btn-yellow" style={{ flex: 1 }} onClick={() => { closeModal(); showToast('Credit adjusted & approved ✓') }}>
            Apply &amp; Approve
          </button>
          <button className="btn btn-ghost btn-sm" onClick={closeModal}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
