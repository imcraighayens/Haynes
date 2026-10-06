import { format, parseISO, isToday, isPast, differenceInCalendarDays } from 'date-fns'

const zar = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

const zarPrecise = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function money(value: number, precise = false): string {
  return (precise ? zarPrecise : zar).format(value).replace('ZAR', 'R').replace(' ', '')
}

export function compactMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `R${(value / 1_000).toFixed(1)}k`
  return `R${value}`
}

export function fmtDate(iso: string): string {
  try {
    return format(parseISO(iso), 'MMM d, yyyy')
  } catch {
    return iso
  }
}

export function fmtDateTime(iso: string): string {
  try {
    return format(parseISO(iso), 'MMM d, yyyy • HH:mm')
  } catch {
    return iso
  }
}

export function dueLabel(iso: string): { label: string; tone: 'ok' | 'soon' | 'late' } {
  const d = parseISO(iso)
  if (isToday(d)) return { label: 'Due today', tone: 'soon' }
  if (isPast(d)) return { label: `${Math.abs(differenceInCalendarDays(d, new Date()))}d overdue`, tone: 'late' }
  return { label: `in ${differenceInCalendarDays(d, new Date())}d`, tone: 'ok' }
}

export { isToday, isPast, parseISO, differenceInCalendarDays }
