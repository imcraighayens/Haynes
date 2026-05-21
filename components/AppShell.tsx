'use client'
import { useEffect } from 'react'
import { AppProvider, useApp } from '@/contexts/AppContext'
import SplashScreen from './screens/SplashScreen'
import LoginScreen from './screens/LoginScreen'
import UploadScreen from './screens/UploadScreen'
import AssessmentScreen from './screens/AssessmentScreen'
import OfferScreen from './screens/OfferScreen'
import DashboardScreen from './screens/DashboardScreen'
import BorrowScreen from './screens/BorrowScreen'
import ConfirmScreen from './screens/ConfirmScreen'
import RepayScreen from './screens/RepayScreen'
import MenuScreen from './screens/MenuScreen'
import ContractsScreen from './screens/ContractsScreen'
import ProfileScreen from './screens/ProfileScreen'
import AdminScreen from './screens/AdminScreen'
import NotificationsModal from './modals/NotificationsModal'
import HistoryModal from './modals/HistoryModal'
import MandateModal from './modals/MandateModal'
import AdjustModal from './modals/AdjustModal'
import Toast from './ui/Toast'
import type { Screen } from '@/contexts/AppContext'

const NAV_SCREENS: { id: Screen; label: string }[] = [
  { id: 'splash', label: 'Splash' },
  { id: 'login', label: 'Login' },
  { id: 'upload', label: 'Upload' },
  { id: 'assessment', label: 'AI Check' },
  { id: 'offer', label: 'Offer' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'borrow', label: 'Borrow' },
  { id: 'confirm', label: 'Confirm' },
  { id: 'repay', label: 'Repay' },
  { id: 'menu', label: 'Menu' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'profile', label: 'Profile' },
  { id: 'admin', label: 'Admin' },
]

function InnerShell() {
  const { currentScreen, goto } = useApp()

  useEffect(() => {
    if (currentScreen === 'splash') {
      const t = setTimeout(() => goto('login'), 2800)
      return () => clearTimeout(t)
    }
  }, [currentScreen, goto])

  const screens: Record<Screen, JSX.Element> = {
    splash: <SplashScreen />,
    login: <LoginScreen />,
    upload: <UploadScreen />,
    assessment: <AssessmentScreen />,
    offer: <OfferScreen />,
    dashboard: <DashboardScreen />,
    borrow: <BorrowScreen />,
    confirm: <ConfirmScreen />,
    repay: <RepayScreen />,
    menu: <MenuScreen />,
    contracts: <ContractsScreen />,
    profile: <ProfileScreen />,
    admin: <AdminScreen />,
  }

  return (
    <div className="app-shell">
      <div className="desktop-label">
        <h1>L<span>oo</span>p<br />Credit.</h1>
        <p>A revolving credit platform powered by EcoLoans. Borrow, repay, loop — infinitely.</p>
        <div className="nav-pills">
          {NAV_SCREENS.map(({ id, label }) => (
            <button
              key={id}
              className={`pill${currentScreen === id ? ' active' : ''}`}
              onClick={() => goto(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="phone-frame" id="phone">
        {(Object.entries(screens) as [Screen, JSX.Element][]).map(([id, el]) => (
          <div
            key={id}
            className={`screen${currentScreen === id ? ' active' : ''}${id === 'confirm' ? ' slide-up' : ''}`}
            id={id}
          >
            {el}
          </div>
        ))}

        <NotificationsModal />
        <HistoryModal />
        <MandateModal />
        <AdjustModal />
        <Toast />
      </div>
    </div>
  )
}

export default function AppShell() {
  return (
    <AppProvider>
      <InnerShell />
    </AppProvider>
  )
}
