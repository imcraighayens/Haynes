'use client'

export default function SplashScreen() {
  return (
    <div className="splash-content">
      <div className="splash-ring">
        <svg viewBox="0 0 120 120" className="ring1">
          <circle cx="60" cy="60" r="54" fill="none" stroke="var(--yellow)" strokeWidth="3" strokeDasharray="200 140" strokeLinecap="round" />
        </svg>
        <svg viewBox="0 0 120 120" className="ring2">
          <circle cx="60" cy="60" r="40" fill="none" stroke="rgba(245,200,66,0.4)" strokeWidth="2" strokeDasharray="100 80" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: 36, position: 'relative', zIndex: 1 }}>♾️</span>
      </div>
      <div className="splash-logo">
        L<span>oo</span>p
      </div>
      <div className="splash-tagline">Revolving Credit by EcoLoans</div>
      <div className="splash-dots">
        <span />
        <span />
        <span />
      </div>
      <div className="splash-legal">NCR Registered Credit Provider · NCA Compliant · FSP 12345</div>
    </div>
  )
}
