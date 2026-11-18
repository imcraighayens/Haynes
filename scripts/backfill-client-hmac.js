// apply only after #37 review approval; backfill needs QUIK1_ID_HMAC_KEY
//
// Dry-run by default. Pass --commit to write. Prints counts only.
// Never prints an ID number, a phone, a client id, or an HMAC.
import { pathToFileURL } from 'node:url';
import { hmacKey, idHmac, phoneHmac } from '../api/_lib/sa-id.js';
import { select, update } from '../api/_lib/supabase.js';

export function planHmacBackfill(rows) {
  const counts = { scanned: 0, idHmac: 0, phoneHmac: 0, skipped: 0, invalid: 0 };
  const writes = [];
  for (const row of rows || []) {
    counts.scanned += 1;
    if (!row || row.deleted_at) {
      counts.skipped += 1;
      continue;
    }
    const idRaw = row.id_number == null ? '' : String(row.id_number).trim();
    const phoneRaw = row.phone == null ? '' : String(row.phone).trim();
    if (!idRaw && !phoneRaw) {
      counts.skipped += 1;
      continue;
    }
    const patch = {};
    let bad = false;
    if (idRaw) {
      const mac = idHmac(idRaw);
      if (!mac) bad = true;
      else if (row.id_hmac !== mac) {
        patch.id_hmac = mac;
        counts.idHmac += 1;
      }
    }
    if (phoneRaw) {
      const mac = phoneHmac(phoneRaw);
      if (!mac) bad = true;
      else if (row.phone_hmac !== mac) {
        patch.phone_hmac = mac;
        counts.phoneHmac += 1;
      }
    }
    if (bad) counts.invalid += 1;
    if (Object.keys(patch).length && row.id) writes.push({ id: row.id, patch });
    else if (!bad) counts.skipped += 1;
  }
  return { counts, writes };
}

export function formatCounts(counts) {
  return [
    'rows scanned: ' + counts.scanned,
    'id_hmac: ' + counts.idHmac,
    'phone_hmac: ' + counts.phoneHmac,
    'skipped: ' + counts.skipped,
    'invalid: ' + counts.invalid
  ].join('\n');
}

export async function runBackfill({ commit = false, log = console.log, err = console.error } = {}) {
  if (!hmacKey()) {
    err('QUIK1_ID_HMAC_KEY is required');
    return 1;
  }
  const rows = await select('clients', {
    select: 'id,id_number,phone,id_hmac,phone_hmac,deleted_at'
  });
  const plan = planHmacBackfill(rows);
  log(formatCounts(plan.counts));
  if (commit) {
    for (const write of plan.writes) await update('clients', { id: write.id }, write.patch);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBackfill({ commit: process.argv.includes('--commit') })
    .then(code => process.exit(code))
    .catch(error => {
      console.error(error && error.message ? error.message : 'Backfill failed');
      process.exit(1);
    });
}
