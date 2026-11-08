import { readFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
await writeFile(root + 'PATCH-PATHS-STARTUP.json', JSON.stringify({ at: new Date().toISOString(), children: 0, sourceOnly: true }) + '\n', { flag: 'wx', mode: 0o600 });
try {
  const plan = JSON.parse(await readFile(new URL('../verification-v2/plan-r2.json', import.meta.url), 'utf8'));
  const rows = [];
  for (const pair of plan.pairs.slice(1)) {
    const status = await lstat(pair.payload.path);
    assert(status.isFile() && status.size === pair.payload.bytes && status.size < 1024 * 1024);
    const bytes = await readFile(pair.payload.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pair.payload.sha256);
    const headers = bytes.toString('utf8').split('\n').flatMap((line, index) => /^(\*\*\*|---|\+\+\+) [^0-9 *]/.test(line) ? [{ line: index + 1, header: line.split('\t')[0] }] : []);
    rows.push({ name: pair.name, sha256: pair.payload.sha256, headers });
  }
  await writeFile(root + 'PATCH-PATHS.json', JSON.stringify(rows, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(rows));
} catch (error) {
  await writeFile(root + 'PATCH-PATHS-FAILURE.json', JSON.stringify({ message: error.message }) + '\n', { flag: 'wx', mode: 0o600 });
  process.exitCode = 1;
}
