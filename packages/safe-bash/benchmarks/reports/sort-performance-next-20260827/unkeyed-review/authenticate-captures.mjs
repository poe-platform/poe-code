import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (commit, path) => execFileSync('git', ['show', `${commit}:${path}`], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
const prefix = 'benchmarks/reports/sort-performance-next-20260827/';
const selected = '68f037111981356823ad5fa1a58943e5231ccfd4';
const inputs = JSON.parse(git(selected, prefix + 'inputs.json'));
const vectors = JSON.parse(git(selected, prefix + 'workloads.json')).specimens;
const authenticated = Object.entries(inputs.evidenceFiles).map(([path, record]) => {
  assert.equal(hash(git(record.commit, path)), record.sha256);
  return { path, ...record };
});
const oldPath = 'benchmarks/reports/sort-performance-independent-20260827/evidence/workloads-native.json';
const captures = JSON.parse(git(inputs.evidenceFiles[oldPath].commit, oldPath));
const provenance = [];
for (const vector of vectors.filter(row => row.eligiblePrior)) {
  const { origin, eligiblePrior, ...recipe } = vector;
  assert.deepEqual(recipe, captures.find(row => row.id === vector.id));
  provenance.push({ id: vector.id, source: oldPath, exactRecipeInputOutputEffectsEqual: true });
}
const nativePath = 'tests/commands/core-sort/native.json';
const native = JSON.parse(git(inputs.evidenceFiles[nativePath].commit, nativePath));
for (const index of [4, 5, 6, 28, 29, 30, 32, 33, 34]) {
  const observed = native.observations[index];
  const vector = vectors.find(row => row.id === `negative-native-${index}`);
  assert.deepEqual(vector.args, observed.args);
  assert.equal(vector.stdin, observed.stdin);
  assert.deepEqual(vector.expected, { stdout: observed.stdout, stderr: observed.stderr, status: observed.exitCode, files: {} });
  provenance.push({ id: vector.id, source: nativePath, index, exactInputOutputEqual: true });
}
writeFileSync(directory + 'capture-authentication.json', JSON.stringify({ authenticated, provenance, nativeRowsCompared: provenance.length, handDeclaredOrBorrowedRows: 5, nativeProfile: inputs.nativeProfile, newNativeExecutions: 0 }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ authenticatedFiles: authenticated.length, nativeRowsCompared: provenance.length, newNativeExecutions: 0 }));
