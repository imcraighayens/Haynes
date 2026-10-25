import { useMemo } from 'react'
import type { Book, Client, Role } from '../../domain/types'
import { useAuth } from '../../store/auth'
import { useBook } from '../../store/book'
import { useUi } from '../../store/ui'
import { can } from '../../domain/permissions'

export const PROVINCES = ['Gauteng', 'North West', 'Free State', 'Limpopo', 'Mpumalanga', 'Western Cape', 'Eastern Cape', 'KwaZulu-Natal', 'Northern Cape']

/** Universal branch codes for the major SA banks. */
export const BANKS: Record<string, string> = {
  'Capitec Bank': '470010',
  'First National Bank (FNB)': '250655',
  'Standard Bank': '051001',
  Absa: '632005',
  Nedbank: '198765',
  TymeBank: '678910',
  'African Bank': '430000',
  'Discovery Bank': '679000',
  Investec: '580105',
  Other: '',
}

export const ACCOUNT_TYPES = ['Savings Account', 'Cheque Account', 'Transmission Account']
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Self-employed', 'Pensioner', 'Unemployed']

/** The employee record of the signed-in user (demo: by id; Supabase: by email). */
export function useMyEmployeeId(): string | null {
  const { user } = useAuth()
  const { book } = useBook()
  return useMemo(() => {
    if (!user) return null
    const e = book.employees.find((x) => x.id === user.id) ?? book.employees.find((x) => x.email.toLowerCase() === user.email.toLowerCase())
    return e?.id ?? null
  }, [user, book.employees])
}

/** Loan officers only see their own clients. */
export function scopeClients(clients: Client[], role: Role, myEmployeeId: string | null): Client[] {
  if (role !== 'agent') return clients
  return clients.filter((c) => c.officerId && c.officerId === myEmployeeId)
}

export function officerName(book: Pick<Book, 'employees'>, id: string | null): string {
  if (!id) return 'Unassigned'
  return book.employees.find((e) => e.id === id)?.name ?? 'Unassigned'
}

/** True when full ID / bank numbers may be shown. */
export function usePiiVisible(): boolean {
  const { book } = useBook()
  const { revealed } = useUi()
  const { user } = useAuth()
  if (!book.settings.maskPii) return true
  return revealed && !!user && can(user.role, 'client.revealPii')
}

export interface SaIdInfo {
  valid: boolean
  dob: string | null
  reason: string | null
}

/** Validate a South African ID number (13 digits, Luhn check digit, YYMMDD birth date). */
export function checkSaId(raw: string): SaIdInfo {
  const id = raw.replace(/\s/g, '')
  if (!id) return { valid: false, dob: null, reason: null }
  if (!/^\d{13}$/.test(id)) return { valid: false, dob: null, reason: 'SA ID numbers have 13 digits' }
  let sum = 0
  for (let i = 0; i < 13; i++) {
    let d = +id[12 - i]
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  const yy = +id.slice(0, 2), mm = +id.slice(2, 4), dd = +id.slice(4, 6)
  const nowYY = new Date().getFullYear() % 100
  const year = yy > nowYY ? 1900 + yy : 2000 + yy
  const dt = new Date(year, mm - 1, dd)
  const dateOk = mm >= 1 && mm <= 12 && dt.getMonth() === mm - 1 && dt.getDate() === dd
  const dob = dateOk ? `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` : null
  if (sum % 10 !== 0) return { valid: false, dob, reason: 'Check digit does not match — please re-check the number' }
  if (!dateOk) return { valid: false, dob: null, reason: 'The first six digits are not a valid birth date' }
  return { valid: true, dob, reason: null }
}
