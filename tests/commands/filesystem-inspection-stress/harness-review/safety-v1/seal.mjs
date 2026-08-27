import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCases, caps } from './cases.mjs';

export const directory = dirname(fileURLToPath(import.meta.url));
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifySeal() {
  const manifest = JSON.parse(readFileSync(join(directory, 'PRESEAL.json'), 'utf8'));
  for (const entry of manifest.files) {
    const bytes = readFileSync(join(directory, entry.path));
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.equal(digest(bytes), entry.sha256, entry.path);
  }
  const cases = JSON.parse(readFileSync(join(directory, 'sealed-cases.json'), 'utf8'));
  assert.deepEqual(cases, buildCases());
  assert.deepEqual(cases.map(entry => entry.id), ['T-empty-many', 'T-DP-cumulative', 'T-sort-many', 'F-JSON-cumulative', 'F-header-many', 'F-metadata-many']);
  return { manifest, cases, caps };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === '--create') {
    const bytes = Buffer.from(`${JSON.stringify(buildCases(), null, 2)}\n`);
    writeFileSync(join(directory, 'sealed-cases.json'), bytes, { flag: 'wx' });
    const files = ['cases.mjs', 'seal.mjs', 'sealed-cases.json'].map(path => {
      const content = readFileSync(join(directory, path));
      return { path, bytes: content.length, sha256: digest(content) };
    });
    writeFileSync(join(directory, 'PRESEAL.json'), `${JSON.stringify({ schema: 1, createdAt: new Date().toISOString(),
      independence: 'No new author fix source read; fixture/expectation generation uses prior APIs and independent finite input recipes only',
      productExecutions: 0, nativeExecutions: 0, count: 6, caps, files }, null, 2)}\n`, { flag: 'wx' });
  } else assert.equal(process.argv[2], '--check');
  const sealed = verifySeal();
  console.log(JSON.stringify({ sealed: sealed.cases.map(entry => entry.id), manifestSha256: digest(readFileSync(join(directory, 'PRESEAL.json'))), productExecutions: 0 }));
}
