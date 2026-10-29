// `node --test tests/api/` hands the test runner a directory, which Node resolves to this file.
// It imports every sibling *.test.js so all suites run in one process; each file scopes its hooks
// with describe() and sets its own env per call, so they do not interfere. Running the files
// individually (`node --test 'tests/api/*.test.js'`) works the same.
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(dir).filter(f => f.endsWith('.test.js')).sort()) {
  await import(pathToFileURL(path.join(dir, f)).href);
}
