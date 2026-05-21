'use client'
import { useApp } from '@/contexts/AppContext'
import StatusBar from '@/components/ui/StatusBar'

export default function MenuScreen() {
  const { goto, openModal, showToast } = useApp()

  return (
    <>
      <StatusBar />
      <div className="scroll-area">
        <div className="menu-inner">
          <div className="menu-topbar">
            <div className="menu-title">Menu</div>
            <button className="back-btn" style={{ marginBottom: 0 }} onClick={() => goto('dashboard')}>
              <svg viewBox="0 0 18 18" fill="none" stroke="var(--text-dim)" strokeWidth="2">
                <path d="M4 4l10 10M14 4L4 14" />
              </svg>
            </button>
          </div>

          <div className="menu-section">
            <div className="menu-section-label">Transactions</div>
            <div className="menu-grid">
              <button className="menu-cell" onClick={() => goto('borrow')}>
                <div className="menu-ico yl"><svg viewBox="0 0 20 20" fill="none" stroke="var(--yellow)" strokeWidth="1.8"><path d="M10 4v12M4 10h12" /></svg></div>
                <span className="menu-cell-label">Borrow</span>
              </button>
              <button className="menu-cell" onClick={() => goto('repay')}>
                <div className="menu-ico gr"><svg viewBox="0 0 20 20" fill="none" stroke="var(--success)" strokeWidth="1.8"><path d="M4 16L16 4M16 4H8M16 4v8" /></svg></div>
                <span className="menu-cell-label">Repay Early</span>
              </button>
              <button className="menu-cell" onClick={() => openModal('history')}>
                <div className="menu-ico"><svg viewBox="0 0 20 20" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8"><path d="M3 5h14M3 10h14M3 15h9" /></svg></div>
                <span className="menu-cell-label">History</span>
              </button>
            </div>
          </div>

          <div className="menu-section">
            <div className="menu-section-label">Account</div>
            <div className="menu-grid">
              <button className="menu-cell" onClick={() => goto('contracts')}>
                <div className="menu-ico"><svg viewBox="0 0 20 20" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8"><rect x="3" y="2" width="14" height="16" rx="2" /><path d="M7 7h6M7 10h6M7 13h4" /></svg></div>
                <span className="menu-cell-label">Contracts</span>
              </button>
              <button className="menu-cell" onClick={() => openModal('mandate')}>
                <div className="menu-ico yl"><svg viewBox="0 0 20 20" fill="none" stroke="var(--yellow)" strokeWidth="1.8"><rect x="3" y="7" width="14" height="10" rx="2" /><path d="M7 7V5a3 3 0 016 0v2" /></svg></div>
                <span className="menu-cell-label">Mandate</span>
              </button>
              <button className="menu-cell" onClick={() => showToast('Documents uploaded & verified ✓')}>
                <div className="menu-ico"><svg viewBox="0 0 20 20" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8"><rect x="4" y="3" width="12" height="14" rx="2" /><path d="M7 7h6M7 10h6M7 13h4" /></svg></div>
                <span className="menu-cell-label">Documents</span>
              </button>
            </div>
          </div>

          <div className="menu-section">
            <div className="menu-section-label">Support</div>
            <div className="menu-grid">
              <button className="menu-cell" onClick={() => goto('profile')}>
                <div className="menu-ico"><svg viewBox="0 0 20 20" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8"><circle cx="10" cy="7" r="3" /><path d="M4 18c0-3 2.686-5 6-5s6 2 6 5" /></svg></div>
                <span className="menu-cell-label">Profile</span>
              </button>
              <button className="menu-cell" onClick={() => openModal('notifs')}>
                <div className="menu-ico"><svg viewBox="0 0 20 20" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8"><path d="M10 2a5 5 0 015 5v3l1.5 2.5H3.5L5 10V7a5 5 0 015-5z" /><path d="M8.5 14.5a1.5 1.5 0 003 0" /></svg></div>
                <span className="menu-cell-label">Notifications</span>
              </button>
              <button className="menu-cell" onClick={() => showToast('Support: help@ecoloans.co.za')}>
                <div className="menu-ico rd"><svg viewBox="0 0 20 20" fill="none" stroke="var(--danger)" strokeWidth="1.8"><circle cx="10" cy="10" r="7" /><path d="M10 10c0-1.5 1.5-2.5 1.5-4a2.5 2.5 0 00-5 0" strokeLinecap="round" /><circle cx="10" cy="14" r="0.8" fill="var(--danger)" /></svg></div>
                <span className="menu-cell-label">Get Help</span>
              </button>
            </div>
          </div>

          <button className="btn btn-ghost" onClick={() => goto('login')}>Sign Out</button>
        </div>
      </div>
    </>
  )
}
