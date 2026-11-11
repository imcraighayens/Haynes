// Sources the Ledger applications inbox shows. Quik1 rows keep their console id
// prefix. Website rows keep the ew_ id the marketing route stored.

export const INBOX_SOURCES = ['quik1', 'ecoloan_web'];

export function inboxSourceFilter() {
  return 'in.(' + INBOX_SOURCES.join(',') + ')';
}

export function isInboxSource(source) {
  return INBOX_SOURCES.includes(String(source || ''));
}

export function consoleApplicationId(row) {
  const id = String(row && row.id || '');
  return String(row && row.source || '') === 'ecoloan_web' ? id : ('qk_' + id);
}

export function consoleSourceLabel(row) {
  if (String(row && row.source || '') === 'ecoloan_web') return 'Website';
  return row && row.client_id ? 'Quik1 · existing client' : 'Quik1 app';
}

// Same missing-relation check as the other readers. PostgREST reports PGRST205 when
// the table is absent from its schema cache; Postgres reports 42P01.
export function missingRelation(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = String((err && err.message) || '');
  return code === '42P01' || code === 'PGRST205' || /42P01|PGRST205/.test(msg);
}
