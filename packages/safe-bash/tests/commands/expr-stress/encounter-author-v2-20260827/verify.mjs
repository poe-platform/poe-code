import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const files = {};
function walk(directory, prefix = '') {
  for (const name of readdirSync(directory).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (relative === 'SEAL.json') continue;
    const absolute = join(directory, name), stat = lstatSync(absolute);
    assert(!stat.isSymbolicLink(), `unexpected symlink ${relative}`);
    if (stat.isDirectory()) { assert.notEqual(name, 'node_modules'); walk(absolute, relative); }
    else files[relative] = { bytes: stat.size, sha256: sha256(readFileSync(absolute)) };
  }
}
walk(owned);
const filename = join(owned, 'SEAL.json');
if (process.argv[2] === '--seal') {
  assert(!existsSync(filename), 'immutable seal already exists');
  writeFileSync(filename, `${JSON.stringify({ sourceCommit: 'c3e40f8bd721da5e496f3b3abfd51aee45db5a84', quotaCommit: 'c25e682a7baa2f2abf70cebf8c01d11d0ad5daee', files }, null, 2)}\n`, { flag: 'wx' });
} else assert.equal(process.argv[2], '--verify', 'verify.mjs --seal | --verify');
const seal = JSON.parse(readFileSync(filename));
assert.deepEqual(files, seal.files, 'append-aware evidence file inventory');
for (const name of ['candidate-01', 'quota-baseline-01']) {
  const load = path => JSON.parse(readFileSync(join(owned, name, path)));
  assert.deepEqual(load('source-before.json'), load('source-after.json'));
  assert.deepEqual(load('compiled-before.json'), load('compiled-after.json'));
  assert.deepEqual(load('freeze-before.json'), load('freeze-after.json'));
  assert.equal(sha256(Buffer.from(readFileSync(join(owned, name, 'source-archive.b64.data'), 'utf8').trim(), 'base64')), load('provenance.json').archiveSha256);
  assert.equal(load('cleanup.json').scratchAbsent, true);
  assert.equal(load('cleanup.json').parentAbsent, true);
  assert.equal(load('original-results.json').activeWorkers, 0);
  assert.equal(load('nearby-results.json').activeWorkers, 0);
}
console.log(JSON.stringify({ verifiedFiles: Object.keys(files).length, sourceCommit: seal.sourceCommit, appendAware: true }));
