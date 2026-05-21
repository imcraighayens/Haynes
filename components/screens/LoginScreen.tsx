'use client'
import { useState } from 'react'
import { useApp } from '@/contexts/AppContext'
import StatusBar from '@/components/ui/StatusBar'

export default function LoginScreen() {
  const { goto, showToast } = useApp()
  const [tab, setTab] = useState<'signin' | 'register'>('signin')

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault()
    showToast('Signing you in…')
    setTimeout(() => goto('dashboard'), 1000)
  }

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault()
    showToast('Creating your account…')
    setTimeout(() => goto('upload'), 1000)
  }

  return (
    <>
      <StatusBar />
      <div className="scroll-area">
        <div className="login-inner">
          <div className="login-logo">
            <div className="login-logo-mark">L<span>oo</span>p</div>
            <div className="login-sub">Revolving Credit by EcoLoans</div>
          </div>

          <div className="login-heading">
            {tab === 'signin' ? 'Welcome back 👋' : 'Create account'}
          </div>
          <div className="login-sub2">
            {tab === 'signin' ? 'Sign in to your Loop account' : 'Apply for revolving credit in minutes'}
          </div>

          <div className="tab-row">
            <button
              className={`tab-btn${tab === 'signin' ? ' active' : ''}`}
              onClick={() => setTab('signin')}
            >
              Sign In
            </button>
            <button
              className={`tab-btn${tab === 'register' ? ' active' : ''}`}
              onClick={() => setTab('register')}
            >
              Register
            </button>
          </div>

          {tab === 'signin' ? (
            <form className="login-form" onSubmit={handleSignIn}>
              <div className="login-form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="thabo@example.co.za"
                  defaultValue="thabo@example.co.za"
                />
              </div>
              <div className="login-form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="••••••••"
                  defaultValue="password123"
                />
              </div>
              <button type="submit" className="btn btn-yellow" style={{ marginTop: 8 }}>
                Sign In →
              </button>
            </form>
          ) : (
            <form className="login-form" onSubmit={handleRegister}>
              <div className="login-form-group">
                <label className="form-label">Full Name</label>
                <input type="text" className="form-input" placeholder="Thabo Nkosi" />
              </div>
              <div className="login-form-group">
                <label className="form-label">SA ID Number</label>
                <input type="text" className="form-input" placeholder="9001015800083" />
              </div>
              <div className="login-form-group">
                <label className="form-label">Phone Number</label>
                <input type="tel" className="form-input" placeholder="+27 71 234 5678" />
              </div>
              <div className="login-form-group">
                <label className="form-label">Email Address</label>
                <input type="email" className="form-input" placeholder="thabo@example.co.za" />
              </div>
              <div className="login-form-group">
                <label className="form-label">Password</label>
                <input type="password" className="form-input" placeholder="Create a strong password" />
              </div>
              <button type="submit" className="btn btn-yellow" style={{ marginTop: 8 }}>
                Create Account →
              </button>
            </form>
          )}

          <button className="admin-ghost" onClick={() => goto('admin')}>
            Admin Dashboard →
          </button>
        </div>
      </div>
    </>
  )
}
