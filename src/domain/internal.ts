/** Small helpers shared inside the domain layer. */
export function addYears(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y + n}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
