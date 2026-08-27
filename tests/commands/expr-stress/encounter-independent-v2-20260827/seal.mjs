import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const sealPath = join(owned, 'SEAL.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function inventory() {
  const entries = {};
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      if (!prefix && name === 'SEAL.json') continue;
      const filename = prefix ? `${prefix}/${name}` : name;
      const absolute = join(directory, name);
      const stat = lstatSync(absolute);
      assert(!stat.isSymbolicLink(), `unexpected evidence symlink: ${filename}`);
      if (stat.isDirectory()) { entries[filename] = { kind: 'directory' }; walk(absolute, filename); }
      else entries[filename] = { kind: 'file', bytes: stat.size, sha256: sha256(readFileSync(absolute)) };
    }
  }
  walk(owned);
  return entries;
}
const mode = process.argv[2];
assert(mode === '--seal' || mode === '--verify', 'Usage: seal.mjs --seal|--verify');
if (mode === '--seal') {
  assert(!existsSync(sealPath), 'refuse seal overwrite');
  writeFileSync(sealPath, `${JSON.stringify({ sealedAt: new Date().toISOString(), freezeCommit: '30dda5b930c6e5ea29a54348926fc02b81f9d8e6', entries: inventory(), scope: 'All owned evidence files and directories, including added-entry detection. SEAL.json authenticates through the subsequent Git evidence commit; not a transaction or defense against transient mutation.' }, null, 2)}\n`, { flag: 'wx' });
}
const seal = JSON.parse(readFileSync(sealPath));
assert.deepEqual(inventory(), seal.entries, 'evidence changed, missing, or appended');
const summary = JSON.parse(readFileSync(join(owned, 'baseline-01/summary.json')));
assert.equal(summary.original.passed, 42);
assert.equal(summary.original.total, 61);
assert.equal(summary.original.failures.length, 19);
assert.equal(summary.same19FailureIdsAsQualified, true);
assert.equal(summary.nearby.passed, 12);
assert.equal(summary.nearby.total, 16);
assert.equal(summary.activeWorkers.original, 0);
assert.equal(summary.activeWorkers.nearby, 0);
assert.equal(sha256(readFileSync(join(owned, 'freeze/original-cases.json'))), 'd1892a748a9437fa253735636abf6f8d349c00d4898579d7a8b92bf0a2598314');
console.log(JSON.stringify({ verified: true, entries: Object.keys(seal.entries).length, original: '42/61; 19 unchanged failures', nearby: '12/16', addedEntryDetection: true }));
