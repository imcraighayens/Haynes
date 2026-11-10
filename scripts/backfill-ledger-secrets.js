// Encrypt Ledger ID numbers and bank account numbers that are still plaintext.
//
// Dry-run is the default. Nothing is written, and plaintext is not cleared.
// --commit encrypts each pending value and, in the same update, sets the
// plaintext column to null. Rows that already have no plaintext are skipped,
// so a second commit is a no-op. A value that cannot be sealed is left as it
// is and counted as skipped.
//
// The keys are read from the environment. This file does not set them.
// Run order is in DEPLOY.md. Do not point this at production until that
// order has been followed on purpose.
//
//   node scripts/backfill-ledger-secrets.js
//   node scripts/backfill-ledger-secrets.js --commit
//   node scripts/backfill-ledger-secrets.js --commit --batch=100
import { pathToFileURL } from 'node:url';
import { HttpError } from '../api/_lib/http.js';
import {
  BACKFILL_TARGETS,
  assertSecretsReady,
  sealTargetField
} from '../api/_lib/ledger-secrets.js';

const DEFAULT_BATCH = 100;

function missingRelation(err) {
  const code = err && err.code;
  return code === '42P01' || code === '3F000' || code === 'PGRST106';
}

export async function runBackfill({ db, commit = false, batchSize = DEFAULT_BATCH, targets = BACKFILL_TARGETS } = {}) {
  if (!db || typeof db.list !== 'function' || typeof db.patch !== 'function') {
    throw new HttpError(503, 'Server not configured');
  }
  assertSecretsReady();
  const size = Math.max(1, Math.min(500, Number(batchSize) || DEFAULT_BATCH));
  const summary = { dryRun: !commit, commit: !!commit, wrote: 0, skipped: 0, tables: [] };
  for (const target of targets) {
    const stat = {
      schema: target.schema,
      table: target.table,
      rows: 0,
      ids: 0,
      accounts: 0,
      wrote: 0,
      skipped: 0,
      missing: false
    };
    let after = '';
    let guard = 0;
    while (guard < 10000) {
      guard += 1;
      let page;
      try {
        page = await db.list(target, { after, limit: size });
      } catch (err) {
        if (target.optional && missingRelation(err)) {
          stat.missing = true;
          break;
        }
        throw err;
      }
      const rows = Array.isArray(page) ? page : [];
      if (!rows.length) break;
      const last = rows[rows.length - 1] && rows[rows.length - 1].id;
      if (last && last === after) break;
      for (const row of rows) {
        if (!row || row.id == null || row.id === '') {
          stat.skipped += 1;
          summary.skipped += 1;
          continue;
        }
        const patch = {};
        let ids = 0;
        let accounts = 0;
        let skipped = 0;
        let touched = false;
        for (const field of target.fields) {
          const raw = row[field.column];
          if (raw == null || String(raw).trim() === '') continue;
          const sealed = sealTargetField(target, row, field);
          if (!sealed || sealed.skip) {
            skipped += 1;
            continue;
          }
          patch[field.column] = null;
          patch[field.cipher] = sealed.ciphertext;
          patch[field.last4] = sealed.last4;
          // public.clients.id_hmac belongs to the #37 clients migration.
          // Fill it only while it is null, with idHmac (QUIK1_ID_HMAC_KEY and
          // the same SA ID normalisation as stampClientIdentity).
          const reuseClientIdHmac = target.schema === 'public' && target.table === 'clients' && field.hmac === 'id_hmac';
          const hmacAlready = row[field.hmac] != null && String(row[field.hmac]).trim() !== '';
          if (reuseClientIdHmac) {
            if (!hmacAlready && sealed.hmac) patch[field.hmac] = sealed.hmac;
          } else {
            patch[field.hmac] = sealed.hmac;
          }
          touched = true;
          if (field.kind === 'bank') accounts += 1;
          else ids += 1;
        }
        stat.rows += 1;
        stat.ids += ids;
        stat.accounts += accounts;
        stat.skipped += skipped;
        summary.skipped += skipped;
        if (!touched) continue;
        if (commit) {
          await db.patch(target, row.id, patch);
          stat.wrote += 1;
          summary.wrote += 1;
        }
      }
      if (!last) break;
      after = String(last);
      if (rows.length < size) break;
    }
    summary.tables.push(stat);
  }
  return summary;
}

function envDb() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !key) throw new HttpError(503, 'Server not configured');
  async function rest(method, schema, table, query, body) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null) sp.append(k, String(v));
    }
    const headers = {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method === 'PATCH' ? { Prefer: 'return=minimal' } : {})
    };
    if (schema && schema !== 'public') {
      headers['Accept-Profile'] = schema;
      headers['Content-Profile'] = schema;
    }
    const target = url + '/rest/v1/' + encodeURIComponent(table) + (sp.toString() ? '?' + sp.toString() : '');
    let res;
    try {
      res = await fetch(target, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new HttpError(502, 'Database unreachable');
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) {
      const code = data && data.code ? String(data.code) : String(res.status);
      const err = new HttpError(502, 'Database error ' + code);
      err.code = code;
      throw err;
    }
    return data;
  }
  return {
    async list(target, { after, limit }) {
      const cols = ['id'];
      const pending = [];
      for (const field of target.fields) {
        cols.push(field.column, field.cipher, field.hmac, field.last4);
        pending.push(field.column + '.not.is.null');
      }
      const query = {
        select: [...new Set(cols)].join(','),
        order: 'id.asc',
        limit
      };
      if (pending.length === 1) query[target.fields[0].column] = 'not.is.null';
      else query.or = '(' + pending.join(',') + ')';
      if (after) query.id = 'gt.' + after;
      const data = await rest('GET', target.schema, target.table, query);
      return Array.isArray(data) ? data : [];
    },
    async patch(target, id, patch) {
      await rest('PATCH', target.schema, target.table, { id: 'eq.' + id }, patch);
    }
  };
}

function parseArgs(argv) {
  let commit = false;
  let batchSize = DEFAULT_BATCH;
  for (const arg of argv) {
    if (arg === '--commit') commit = true;
    else if (arg === '--dry-run') commit = false;
    else if (arg.startsWith('--batch=')) {
      const n = parseInt(arg.slice('--batch='.length), 10);
      if (!Number.isFinite(n) || n < 1) throw new HttpError(400, 'batch must be a positive number');
      batchSize = n;
    } else if (arg === '--help') {
      return { help: true, commit, batchSize };
    } else {
      throw new HttpError(400, 'Unknown argument');
    }
  }
  return { help: false, commit, batchSize };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('node scripts/backfill-ledger-secrets.js [--commit] [--batch=100]\n');
    return;
  }
  const summary = await runBackfill({ db: envDb(), commit: args.commit, batchSize: args.batchSize });
  process.stdout.write(JSON.stringify(summary) + '\n');
}

if (isDirectRun()) {
  main().catch(err => {
    const message = err instanceof HttpError ? err.message : 'Backfill failed';
    process.stderr.write(message + '\n');
    process.exitCode = 1;
  });
}
