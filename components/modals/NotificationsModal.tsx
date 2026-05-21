'use client'
import { useApp } from '@/contexts/AppContext'

export default function NotificationsModal() {
  const { modal, closeModal } = useApp()

  return (
    <div className={`modal-overlay${modal === 'notifs' ? ' open' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-title">Notifications</div>
        <div className="modal-sub">Your recent alerts from Loop</div>

        <div className="notif-item">
          <div className="notif-icon-wrap" style={{ background: 'rgba(61,214,140,0.1)' }}>✅</div>
          <div className="notif-text">
            <h4>Repayment Confirmed</h4>
            <p>Your repayment of R2,700 was successfully collected on 25 Mar 2026.</p>
            <div className="notif-time">2 days ago</div>
          </div>
        </div>
        <div className="notif-item">
          <div className="notif-icon-wrap" style={{ background: 'rgba(245,200,66,0.1)' }}>⏰</div>
          <div className="notif-text">
            <h4>Debit Reminder</h4>
            <p>Your next debit of R2,700 is scheduled for 25 Apr 2026 via DebiCheck.</p>
            <div className="notif-time">3 days ago</div>
          </div>
        </div>
        <div className="notif-item">
          <div className="notif-icon-wrap" style={{ background: 'rgba(61,214,140,0.1)' }}>💰</div>
          <div className="notif-text">
            <h4>Credit Disbursed</h4>
            <p>R2,000 has been loaded into your available balance.</p>
            <div className="notif-time">5 days ago</div>
          </div>
        </div>

        <button className="btn btn-ghost" style={{ marginTop: 20 }} onClick={closeModal}>Close</button>
      </div>
    </div>
  )
}
