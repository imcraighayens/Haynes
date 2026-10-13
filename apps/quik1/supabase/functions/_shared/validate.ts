// South African ID number: YYMMDD SSSS C A Z, Luhn check digit.
export function validSaId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const mm = Number(id.slice(2, 4)), dd = Number(id.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id[i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** "82 431 9077" / "0824319077" / "+27824319077" → "+27824319077", else null */
export function normalisePhone(raw: string): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  const nine = d.length === 9 ? d : d.length === 10 && d.startsWith('0') ? d.slice(1) : d.length === 11 && d.startsWith('27') ? d.slice(2) : '';
  return /^[6-8]\d{8}$/.test(nine) ? '+27' + nine : null;
}
