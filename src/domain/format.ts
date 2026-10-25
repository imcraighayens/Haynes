const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export const MONTH_NAMES = MONTHS
export const DAY_NAMES = DAYS

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** R 14 000 / R 4 962.96 — space thousands, cents only when non-zero. */
export function zar(n: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (n == null || Number.isNaN(n)) return '—'
  const neg = n < 0
  const v = Math.abs(round2(n))
  const showCents = opts.cents ?? v % 1 !== 0
  const [int, dec] = v.toFixed(showCents ? 2 : 0).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${neg ? '−' : ''}R ${grouped}${dec ? '.' + dec : ''}`
}

/** Parse a money-ish string ("R 4 500,50", "4500") into a number, or NaN. */
export function parseMoney(s: string | number | null | undefined): number {
  if (typeof s === 'number') return s
  const cleaned = String(s ?? '').replace(/[^\d.,-]/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, '')
  return cleaned ? parseFloat(cleaned) : NaN
}

/** Local calendar date as ISO YYYY-MM-DD. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayIso(): string {
  return isoDate(new Date())
}

/** Parse ISO date (YYYY-MM-DD, or full ISO) or a label like "23 Oct 2026" to a local Date. */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3])
  const lbl = /^(\d{1,2})[\s/-]+([A-Za-z]{3})[A-Za-z]*[\s/-]+(\d{4})/.exec(s.trim())
  if (lbl) {
    const m = MONTHS.findIndex((x) => x.toLowerCase() === lbl[2].toLowerCase())
    if (m >= 0) return new Date(+lbl[3], m, +lbl[1])
  }
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s.trim())
  if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1])
  return null
}

/** Normalise any supported date string to ISO, or null. */
export function toIso(s: string | null | undefined): string | null {
  const d = parseDate(s)
  return d ? isoDate(d) : null
}

/** 23 Oct 2026 */
export function dateLabel(s: string | Date | null | undefined): string {
  const d = s instanceof Date ? s : parseDate(s ?? null)
  if (!d) return '—'
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** 23 OCT 2026 */
export function dateStamp(s: string | Date | null | undefined): string {
  return dateLabel(s).toUpperCase()
}

/** SUN 25 OCT 2026 */
export function dayStamp(d: Date = new Date()): string {
  return `${DAYS[d.getDay()]} ${dateStamp(d)}`
}

/** 25 Oct 2026, 14:05 */
export function dateTimeLabel(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return dateLabel(s)
  return `${dateLabel(d)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function addMonths(iso: string, n: number): string {
  const d = parseDate(iso)!
  const day = d.getDate()
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()
  t.setDate(Math.min(day, last))
  return isoDate(t)
}

export function addDays(iso: string, n: number): string {
  const d = parseDate(iso)!
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

export function addBusinessDays(iso: string, n: number): string {
  const d = parseDate(iso)!
  let k = 0
  while (k < n) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) k++
  }
  return isoDate(d)
}

export function daysBetween(aIso: string, bIso: string): number {
  const a = parseDate(aIso)!, b = parseDate(bIso)!
  return Math.round((b.getTime() - a.getTime()) / 864e5)
}

/** YYYY-MM month key */
export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

/** ••••••• 0086 */
export function maskTail(v: string | null | undefined, keep = 4, dots = 7): string {
  if (!v) return `${'•'.repeat(dots)} —`
  return `${'•'.repeat(dots)} ${v.slice(-keep)}`
}

export function uid(prefix = ''): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `${prefix}${Date.now().toString(36)}${r}`
}
