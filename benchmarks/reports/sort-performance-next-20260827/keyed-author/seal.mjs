import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(root, 'MANIFEST.json');
const files = {};
function visit(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (path === 'MANIFEST.json') continue;
    assert.ok(!entry.isSymbolicLink(), path);
    if (entry.isDirectory()) visit(path);
    else {
      const bytes = readFileSync(join(root, path));
      files[path] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
  }
}
visit('');
const source = JSON.parse(readFileSync(join(root, 'source-freeze.json')));
const freeze = JSON.parse(readFileSync(join(root, 'attempt-1/freeze.json')));
assert.equal(source.sourceCommit, freeze.candidate);
for (const label of ['baseline', 'candidate', 'moved-candidate', 'baseline-instrumented', 'candidate-instrumented']) {
  const result = JSON.parse(readFileSync(join(root, 'attempt-1', label + '.json')));
  assert.equal(result.rows.length, 21); assert.ok(result.rows.every(row => row.equivalent));
}
for (const label of ['candidate', 'candidate-instrumented', 'baseline-text-instrumented']) {
  const result = JSON.parse(readFileSync(join(root, 'caps-1', label + '.json')));
  assert.equal(result.rows.length, 15); assert.ok(result.rows.every(row => row.equivalent));
}
for (const path of ['attempt-1/cleanup.json', 'caps-1/cleanup.json']) {
  const cleanup = JSON.parse(readFileSync(join(root, path)));
  assert.equal(cleanup.successful, true); assert.equal(cleanup.scratchRemoved, true);
  assert.equal(cleanup.remainingOwnedChildren, 0); assert.equal(cleanup.beforeAfterTreesMatch, true);
}
const manifest = { sourceCommit: source.sourceCommit, textSha256: source.textSha256, files };
if (process.argv.includes('--capture')) {
  assert.ok(!existsSync(manifestPath), 'Never overwrite sealed evidence');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
} else assert.deepEqual(JSON.parse(readFileSync(manifestPath)), manifest);
console.log(JSON.stringify({ verifiedFiles: Object.keys(files).length, sourceCommit: source.sourceCommit, mode: process.argv.includes('--capture') ? 'capture' : 'read-only', additionalEntriesChecked: true }));
