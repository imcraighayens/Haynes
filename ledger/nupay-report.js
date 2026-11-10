// Read-only NuPay report. The file is parsed in the browser and compared with
// the book already loaded on the page. Nothing is uploaded, stored, or written.
//
// XLSX and MandateReport zips are unzipped here with the same approach Ledger
// already uses for bank reports (ZIP local files + DEFLATE). SheetJS is not
// vendored: the full browser build is about 860 KB, and this reader only needs
// the first sheet's shared strings and cells.

import {
  PIF, ACTIVE_HEADERS, FIELD_ALIASES, JOIN_FIELDS, headersFor,
  normHeader, detectHeaders
} from './nupay-columns.js';

export { PIF, ACTIVE_HEADERS, headersFor, normHeader, detectHeaders };

const MAX_BYTES = 10 * 1024 * 1024;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

let bookOverride = null;

export function setBook(book) { bookOverride = book; }
export function round2(n) { return Math.round(Number(n) * 100) / 100; }
function cents(n) { return Math.round(Number(n) * 100); }

export function withinTolerance(a, b) {
  return Math.abs(cents(a) - cents(b)) <= cents(PIF.tolerance);
}

export function pifQuotes(original) {
  const base = Number(original);
  const percent = base * PIF.rate;
  const fee = Math.max(percent, PIF.flat);
  return {
    pif: round2(fee),
    percent: round2(percent),
    debit: round2(base + fee),
    usesFloor: percent < PIF.flat
  };
}

export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? round2(value) : null;
  let s = String(value == null ? '' : value).trim();
  if (!s || !/\d/.test(s)) return null;
  s = s.replace(/[Rr]/g, '').replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  s = s.replace(/[^0-9.\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : null;
}

function iso(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

export function parseDate(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mo ? iso(+m[3], mo, +m[1]) : '';
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.round(Number(s));
    if (n > 20000 && n < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return dt.toISOString().slice(0, 10);
    }
  }
  return '';
}

export function classifyStatus(value) {
  const s = normHeader(value);
  if (!s) return '';
  if (s.includes('disput')) return 'disputed';
  if (s.includes('revers')) return 'reversed';
  if (s.includes('tracking')) return 'tracking';
  if (s.includes('cancel')) return 'cancelled';
  if (s === 'future' || s.startsWith('future ')) return 'future';
  if (s.includes('unsuccess') || s.includes('fail') || s.includes('unpaid') || s.includes('reject')) return 'failed';
  if (s === 'success' || s.startsWith('success') || s === 'paid' || s.includes('honour') || s.includes('honor')) return 'success';
  return 'other';
}

export function statusLabel(kind) {
  return {
    success: 'Success', failed: 'Failed', tracking: 'In tracking', reversed: 'Reversed',
    disputed: 'Disputed', cancelled: 'Cancelled', future: 'Future', other: 'Other'
  }[kind] || (kind ? 'Other' : 'Blank');
}

function effectOf(kind) {
  if (kind === 'success') return 'pay';
  if (kind === 'reversed' || kind === 'disputed') return 'reverse';
  return 'none';
}

export function maskKeepLast(value, keep) {
  const raw = String(value == null ? '' : value).trim();
  const digits = raw.replace(/\D/g, '');
  const tail = (digits || raw).slice(-keep);
  if (!tail) return '';
  return '•'.repeat(Math.max(4, (digits || raw).length - tail.length)) + tail;
}

export function maskId(value) { return maskKeepLast(value, 4); }
export function maskPhone(value) { return maskKeepLast(value, 4); }
export function last4(value) {
  const raw = String(value == null ? '' : value).replace(/\s/g, '');
  if (!raw) return '';
  return '••••' + raw.slice(-4);
}

function detectDelim(line) {
  let comma = 0, semi = 0, tab = 0, quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { i += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (c === ',') comma += 1;
    else if (c === ';') semi += 1;
    else if (c === '\t') tab += 1;
  }
  if (tab > 0 && tab >= comma && tab >= semi) return '\t';
  if (semi > comma) return ';';
  return ',';
}

export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!src.trim()) return [];
  const firstBreak = src.indexOf('\n');
  const headerLine = firstBreak === -1 ? src : src.slice(0, firstBreak);
  const delim = detectDelim(headerLine);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delim) { row.push(cell); cell = ''; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function zeroish(cell) {
  const s = String(cell == null ? '' : cell).trim();
  return !s || /^0+(?:\.0+)?$/.test(s);
}

export function isEmptyStatusGrid(rows) {
  const data = rows || [];
  if (!data.length) return true;
  const hasWord = data.some(r => (r || []).some(c => /[A-Za-z]/.test(String(c || ''))));
  if (hasWord) return false;
  return data.every(r => (r || []).every(zeroish));
}

function xmlText(s) {
  return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

async function inflateRaw(bytes) {
  const raw = bytes.slice();
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { inflateRawSync } = await import('node:zlib');
  return new Uint8Array(inflateRawSync(raw));
}

export async function unzip(buffer) {
  const u = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let e = u.length - 22;
  const stop = Math.max(0, u.length - 22 - 65536);
  while (e >= stop && dv.getUint32(e, true) !== 0x06054b50) e -= 1;
  if (e < stop) throw new Error('Not a zip file');
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const files = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const localNameLen = dv.getUint16(localOff + 26, true);
    const localExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const raw = u.subarray(dataStart, dataStart + compSize);
    let bytes;
    if (method === 0) bytes = raw.slice();
    else if (method === 8) bytes = await inflateRaw(raw);
    else throw new Error('Unsupported zip method');
    if (bytes.length > MAX_BYTES) throw new Error('That file is too large to read in the browser.');
    files.push({ name: name.replace(/\\/g, '/'), bytes });
  }
  return files;
}

function sharedStrings(xml) {
  const out = [];
  const items = xml.match(/<si\b[^>]*>([\s\S]*?)<\/si>/g) || [];
  for (const item of items) {
    const texts = [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => xmlText(m[1]));
    out.push(texts.join(''));
  }
  return out;
}

function colIndex(ref) {
  const letters = String(ref || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function attr(source, name) {
  const m = String(source || '').match(new RegExp('\\b' + name + '="([^"]*)"'));
  return m ? m[1] : '';
}

export function sheetGrid(xml, strings) {
  const rows = [];
  const rowMatches = xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || [];
  for (const rowXml of rowMatches) {
    const cells = [];
    let seq = 0;
    const cellMatches = rowXml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) || [];
    for (const cell of cellMatches) {
      const open = cell.match(/^<c\b[^>]*>/) || [cell];
      const attrs = open[0];
      const ref = attr(attrs, 'r');
      const idx = ref ? colIndex(ref) : seq;
      seq = idx + 1;
      const type = attr(attrs, 't');
      let value = '';
      const v = cell.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      const inline = [...cell.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => xmlText(m[1])).join('');
      if (type === 's' && v) value = strings[+v[1]] || '';
      else if (type === 'inlineStr' || (!v && inline)) value = inline;
      else if (v) value = xmlText(v[1]);
      cells[idx] = value;
    }
    const width = cells.length;
    const dense = [];
    for (let i = 0; i < width; i++) dense.push(cells[i] == null ? '' : String(cells[i]));
    if (dense.some(c => c.trim() !== '')) rows.push(dense);
  }
  return rows;
}

export async function xlsxGrid(entries) {
  const byName = new Map(entries.map(e => [e.name, e]));
  const sheetName = [...byName.keys()].find(n => /xl\/worksheets\/sheet\d+\.xml$/i.test(n));
  if (!sheetName) throw new Error('The workbook has no sheet');
  const shared = byName.get('xl/sharedStrings.xml');
  const strings = shared ? sharedStrings(new TextDecoder().decode(shared.bytes)) : [];
  return sheetGrid(new TextDecoder().decode(byName.get(sheetName).bytes), strings);
}

function roleFromName(name) {
  const base = String(name || '').split('/').pop();
  if (/^active_/i.test(base)) return 'active';
  if (/^in_active_/i.test(base)) return 'in_active';
  if (/^pending_authorisation_/i.test(base)) return 'pending';
  if (/^rejected_authorisation_/i.test(base)) return 'rejected';
  if (/^suspended_/i.test(base)) return 'suspended';
  return '';
}

function intOf(value) {
  const n = parseInt(String(value == null ? '' : value).replace(/[^\d\-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function firstNum(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = typeof value === 'number' ? value : parseMoney(value);
    if (n != null && Number.isFinite(n)) return round2(n);
  }
  return null;
}

function outstanding(schedule, paid, instalment) {
  if (instalment == null || !schedule.length) return null;
  const remain = Math.max(schedule.length - Math.min(paid, schedule.length), 0);
  return round2(remain * instalment);
}

export function normalizeLoan(row) {
  if (!row || typeof row !== 'object') return null;
  const schedule = (Array.isArray(row.schedule) ? row.schedule : Array.isArray(row.sched) ? row.sched : []).map(parseDate).filter(Boolean);
  const paidDates = (Array.isArray(row.paid_dates) ? row.paid_dates : Array.isArray(row.paidDates) ? row.paidDates : []).map(parseDate).filter(Boolean);
  const instalmentsPaid = intOf(row.instalments_paid != null ? row.instalments_paid : row.paidInst);
  const instalmentAmount = firstNum(row.instalment_amount, row.instalment, row.retAmt);
  return {
    id: String(row.id || ''),
    ref: String(row.ref || ''),
    clientId: String(row.client_id || row.clientId || ''),
    contractRef: String(row.contract_ref || row.contractRef || '').trim(),
    mandateId: String(row.mandate_id || row.mandateId || row.mandate || '').trim(),
    instalmentAmount,
    schedule,
    paidDates,
    instalmentsPaid,
    status: String(row.dbStatus || row.status || ''),
    deleted: !!(row.deleted_at || row.deletedAt),
    outstanding: outstanding(schedule, instalmentsPaid, instalmentAmount)
  };
}

function normalizeClient(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    ref: String(row.ref || '').trim(),
    name: String(row.name || '').trim(),
    mandateRef: String(row.mandate_ref || row.mandateRef || '').trim()
  };
}

function normKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, '');
}

function prefer(map, key, loan) {
  if (!key || !loan) return;
  const prev = map.get(key);
  if (!prev || (prev.deleted && !loan.deleted)) map.set(key, loan);
}

export function indexBook(book) {
  const loans = (book && book.loans || []).map(normalizeLoan).filter(Boolean);
  const clients = (book && book.clients || []).map(normalizeClient).filter(Boolean);
  const mandates = (book && book.mandates || []).filter(Boolean);
  const byId = new Map(loans.map(l => [l.id, l]));
  const byContract = new Map();
  const byMandate = new Map();
  const byClient = new Map();
  const clientById = new Map(clients.map(c => [c.id, c]));
  const clientByRef = new Map();
  for (const loan of loans) {
    prefer(byContract, normKey(loan.contractRef), loan);
    prefer(byMandate, normKey(loan.mandateId), loan);
    if (loan.clientId) {
      if (!byClient.has(loan.clientId)) byClient.set(loan.clientId, []);
      byClient.get(loan.clientId).push(loan);
    }
  }
  for (const client of clients) {
    const key = normKey(client.ref);
    if (key && !clientByRef.has(key)) clientByRef.set(key, client);
    const own = byClient.get(client.id) || [];
    if (client.mandateRef && own.length === 1) prefer(byMandate, normKey(client.mandateRef), own[0]);
  }
  for (const mandate of mandates) {
    const ref = normKey(mandate.mandate_ref || mandate.mandateRef || '');
    const loan = byId.get(String(mandate.loan_id || mandate.loanId || ''));
    if (ref && loan) prefer(byMandate, ref, loan);
  }
  const byClientRef = new Map();
  for (const [key, client] of clientByRef) byClientRef.set(key, byClient.get(client.id) || []);
  return { loans, clients, clientById, byContract, byMandate, byClientRef };
}

export function amountsAgree(row, instalment) {
  if (instalment == null || !Number.isFinite(Number(instalment))) return { ok: true, checked: false };
  if (row.originalAmount != null) {
    return {
      ok: withinTolerance(instalment, row.originalAmount),
      checked: true,
      compared: 'original',
      expected: instalment,
      actual: row.originalAmount
    };
  }
  const quotes = pifQuotes(instalment);
  if (row.pifValue != null && row.debitAmount != null) {
    const implied = round2(row.debitAmount - row.pifValue);
    if (withinTolerance(instalment, implied)) return { ok: true, checked: true, compared: 'pif' };
  }
  if (row.pifValue != null && row.instalmentAmount != null && row.debitAmount == null) {
    const implied = round2(row.instalmentAmount - row.pifValue);
    if (withinTolerance(instalment, implied)) return { ok: true, checked: true, compared: 'pif' };
  }
  const candidate = row.debitAmount != null ? row.debitAmount : row.instalmentAmount;
  if (candidate != null) {
    return { ok: withinTolerance(candidate, quotes.debit), checked: true, compared: 'formula', expected: quotes.debit, actual: candidate };
  }
  return { ok: true, checked: false };
}

function dateAgrees(row, loan) {
  if (row.dateMiss) return { ok: false, checked: true };
  if (!row.actionDate) return { ok: true, checked: false };
  if (!loan.schedule.length || !loan.schedule.includes(row.actionDate)) return { ok: false, checked: true };
  return { ok: true, checked: true };
}

function pickClientLoan(loans, row) {
  if (!loans || !loans.length) return null;
  if (loans.length === 1) return loans[0];
  const fits = loans.filter(loan => amountsAgree(row, loan.instalmentAmount).ok);
  return fits.length === 1 ? fits[0] : null;
}

function locate(row, index) {
  const steps = [
    ['contract', row.contractReference, index.byContract],
    ['mandate', row.mandateId, index.byMandate]
  ];
  for (const [how, raw, map] of steps) {
    const key = normKey(raw);
    if (!key) continue;
    const loan = map.get(key);
    if (loan) return { loan, how };
  }
  const clientKey = normKey(row.clientReference);
  if (clientKey) {
    const loans = index.byClientRef.get(clientKey) || [];
    const loan = pickClientLoan(loans, row);
    if (loan) return { loan, how: 'client' };
    if (loans.length > 1) return { loan: null, how: 'client-ambiguous' };
  }
  return { loan: null, how: '' };
}

function cell(row, index) {
  if (index == null || index < 0) return '';
  return row[index] == null ? '' : String(row[index]).trim();
}

function resolveFields(header, mapping) {
  const detected = detectHeaders(header);
  if (!mapping) return detected;
  const fields = {};
  for (const [field, index] of Object.entries(mapping)) {
    if (!Object.prototype.hasOwnProperty.call(FIELD_ALIASES, field)) continue;
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0) continue;
    fields[field] = n;
  }
  return { fields, recognized: JOIN_FIELDS.some(name => Object.prototype.hasOwnProperty.call(fields, name)) };
}

function findHeaderRow(grid) {
  const limit = Math.min(grid.length, 8);
  for (let i = 0; i < limit; i++) {
    if (detectHeaders(grid[i]).recognized) return i;
  }
  return 0;
}

function blankData(row) {
  const text = [row.contractReference, row.mandateId, row.clientReference, row.actionDate, row.statusText, row.fileName];
  if (text.some(v => String(v || '').trim())) return false;
  return [row.debitAmount, row.originalAmount, row.instalmentAmount, row.totalAmount, row.pifValue].every(v => v == null || v === 0);
}

function buildRows(grid, headerIndex, fields, meta) {
  const out = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const src = grid[i] || [];
    const statusText = cell(src, fields.status);
    const reason = cell(src, fields.reason);
    let statusKind = classifyStatus(statusText);
    if ((!statusKind || statusKind === 'other') && reason) {
      const fromReason = classifyStatus(reason);
      if (fromReason && fromReason !== 'other') statusKind = fromReason;
    }
    const instalmentNumber = fields.instalmentNumber == null ? null : intOf(cell(src, fields.instalmentNumber)) || null;
    const row = {
      line: i + 1,
      contractReference: cell(src, fields.contractReference),
      mandateId: cell(src, fields.mandateId),
      clientReference: cell(src, fields.clientReference),
      actionDate: parseDate(cell(src, fields.actionDate)),
      originalAmount: parseMoney(cell(src, fields.originalAmount)),
      pifValue: parseMoney(cell(src, fields.pifValue)),
      instalmentAmount: parseMoney(cell(src, fields.instalmentAmount)),
      totalAmount: parseMoney(cell(src, fields.totalAmount)),
      debitAmount: parseMoney(cell(src, fields.debitAmount)),
      statusText,
      statusKind,
      reason,
      instalmentNumber,
      fileName: cell(src, fields.name),
      sourceFile: meta.sourceName || '',
      sourceRole: meta.sourceRole || ''
    };
    if (row.debitAmount == null && row.actionDate && row.originalAmount == null && row.instalmentAmount != null) {
      row.debitAmount = row.instalmentAmount;
    }
    if (blankData(row)) continue;
    out.push(row);
  }
  return out;
}

export function amountsAndDate(row, loan) {
  const dated = Object.assign({}, row);
  dated.dateMiss = false;
  if (!dated.actionDate && dated.instalmentNumber) {
    const at = dated.instalmentNumber - 1;
    if (at >= 0 && at < loan.schedule.length) dated.actionDate = loan.schedule[at];
    else dated.dateMiss = true;
  }
  const amount = amountsAgree(dated, loan.instalmentAmount);
  const date = dateAgrees(dated, loan);
  return { row: dated, amount, date };
}

export function previewLoan(loan, rows) {
  let paidDates = loan.paidDates.slice();
  let paidCount = loan.instalmentsPaid;
  const notes = [];
  const ordered = rows.slice().sort((a, b) => String(a.actionDate).localeCompare(String(b.actionDate)) || (a.line || 0) - (b.line || 0));
  for (const row of ordered) {
    const iso = row.actionDate || '';
    if (row.effect === 'pay') {
      if (row.outcome !== 'matched') {
        notes.push({ applied: false, text: 'Not applied. The amount or the date does not agree with the book.' });
        continue;
      }
      if (!iso || paidDates.includes(iso)) {
        notes.push({ applied: false, text: paidDates.includes(iso) ? 'Already in paid dates.' : 'No action date.' });
        continue;
      }
      paidDates.push(iso);
      paidCount += 1;
      if (loan.schedule.length) paidCount = Math.min(paidCount, loan.schedule.length);
      notes.push({ applied: true, text: 'Success would add this date.' });
    } else if (row.effect === 'reverse') {
      if (iso && paidDates.includes(iso)) {
        paidDates = paidDates.filter(d => d !== iso);
        paidCount = Math.max(0, paidCount - 1);
        notes.push({ applied: true, text: 'Reversal would remove this paid date. It does not add a payment.' });
      } else {
        notes.push({ applied: false, text: 'Reversal does not add a payment. No matching paid date to remove.' });
      }
    } else {
      notes.push({ applied: false, text: 'This status does not count as paid.' });
    }
  }
  const paidOut = paidDates.slice().sort();
  const bookDates = loan.paidDates.slice().sort();
  const unchanged = paidCount === loan.instalmentsPaid && paidOut.length === bookDates.length && paidOut.every((d, i) => d === bookDates[i]);
  return { instalments_paid: paidCount, paid_dates: paidOut, notes, unchanged };
}

function emptyReport(extra) {
  return Object.assign({
    empty: true,
    needsMapping: false,
    headers: [],
    headerFields: {},
    rows: [],
    groups: [],
    summary: { matched: 0, loanFound: 0, mismatched: 0, unknown: 0, tiles: { Matched: 0, 'Loan found': 0, Mismatched: 0, Unknown: 0 }, byStatus: [] },
    sources: []
  }, extra || {});
}

export function badgeCounts(rows) {
  const counts = { Matched: 0, 'Loan found': 0, Mismatched: 0, Unknown: 0 };
  for (const row of rows || []) counts[matchBadge(row).label] += 1;
  return counts;
}

function summarise(rows) {
  const tiles = badgeCounts(rows);
  const byStatus = [];
  const totals = new Map();
  for (const row of rows) {
    const label = statusLabel(row.statusKind);
    const money = row.debitAmount != null ? row.debitAmount : row.instalmentAmount != null ? row.instalmentAmount : row.originalAmount != null ? row.originalAmount : 0;
    const bucket = totals.get(label) || { status: label, count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount = round2(bucket.amount + (money || 0));
    totals.set(label, bucket);
  }
  totals.forEach(bucket => byStatus.push(bucket));
  return {
    matched: tiles.Matched,
    loanFound: tiles['Loan found'],
    mismatched: tiles.Mismatched,
    unknown: tiles.Unknown,
    tiles,
    byStatus
  };
}

function finish(rows, book, meta) {
  const index = indexBook(book);
  const publicRows = [];
  for (const raw of rows) {
    const found = locate(raw, index);
    let row = raw;
    let amount = { ok: true, checked: false };
    let date = { ok: true, checked: false };
    if (found.loan) {
      const judged = amountsAndDate(raw, found.loan);
      row = judged.row;
      amount = judged.amount;
      date = judged.date;
    }
    const outcome = !found.loan ? 'unknown' : (!amount.ok || !date.ok) ? 'mismatched' : 'matched';
    const client = found.loan ? index.clientById.get(found.loan.clientId) : null;
    const item = {
      line: row.line,
      outcome,
      how: found.how,
      loanId: found.loan ? found.loan.id : '',
      contractReference: row.contractReference,
      mandateId: row.mandateId,
      clientReference: row.clientReference,
      actionDate: row.actionDate || '',
      originalAmount: row.originalAmount,
      pifValue: row.pifValue,
      instalmentAmount: row.instalmentAmount,
      totalAmount: row.totalAmount,
      debitAmount: row.debitAmount,
      statusText: row.statusText,
      statusKind: row.statusKind,
      statusLabel: statusLabel(row.statusKind),
      reason: row.reason,
      instalmentNumber: row.instalmentNumber,
      effect: effectOf(row.statusKind),
      amountOk: !!amount.ok,
      dateOk: !!date.ok,
      sourceFile: row.sourceFile,
      sourceRole: row.sourceRole,
      fileName: outcome === 'unknown' ? row.fileName : '',
      nupayAmount: row.debitAmount != null ? row.debitAmount : row.originalAmount != null ? row.originalAmount : row.instalmentAmount,
      bookAmount: found.loan ? found.loan.instalmentAmount : null
    };
    publicRows.push(item);
  }
  const groups = [];
  const byLoan = new Map();
  const unknown = [];
  for (const item of publicRows) {
    if (!item.loanId) { unknown.push(item); continue; }
    if (!byLoan.has(item.loanId)) byLoan.set(item.loanId, []);
    byLoan.get(item.loanId).push(item);
  }
  for (const [loanId, items] of byLoan) {
    const loan = index.loans.find(l => l.id === loanId);
    const client = index.clientById.get(loan.clientId);
    groups.push({
      loanId,
      ref: loan.ref,
      clientName: client && client.name ? client.name : '',
      contractRef: loan.contractRef,
      mandateId: loan.mandateId,
      status: loan.status,
      deleted: loan.deleted,
      settled: /^(paid|settled|settled_early)$/.test(loan.status),
      writtenOff: loan.status === 'written_off' || loan.status === 'written off',
      instalmentAmount: loan.instalmentAmount,
      instalmentsPaid: loan.instalmentsPaid,
      paidDates: loan.paidDates.slice(),
      schedule: loan.schedule.slice(),
      outstanding: loan.outstanding,
      rows: items,
      preview: previewLoan(loan, items)
    });
  }
  if (unknown.length) {
    groups.push({
      loanId: '',
      ref: '',
      clientName: '',
      unknown: true,
      rows: unknown,
      preview: null
    });
  }
  return {
    empty: publicRows.length === 0,
    needsMapping: false,
    headers: meta.headers || [],
    headerFields: meta.headerFields || {},
    rows: publicRows,
    groups,
    summary: summarise(publicRows),
    sources: meta.sources || []
  };
}

export function analyseGrid(grid, book, options) {
  const opts = options || {};
  const rowsIn = grid || [];
  if (isEmptyStatusGrid(rowsIn)) return emptyReport({ sources: opts.sources || [], fileName: opts.sourceName || '' });
  const headerIndex = opts.headerIndex != null ? opts.headerIndex : findHeaderRow(rowsIn);
  const header = rowsIn[headerIndex] || [];
  const mapped = resolveFields(header, opts.mapping);
  if (!mapped.recognized) {
    return emptyReport({
      empty: false,
      needsMapping: true,
      headers: header.map(cell => String(cell == null ? '' : cell)),
      fileName: opts.sourceName || ''
    });
  }
  const built = buildRows(rowsIn, headerIndex, mapped.fields, opts);
  return finish(built, book || { loans: [], clients: [], mandates: [] }, {
    headers: header.map(cell => String(cell == null ? '' : cell)),
    headerFields: mapped.fields,
    sources: opts.sources || []
  });
}

export function analyseText(text, book, options) {
  const grid = parseCsv(text);
  return analyseGrid(grid, book, options);
}

function decodeCsv(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

export async function analyseBuffer(buffer, fileName, book) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length > MAX_BYTES) {
    return emptyReport({ empty: false, error: 'That file is too large to read in the browser.' });
  }
  const zip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!zip) return analyseText(decodeCsv(bytes), book, { sourceName: fileName || '' });
  const entries = await unzip(bytes);
  const workbook = entries.some(e => /xl\/worksheets\/sheet\d+\.xml$/i.test(e.name));
  if (workbook || /\.xlsx$/i.test(fileName || '')) {
    const grid = await xlsxGrid(entries);
    return analyseGrid(grid, book, { sourceName: fileName || '' });
  }
  const csvs = entries.filter(e => /\.csv$/i.test(e.name));
  if (!csvs.length) return emptyReport({ empty: false, error: 'The zip has no CSV files.' });
  const sources = [];
  const grids = [];
  for (const entry of csvs) {
    const grid = parseCsv(decodeCsv(entry.bytes));
    const role = roleFromName(entry.name);
    const empty = isEmptyStatusGrid(grid);
    sources.push({ name: entry.name.split('/').pop(), role, rows: empty ? 0 : Math.max(0, grid.length - 1) });
    if (!empty) grids.push({ grid, name: entry.name.split('/').pop(), role });
  }
  if (!grids.length) return emptyReport({ sources, fileName: fileName || '' });
  const combined = [];
  let headers = [];
  let headerFields = {};
  let needsMapping = false;
  for (const part of grids) {
    const report = analyseGrid(part.grid, book, { sourceName: part.name, sourceRole: part.role, sources });
    if (report.needsMapping) needsMapping = true;
    if (!headers.length) headers = report.headers;
    headerFields = Object.assign(headerFields, report.headerFields);
    combined.push(report);
  }
  if (needsMapping && combined.every(r => r.needsMapping)) {
    return emptyReport({ empty: false, needsMapping: true, headers, sources, fileName: fileName || '' });
  }
  const rows = combined.flatMap(r => r.rows);
  const groups = [];
  const seen = new Set();
  for (const report of combined) {
    for (const group of report.groups) {
      if (!group.loanId) continue;
      if (seen.has(group.loanId)) continue;
      seen.add(group.loanId);
      const same = combined.flatMap(r => r.groups.filter(g => g.loanId === group.loanId).flatMap(g => g.rows));
      const loan = {
        id: group.loanId,
        ref: group.ref,
        clientId: '',
        contractRef: group.contractRef,
        mandateId: group.mandateId,
        instalmentAmount: group.instalmentAmount,
        schedule: group.schedule,
        paidDates: group.paidDates,
        instalmentsPaid: group.instalmentsPaid,
        status: group.status,
        deleted: group.deleted,
        outstanding: group.outstanding
      };
      groups.push(Object.assign({}, group, { rows: same, preview: previewLoan(normalizeLoan(loan), same) }));
    }
  }
  const unknown = rows.filter(r => r.outcome === 'unknown');
  if (unknown.length) groups.push({ loanId: '', ref: '', clientName: '', unknown: true, rows: unknown, preview: null });
  return {
    empty: rows.length === 0,
    needsMapping: false,
    headers,
    headerFields,
    rows,
    groups,
    summary: summarise(rows),
    sources
  };
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function reportToCsv(report) {
  const header = [
    'match', 'loan_ref', 'book_status', 'deleted', 'settled',
    'contract_reference', 'mandate_id', 'client_reference', 'action_date',
    'debit_amount', 'original_amount', 'pif_value', 'instalment_amount',
    'status', 'instalment_number', 'amount_ok', 'date_ok',
    'book_instalments_paid', 'preview_instalments_paid', 'book_paid_dates', 'preview_paid_dates',
    'book_outstanding', 'book_client_name', 'source_file'
  ];
  const groups = report && report.groups || [];
  const byLoan = new Map(groups.filter(g => g.loanId).map(g => [g.loanId, g]));
  const lines = [header.join(',')];
  for (const row of (report && report.rows) || []) {
    const group = byLoan.get(row.loanId);
    const values = [
      matchBadge(row).label,
      group ? group.ref : '',
      group ? bookStatusLabel(group.status) : '',
      group && group.deleted ? 'yes' : '',
      group && group.settled ? 'yes' : '',
      row.contractReference,
      row.mandateId,
      row.clientReference,
      row.actionDate,
      row.debitAmount == null ? '' : row.debitAmount,
      row.originalAmount == null ? '' : row.originalAmount,
      row.pifValue == null ? '' : row.pifValue,
      row.instalmentAmount == null ? '' : row.instalmentAmount,
      row.statusLabel,
      row.instalmentNumber == null ? '' : row.instalmentNumber,
      row.amountOk ? 'yes' : 'no',
      row.dateOk ? 'yes' : 'no',
      group ? group.instalmentsPaid : '',
      group && group.preview ? group.preview.instalments_paid : '',
      group ? group.paidDates.join('|') : '',
      group && group.preview ? group.preview.paid_dates.join('|') : '',
      group && group.outstanding != null ? group.outstanding : '',
      (group && group.clientName) || row.fileName || '',
      row.sourceFile || ''
    ];
    lines.push(values.map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

export function readLiveBook() {
  const db = typeof window !== 'undefined' ? window.__ledgerDb : null;
  if (db && typeof db.rows === 'function') {
    let mandates = [];
    try { mandates = typeof db.table === 'function' ? db.table('mandates') || [] : []; } catch (e) { mandates = []; }
    return {
      loans: db.rows('loans', { includeDeleted: true }) || [],
      clients: db.rows('clients', { includeDeleted: true }) || [],
      mandates
    };
  }
  return { loans: [], clients: [], mandates: [] };
}

function currentBook() { return bookOverride || readLiveBook(); }

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = round2(n);
  const neg = v < 0;
  const a = Math.abs(v);
  const whole = Math.floor(a + 1e-9);
  const c = Math.round((a - whole) * 100);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '-R ' : 'R ') + grouped + (c ? '.' + String(c).padStart(2, '0') : '');
}

function labelDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso ? String(iso) : '—';
  return (+m[3]) + ' ' + MONTH_LABELS[+m[2] - 1] + ' ' + m[1];
}

function fmtDates(dates) {
  const labels = (dates || []).map(labelDate).filter(d => d && d !== '—');
  if (!labels.length) return 'none';
  if (labels.length <= 4) return labels.join(', ');
  return labels.length + ' dates · next ' + labels[0] + ' · last ' + labels[labels.length - 1];
}

function bookStatusLabel(status) {
  const raw = String(status || '').trim();
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
  const named = {
    settled_early: 'Settled early', written_off: 'Written off', paid: 'Paid', issued: 'Issued',
    overdue: 'Overdue', duetoday: 'Due today', settled: 'Settled'
  };
  if (named[key]) return named[key];
  if (!raw) return '';
  const words = raw.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function outcomeClass(kind) {
  if (kind === 'success') return 'is-ok';
  if (kind === 'reversed' || kind === 'failed') return 'is-bad';
  if (kind === 'disputed') return 'is-warn';
  return 'is-neutral';
}

export function matchBadge(row) {
  const outcome = row && row.outcome;
  const kind = row && row.statusKind;
  if (outcome === 'unknown') return { label: 'Unknown', tone: 'neutral' };
  if (outcome === 'mismatched') return { label: 'Mismatched', tone: 'warn' };
  if (outcome === 'matched' && kind === 'success') return { label: 'Matched', tone: 'ok' };
  return { label: 'Loan found', tone: 'neutral' };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function acceptedFile(name) {
  return /\.(csv|xlsx|zip)$/i.test(String(name || ''));
}

const CSS = `
body.nupay-open{overflow:hidden}
body.nupay-open [aria-label="Ask Q1"],
body.nupay-open dc-import{display:none !important}
#nupay-report-scrim{position:fixed;inset:0;z-index:400;display:flex;flex-direction:column;overflow:hidden;background:#0c0c0a;background:var(--panel,#0c0c0a);color:var(--ink,#f5f4ee);font:500 14px/1.45 'Plus Jakarta Sans',system-ui,sans-serif}
#nupay-report-scrim[hidden]{display:none !important}
.np-bar{flex:none;display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0c0c0a;background:var(--panel,#0c0c0a);border-bottom:1px solid var(--line,#2a2a25);position:sticky;top:0;z-index:2}
.np-title{margin:0;font:700 18px/1.2 'Plus Jakarta Sans',sans-serif;letter-spacing:-.02em}
.np-preview-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 10px;font:700 12px 'Plus Jakarta Sans',sans-serif;background:var(--accSoft,rgba(217,160,102,.16));color:var(--accText,#d9a066)}
.np-bar-gap{flex:1}
.np-btn{appearance:none;border:1px solid var(--line2,#3a3933);background:var(--panel2,#111110);color:var(--ink,#f5f4ee);border-radius:10px;min-height:40px;padding:8px 14px;font:700 14px 'Plus Jakarta Sans',sans-serif;cursor:pointer}
.np-btn:focus-visible,.np-choose:focus-visible,.np-drop:focus-within{outline:2px solid #f3e27a;outline-offset:2px}
.np-btn:disabled{opacity:.45;cursor:default}
.np-btn.primary{background:var(--acc,#c3f53c);color:var(--accInk,#101408);border-color:transparent}
.np-scroll{flex:1;min-height:0;overflow:auto;background:#0c0c0a;background:var(--panel,#0c0c0a);padding:16px}
.np-drop{border:1px dashed var(--line2,#3a3933);border-radius:12px;padding:22px 16px;text-align:center;background:var(--panel2,#111110)}
#nupay-tab-drop{max-width:560px;margin-top:8px}
.np-drop.is-hot{border-color:var(--acc,#c3f53c)}
.np-drop h3{margin:0 0 6px;font:700 16px 'Plus Jakarta Sans',sans-serif}
.np-drop p{margin:0;color:var(--mut,#b3b0a4)}
.np-choose{margin-top:12px}
.np-state{margin-top:12px;padding:12px 14px;border-radius:10px;background:var(--panel2,#111110);border:1px solid var(--line,#2a2a25)}
.np-state.is-error{border-color:#ffb4a8;color:#ffe1d8}
.np-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}
.np-loaded{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--line2,#3a3933);border-radius:10px;background:var(--panel2,#111110)}
.np-loaded span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-tile{display:flex;flex-direction:column;align-items:flex-start;background:var(--panel2,#111110);border:1px solid var(--line2,#3a3933);border-radius:10px;padding:12px;min-height:84px}
.np-tile .act-k{font:600 12px 'Plus Jakarta Sans',sans-serif;color:#e7e2d6}
.np-tile .act-n{font:700 28px 'Plus Jakarta Sans',sans-serif;font-variant-numeric:tabular-nums;line-height:1.15;margin-top:4px;color:#f7f4ee}
.np-tile .act-s{font:500 13px 'Plus Jakarta Sans',sans-serif;color:#ddd8cc;margin-top:2px}
.np-status{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
.np-status th,.np-status td{text-align:left;padding:6px 10px 6px 0;border-bottom:1px solid var(--line,#2a2a25);font-weight:500}
.np-loan{margin-top:16px;padding-top:12px;border-top:1px solid var(--line,#2a2a25)}
.np-loan h3{margin:0;font:700 16px 'Plus Jakarta Sans',sans-serif}
.np-meta{margin:4px 0 0;color:var(--mut,#b3b0a4);font-size:13px}
.np-book{margin-top:8px;font-size:14px}
.np-pay{display:grid;grid-template-columns:8.5rem 7rem auto auto minmax(0,1fr);gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--line,#2a2a25)}
.np-k{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.np-pill{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font:700 12px 'Plus Jakarta Sans',sans-serif;border:1px solid transparent}
.np-pill.is-ok{background:var(--greenSoft,rgba(143,185,138,.16));color:var(--green,#8fb98a)}
.np-pill.is-bad{background:var(--redSoft,rgba(224,138,118,.16));color:#ffb4a8}
.np-pill.is-warn{background:var(--amberSoft,rgba(219,178,106,.16));color:var(--amber,#dbb26a)}
.np-pill.is-neutral{background:var(--panel2,#111110);color:var(--mut,#b3b0a4);border-color:var(--line2,#3a3933)}
.np-diff{margin:4px 0 0;font-size:13px;color:var(--amber,#dbb26a)}
.np-preview{margin-top:8px;padding:8px 10px;border:1px dashed var(--line2,#3a3933);border-radius:10px;background:var(--panel2,#111110)}
.np-map{margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
.np-map label{display:flex;flex-direction:column;gap:4px;font:600 12px 'Plus Jakarta Sans',sans-serif;color:var(--dim,#8a8778)}
.np-map select{background:var(--panel2,#111110);color:var(--ink,#f5f4ee);border:1px solid var(--line2,#3a3933);border-radius:8px;padding:8px;font:500 14px 'Plus Jakarta Sans',sans-serif}
@media (max-width:640px){
  .np-tiles{grid-template-columns:1fr 1fr}
  .np-pay{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:10px 0}
  .np-k{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto;display:block;font:600 11px 'Plus Jakarta Sans',sans-serif;color:var(--dim,#8a8778)}
  .np-bar{flex-wrap:wrap}
}
`;

function mount(host) {
  if (!host || host.dataset.nupayReady) return;
  host.dataset.nupayReady = '1';
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const scrim = el('div', '');
  scrim.id = 'nupay-report-scrim';
  scrim.hidden = true;
  scrim.tabIndex = -1;
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');
  scrim.setAttribute('aria-labelledby', 'nupay-title');
  document.body.appendChild(scrim);

  const bar = el('div', 'np-bar');
  const title = el('h2', 'np-title', 'NuPay transaction report');
  title.id = 'nupay-title';
  const badge = el('span', 'np-preview-badge', 'Preview only');
  const gap = el('div', 'np-bar-gap');
  const exp = el('button', 'np-btn', 'Export CSV');
  exp.type = 'button';
  exp.id = 'nupay-report-export';
  exp.disabled = true;
  const closeBtn = el('button', 'np-btn', 'Close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close NuPay report');
  bar.append(title, badge, gap, exp, closeBtn);

  const scroll = el('div', 'np-scroll');
  scroll.id = 'nupay-report-scroll';
  scrim.append(bar, scroll);

  let opener = null;
  let lastReport = null;
  let pending = null;
  let loadedName = '';

  function focusables() {
    return [...scrim.querySelectorAll('button, input, select, a, [href], [tabindex]:not([tabindex="-1"])')].filter(node => !node.disabled && !node.hidden);
  }
  function onKey(ev) {
    if (scrim.hidden) return;
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
  function open(from) {
    opener = from && from.focus ? from : document.activeElement;
    scrim.hidden = false;
    document.body.classList.add('nupay-open');
    document.querySelectorAll('[aria-label="Ask Q1"], dc-import').forEach(node => { node.dataset.nupayHide = node.style.display; node.style.display = 'none'; });
    closeBtn.focus();
  }
  function close() {
    scrim.hidden = true;
    document.body.classList.remove('nupay-open');
    document.querySelectorAll('[data-nupay-hide]').forEach(node => { node.style.display = node.dataset.nupayHide || ''; delete node.dataset.nupayHide; });
    if (opener && opener.focus) opener.focus();
  }
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  function bindTabEntry() {
    const drop = document.getElementById('nupay-tab-drop');
    if (!drop || drop.dataset.bound) return;
    drop.dataset.bound = '1';
    const choose = document.getElementById('nupay-tab-choose');
    const input = document.getElementById('nupay-tab-file');
    if (choose && input) choose.addEventListener('click', () => input.click());
    if (input) input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) { open(choose); readFile(file); }
      input.value = '';
    });
    drop.addEventListener('dragover', ev => { ev.preventDefault(); drop.classList.add('is-hot'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-hot'));
    drop.addEventListener('drop', ev => {
      ev.preventDefault();
      drop.classList.remove('is-hot');
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) { open(choose); readFile(file); }
    });
  }
  bindTabEntry();
  new MutationObserver(bindTabEntry).observe(document.body, { childList: true, subtree: true });

  function setExport(on) { exp.disabled = !on; }
  exp.addEventListener('click', () => { if (lastReport && lastReport.rows && lastReport.rows.length) downloadCsv(lastReport); });

  function drawShell() {
    scroll.textContent = '';
    const input = document.createElement('input');
    input.id = 'nupay-report-file';
    input.type = 'file';
    input.accept = '.csv,.xlsx,.zip,text/csv';
    input.hidden = true;
    input.setAttribute('aria-label', 'NuPay file');
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) readFile(file);
      input.value = '';
    });
    if (loadedName) {
      const loaded = el('div', 'np-loaded');
      loaded.id = 'nupay-loaded';
      loaded.appendChild(el('span', '', loadedName));
      const replace = el('button', 'np-btn', 'Replace file');
      replace.type = 'button';
      replace.addEventListener('click', () => input.click());
      loaded.append(replace, input);
      scroll.appendChild(loaded);
    } else {
      const drop = el('div', 'np-drop');
      drop.id = 'nupay-drop';
      drop.appendChild(el('h3', '', 'Upload a NuPay file'));
      drop.appendChild(el('p', '', 'CSV, XLSX, or a NuPay zip. Up to 10 MB. Nothing is uploaded or written.'));
      const choose = el('button', 'np-btn primary np-choose', 'Choose file');
      choose.type = 'button';
      choose.id = 'nupay-choose';
      choose.addEventListener('click', () => input.click());
      drop.addEventListener('dragover', ev => { ev.preventDefault(); drop.classList.add('is-hot'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-hot'));
      drop.addEventListener('drop', ev => {
        ev.preventDefault();
        drop.classList.remove('is-hot');
        const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (file) readFile(file);
      });
      drop.append(choose, input);
      scroll.appendChild(drop);
    }
    const state = el('div', '');
    state.id = 'nupay-state';
    scroll.appendChild(state);
    const results = el('div', '');
    results.id = 'nupay-results';
    scroll.appendChild(results);
    return { state, results };
  }

  function showState(kind, text) {
    const state = document.getElementById('nupay-state');
    if (!state) return;
    state.textContent = '';
    if (!text) return;
    const box = el('div', 'np-state' + (kind === 'error' ? ' is-error' : ''), text);
    box.id = kind === 'error' ? 'nupay-error' : 'nupay-note';
    if (kind === 'error') box.setAttribute('role', 'alert');
    else box.setAttribute('role', 'status');
    state.appendChild(box);
  }

  function render(report, message, kind) {
    const parts = drawShell();
    showState(kind || (message ? 'error' : ''), message || '');
    setExport(!!(report && report.rows && report.rows.length));
    if (report && report.needsMapping) drawMap(parts.results, report);
    if (report && report.rows && report.rows.length) {
      drawTiles(parts.results, report);
      drawGroups(parts.results, report.groups || []);
    } else if (report && report.empty && !message) {
      showState('empty', 'This file has no rows.');
    }
  }

  function drawMap(root, report) {
    const box = el('div', 'np-map');
    box.id = 'nupay-report-map';
    box.appendChild(el('p', 'np-meta', 'These headers were not recognised. Choose the columns. This still changes nothing on the book.'));
    const fields = [
      ['contractReference', 'Contract reference'],
      ['mandateId', 'Mandate ID'],
      ['clientReference', 'Client reference'],
      ['actionDate', 'Action date'],
      ['debitAmount', 'Amount'],
      ['originalAmount', 'Original amount'],
      ['pifValue', 'PIF value'],
      ['instalmentAmount', 'Instalment amount'],
      ['status', 'Status'],
      ['reason', 'Reason'],
      ['instalmentNumber', 'Instalment number'],
      ['name', 'Name on the file']
    ];
    fields.forEach(([field, label]) => {
      const lab = el('label', '', label);
      const sel = document.createElement('select');
      sel.dataset.field = field;
      sel.setAttribute('aria-label', label);
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Skip';
      sel.appendChild(blank);
      (report.headers || []).forEach((header, index) => {
        const opt = document.createElement('option');
        opt.value = String(index);
        opt.textContent = header || ('Column ' + (index + 1));
        sel.appendChild(opt);
      });
      lab.appendChild(sel);
      box.appendChild(lab);
    });
    const go = el('button', 'np-btn primary', 'Use this mapping');
    go.type = 'button';
    go.addEventListener('click', () => {
      if (!pending) return;
      const mapping = {};
      box.querySelectorAll('select[data-field]').forEach(sel => { if (sel.value !== '') mapping[sel.dataset.field] = Number(sel.value); });
      try {
        const next = analyseGrid(pending.grid, currentBook(), { mapping, sourceName: pending.fileName });
        lastReport = next;
        render(next, next.needsMapping ? 'Pick at least a contract reference, mandate ID, or client reference.' : '', next.needsMapping ? 'error' : '');
      } catch (err) {
        render(null, (pending && pending.fileName ? pending.fileName + ' could not be read.' : 'That file could not be read.'), 'error');
      }
    });
    box.appendChild(go);
    root.appendChild(box);
  }

  function drawTiles(root, report) {
    const tiles = el('div', 'np-tiles');
    tiles.id = 'nupay-report-summary';
    [['Matched', report.summary.matched, 'Success, and the loan, amount, and date agree'], ['Loan found', report.summary.loanFound, 'Loan found, no matched payment yet'], ['Mismatched', report.summary.mismatched, "Loan found, amount or date doesn't agree"], ['Unknown', report.summary.unknown, 'No loan on the loaded book']].forEach(([label, count, sub]) => {
      const tile = el('div', 'np-tile');
      tile.append(el('span', 'act-k', label), el('span', 'act-n', String(count)), el('span', 'act-s', sub));
      tiles.appendChild(tile);
    });
    root.appendChild(tiles);
    if (report.summary.byStatus.length) {
      const table = document.createElement('table');
      table.className = 'np-status';
      const head = document.createElement('tr');
      ['Status', 'Rows', 'Amount'].forEach(label => head.appendChild(el('th', '', label)));
      table.appendChild(head);
      report.summary.byStatus.forEach(bucket => {
        const tr = document.createElement('tr');
        tr.append(el('td', '', bucket.status), el('td', '', String(bucket.count)), el('td', '', money(bucket.amount)));
        table.appendChild(tr);
      });
      root.appendChild(table);
    }
  }

  function pill(text, cls) {
    const node = el('span', 'np-pill ' + cls, text);
    return node;
  }

  function payRow(row) {
    const line = el('div', 'np-pay');
    const date = el('div', '');
    date.append(el('span', 'np-k', 'Date'), document.createTextNode(labelDate(row.actionDate)));
    const amount = el('div', '');
    const shown = row.nupayAmount != null ? row.nupayAmount : row.debitAmount;
    amount.append(el('span', 'np-k', 'Amount'), document.createTextNode(money(shown)));
    const outcome = el('div', '');
    outcome.append(el('span', 'np-k', 'Outcome'), pill(row.statusLabel || '—', outcomeClass(row.statusKind)));
    const match = el('div', '');
    const badge = matchBadge(row);
    match.append(el('span', 'np-k', 'Match'), pill(badge.label, 'is-' + badge.tone));
    line.append(date, amount, outcome, match);
    const wrap = el('div', '');
    wrap.appendChild(line);
    if (row.outcome === 'mismatched' && row.nupayAmount != null && row.bookAmount != null) {
      wrap.appendChild(el('p', 'np-diff', 'NuPay ' + money(row.nupayAmount) + ' · book ' + money(row.bookAmount)));
    }
    return wrap;
  }

  function loanBlock(group) {
    const block = el('section', 'np-loan');
    block.appendChild(el('h3', '', (group.ref || 'Loan') + ' · ' + (group.clientName || 'Client')));
    const label = bookStatusLabel(group.status);
    if (label) block.appendChild(el('p', 'np-meta', label));
    const book = el('div', 'np-book');
    book.appendChild(el('div', '', 'Instalments paid: ' + group.instalmentsPaid));
    book.appendChild(el('div', '', 'Paid dates: ' + fmtDates(group.paidDates)));
    book.appendChild(el('div', '', 'Schedule: ' + fmtDates(group.schedule)));
    book.appendChild(el('div', '', 'Outstanding: ' + money(group.outstanding) + (group.instalmentAmount != null ? ' · instalment ' + money(group.instalmentAmount) : '')));
    block.appendChild(book);
    (group.rows || []).forEach(row => block.appendChild(payRow(row)));
    if (group.preview) {
      const preview = el('div', 'np-preview');
      if (group.preview.unchanged) preview.appendChild(el('div', '', 'No change'));
      else {
        preview.appendChild(el('div', '', 'Instalments paid ' + group.instalmentsPaid + ' → ' + group.preview.instalments_paid));
        preview.appendChild(el('div', '', 'Paid dates ' + fmtDates(group.paidDates) + ' → ' + fmtDates(group.preview.paid_dates)));
      }
      block.appendChild(preview);
    }
    return block;
  }

  function unknownBlock(group) {
    const block = el('section', 'np-loan');
    block.id = 'nupay-unknown';
    block.appendChild(el('h3', '', 'Unknown'));
    block.appendChild(el('p', 'np-meta', 'No loan on the loaded book.'));
    (group.rows || []).forEach(row => {
      if (row.fileName) block.appendChild(el('p', 'np-meta', row.fileName));
      block.appendChild(payRow(row));
    });
    return block;
  }

  function drawGroups(root, groups) {
    const wrap = el('div', '');
    wrap.id = 'nupay-report-loans';
    groups.forEach(group => wrap.appendChild(group.unknown ? unknownBlock(group) : loanBlock(group)));
    root.appendChild(wrap);
  }

  function downloadCsv(report) {
    const csv = reportToCsv(report);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nupay-match-report.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showState('status', 'Exported ' + (report.rows || []).length + ' rows');
  }

  async function readFile(file) {
    if (!acceptedFile(file.name)) {
      lastReport = null;
      loadedName = file.name;
      setExport(false);
      render(null, file.name + ': Use a CSV, XLSX, or NuPay zip.', 'error');
      return;
    }
    if (file.size > MAX_BYTES) {
      lastReport = null;
      loadedName = file.name;
      render(null, file.name + ' is over 10 MB.', 'error');
      return;
    }
    loadedName = file.name;
    render(null, 'Reading the file…', 'status');
    try {
      const buf = await file.arrayBuffer();
      const report = await analyseBuffer(buf, file.name, currentBook());
      lastReport = report;
      if (report.needsMapping) {
        pending = { grid: await gridFromFile(buf, file.name), fileName: file.name };
        render(report, 'Pick at least a contract reference, mandate ID, or client reference.', 'error');
      } else {
        pending = null;
        const msg = report.error ? (file.name + ' could not be read.') : '';
        render(report, msg, report.error ? 'error' : '');
      }
    } catch (err) {
      lastReport = null;
      pending = null;
      render(null, file.name + ' could not be read.', 'error');
    }
  }

  async function gridFromFile(buf, fileName) {
    const bytes = new Uint8Array(buf);
    const zip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (!zip) return parseCsv(new TextDecoder().decode(bytes));
    const entries = await unzip(bytes);
    if (entries.some(e => /xl\/worksheets\/sheet\d+\.xml$/i.test(e.name)) || /\.xlsx$/i.test(fileName || '')) return xlsxGrid(entries);
    const csv = entries.find(e => /\.csv$/i.test(e.name));
    return csv ? parseCsv(new TextDecoder().decode(csv.bytes)) : [];
  }

  render(null, '');
  const api = typeof window !== 'undefined' ? window.NuPayReport || {} : {};
  api.open = open;
  api.close = close;
  api.setBook = setBook;
  if (typeof window !== 'undefined') window.NuPayReport = api;
}

function boot() {
  if (typeof document === 'undefined') return;
  const host = document.getElementById('nupay-report-mount') || document.body;
  mount(host);
}
boot();
