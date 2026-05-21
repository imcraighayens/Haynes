export type Screen = 'splash' | 'login' | 'upload' | 'assessment' | 'offer' | 'dashboard' | 'borrow' | 'confirm' | 'repay' | 'menu' | 'contracts' | 'profile' | 'admin'

export interface User {
  id: string
  full_name: string
  id_number: string
  phone: string
  email: string
  credit_limit: number
  available_credit: number
  mandate_active: boolean
  created_at: string
}

export interface Application {
  id: string
  user_id: string
  status: 'pending' | 'approved' | 'declined' | 'review'
  ai_credit_offer: number
  monthly_income: number
  payday: number
  documents_verified: boolean
  created_at: string
}

export interface Loan {
  id: string
  user_id: string
  amount: number
  interest: number
  total_due: number
  debit_date: string
  status: 'active' | 'settled' | 'defaulted'
  mandate_ref: string
  contract_id: string
  created_at: string
}

export interface Transaction {
  id: string
  user_id: string
  type: 'credit' | 'debit' | 'contract'
  amount: number
  description: string
  created_at: string
}
