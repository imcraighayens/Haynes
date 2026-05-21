'use client'
import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

export type Screen = 'splash' | 'login' | 'upload' | 'assessment' | 'offer' | 'dashboard' | 'borrow' | 'confirm' | 'repay' | 'menu' | 'contracts' | 'profile' | 'admin'

export type ModalId = 'notifs' | 'history' | 'mandate' | 'adjust' | null

interface AppState {
  currentScreen: Screen
  modal: ModalId
  toast: string | null
  borrowAmt: string
  balanceVisible: boolean
  uploadedDocs: Record<string, boolean>
  confirmData: { amount: number; interest: number; total: number }
  goto: (screen: Screen) => void
  openModal: (id: ModalId) => void
  closeModal: () => void
  showToast: (msg: string) => void
  setBorrowAmt: (amt: string) => void
  toggleBalance: () => void
  markDoc: (docId: string) => void
  setConfirmData: (data: { amount: number; interest: number; total: number }) => void
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentScreen, setCurrentScreen] = useState<Screen>('splash')
  const [modal, setModal] = useState<ModalId>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [borrowAmt, setBorrowAmt] = useState('')
  const [balanceVisible, setBalanceVisible] = useState(true)
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, boolean>>({})
  const [confirmData, setConfirmData] = useState({ amount: 0, interest: 0, total: 0 })

  const goto = useCallback((screen: Screen) => {
    setCurrentScreen(screen)
    setModal(null)
  }, [])

  const openModal = useCallback((id: ModalId) => setModal(id), [])
  const closeModal = useCallback(() => setModal(null), [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }, [])

  const toggleBalance = useCallback(() => setBalanceVisible(v => !v), [])

  const markDoc = useCallback((docId: string) => {
    setUploadedDocs(prev => ({ ...prev, [docId]: true }))
  }, [])

  return (
    <AppContext.Provider value={{
      currentScreen, modal, toast, borrowAmt, balanceVisible, uploadedDocs, confirmData,
      goto, openModal, closeModal, showToast, setBorrowAmt, toggleBalance, markDoc, setConfirmData
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
