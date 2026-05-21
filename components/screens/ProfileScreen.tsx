'use client'
import { useApp } from '@/contexts/AppContext'
import StatusBar from '@/components/ui/StatusBar'
import BottomNav from '@/components/ui/BottomNav'

export default function ProfileScreen() {
  const { goto, showToast } = useApp()

  return (
    <>
      <StatusBar />
      <div className="scroll-area">
        <div className="profile-inner">
          <div className="profile-hero">
            <div className="avatar-ring">👤</div>
            <div className="profile-name">Thabo Nkosi</div>
            <div className="profile-id">ID: 9203145678082</div>
            <div className="pill-badge pill-green" style={{ marginTop: 10 }}>✓ Verified Account</div>
          </div>

          <div className="profile-section">
            <div className="profile-section-title">Account Status</div>
            <div className="card">
              <div className="row-item"><span className="row-label">Credit Limit</span><span className="row-value yellow">R3,500</span></div>
              <div className="row-item"><span className="row-label">Available</span><span className="row-value green">R3,500</span></div>
              <div className="row-item"><span className="row-label">Active Loan</span><span className="row-value">None</span></div>
              <div className="row-item"><span className="row-label">Mandate</span><span className="row-value green">Active ✓</span></div>
              <div className="row-item"><span className="row-label">Member Since</span><span className="row-value">Jan 2026</span></div>
            </div>
          </div>

          <div className="profile-section">
            <div className="profile-section-title">Personal Info</div>
            <div className="profile-row" onClick={() => showToast('Edit name')}>
              <div className="profile-row-ico">
                <svg viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8"><circle cx="8" cy="5" r="3" /><path d="M2 15c0-3 2.686-5 6-5s6 2 6 5" /></svg>
              </div>
              <div className="profile-row-info"><h4>Thabo Nkosi</h4><p>Full Name</p></div>
              <div className="profile-row-arrow"><svg viewBox="0 0 14 14" fill="none" stroke="var(--text-dim)" strokeWidth="2"><path d="M5 3l4 4-4 4" /></svg></div>
            </div>
            <div className="profile-row" onClick={() => showToast('Edit phone')}>
              <div className="profile-row-ico">
                <svg viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8"><rect x="4" y="2" width="8" height="12" rx="2" /><circle cx="8" cy="12" r="1" /></svg>
              </div>
              <div className="profile-row-info"><h4>+27 82 456 7890</h4><p>Mobile Number</p></div>
              <div className="profile-row-arrow"><svg viewBox="0 0 14 14" fill="none" stroke="var(--text-dim)" strokeWidth="2"><path d="M5 3l4 4-4 4" /></svg></div>
            </div>
            <div className="profile-row" onClick={() => showToast('Edit email')}>
              <div className="profile-row-ico">
                <svg viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8"><rect x="2" y="4" width="12" height="8" rx="1.5" /><path d="M2 5l6 4 6-4" /></svg>
              </div>
              <div className="profile-row-info"><h4>thabo@email.com</h4><p>Email Address</p></div>
              <div className="profile-row-arrow"><svg viewBox="0 0 14 14" fill="none" stroke="var(--text-dim)" strokeWidth="2"><path d="M5 3l4 4-4 4" /></svg></div>
            </div>
          </div>

          <div className="profile-section">
            <div className="profile-section-title">Security</div>
            <div className="profile-row" onClick={() => showToast('Change password link sent')}>
              <div className="profile-row-ico">
                <svg viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8"><rect x="3" y="8" width="10" height="6" rx="1.5" /><path d="M5 8V6a3 3 0 016 0v2" /></svg>
              </div>
              <div className="profile-row-info"><h4>Change Password</h4><p>Last changed 30 days ago</p></div>
              <div className="profile-row-arrow"><svg viewBox="0 0 14 14" fill="none" stroke="var(--text-dim)" strokeWidth="2"><path d="M5 3l4 4-4 4" /></svg></div>
            </div>
            <div className="profile-row" onClick={() => showToast('Biometrics toggled')}>
              <div className="profile-row-ico">
                <svg viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8"><path d="M4 10c0-2.21 1.79-4 4-4s4 1.79 4 4M8 6V4M4 8H2M14 8h-2" /></svg>
              </div>
              <div className="profile-row-info"><h4>Biometric Login</h4><p>Face ID / Fingerprint</p></div>
              <div style={{ width: 36, height: 22, background: 'var(--success)', borderRadius: 11, cursor: 'pointer', flexShrink: 0 }} />
            </div>
          </div>

          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => goto('login')}>Sign Out</button>
        </div>
      </div>
      <BottomNav active="profile" />
    </>
  )
}
