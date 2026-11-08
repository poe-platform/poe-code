import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, timeout: 30000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
const read = path => readFileSync(join(here, path));
const result = JSON.parse(read('attempt-1/RESULT.json'));
const frozen = read('attempt-1/frozen-cases.json');
assert.deepEqual(frozen, git('show', `${result.preparation}:tests/integration/committed-archive-admission-independent-20260827/guard-cases.json`));
assert.equal(hash(frozen), result.frozenCasesSha256);
assert.deepEqual(result.counts, { planned: 18, executed: 18, pass: 18, fail: 0, skips: 0, mutants: 3 });
assert.deepEqual(result.cases.map(entry => entry.id).sort(), JSON.parse(frozen).cases.map(entry => entry.id).sort());
assert.ok(result.cases.every(entry => entry.status === 'pass'));
assert.equal(result.executionBlocker, undefined);
assert.equal(result.wholeGateLaunched, false); assert.equal(result.productExecutions, 0); assert.equal(result.compilerRuns, 0); assert.equal(result.privateAccess, false); assert.equal(result.cleanupComplete, true);
for (const [path, expected] of Object.entries(result.source)) assert.equal(hash(git('show', `${result.author}:${path}`)), expected, path);
const archive = JSON.parse(read('attempt-1/ARCHIVE-MANIFEST.json'));
assert.equal(hash(JSON.stringify(archive)), result.archive.manifestSha256);
assert.equal(archive.count, 24879); assert.equal(Object.keys(archive.files).length, 24879);
assert.equal(archive.files['package.json'].sha256, '2127bbfed020aeb7873462ae65224e6ee73069425c878aa2ceee9816b2191245');
const tree = git('ls-tree', '-rzl', '--full-tree', result.candidate).toString().split('\0').filter(Boolean);
assert.equal(tree.length, 24879);
for (const row of tree) {
  const separator = row.indexOf('\t'), [mode, type, blob, size] = row.slice(0, separator).trim().split(/\s+/u), path = row.slice(separator + 1), entry = archive.files[path];
  assert.equal(type, 'blob'); assert.ok(entry); assert.equal(entry.blob, blob); assert.equal(entry.bytes, Number(size)); assert.equal(entry.symlink, mode === '120000');
  if (mode !== '120000') assert.equal(entry.mode, Number.parseInt(mode.slice(-3), 8));
}
assert.deepEqual(result.actualAdmission.issues, []); assert.equal(result.actualAdmission.native, 49); assert.equal(result.actualAdmission.blobs, 17765);
assert.equal(result.children.length, 22); assert.ok(result.children.every(child => child.signal === null && child.error === null));
const cleanup = JSON.parse(git('show', `${result.author}:tests/integration/full-gate-20260827/combined-8670ebe8/cleanup-expected.json`));
assert.equal(cleanup.revision, result.candidate); assert.equal(cleanup.tree, result.actualAdmission.tree);
assert.equal(Object.keys(cleanup.files).length, 220);
assert.equal(hash(JSON.stringify(cleanup)), 'd9309d27efd2e1e418f075f4f514efeeefa833e8b3dc5e061662289f8ecd67b6');
for (const [path, expected] of Object.entries(cleanup.files)) assert.equal(archive.files[path].sha256, expected, path);
const authorEvidenceCommit = '05360c918c645031ff83680ba54f5049af91115a';
const authorEvidence = JSON.parse(git('show', `${authorEvidenceCommit}:tests/integration/full-gate-20260827/combined-8670ebe8/archive-admission-evidence.json`));
assert.equal(authorEvidence.sourceCommit, result.author);
for (const entry of authorEvidence.source) assert.equal(hash(git('show', `${result.author}:${entry.path}`)), entry.sha256);
for (const attempt of authorEvidence.attempts) {
  const bytes = gunzipSync(Buffer.from(attempt.data, 'base64'));
  assert.equal(hash(bytes), attempt.sha256); assert.equal(bytes.length, attempt.bytes);
  const capture = JSON.parse(bytes); assert.equal(capture.controls.length, 22); assert.ok(capture.controls.every(entry => entry.status === 'pass')); assert.equal(capture.wholeGateLaunched, false);
}
const inventory = {};
const visit = (prefix = '') => {
  for (const entry of readdirSync(join(here, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.equal(entry.isSymbolicLink(), false);
    if (entry.isDirectory()) visit(path);
    else if (path !== 'MANIFEST.json') { const bytes = read(path); inventory[path] = { bytes: bytes.length, sha256: hash(bytes) }; }
  }
};
visit();
if (process.argv[2] === '--seal') {
  assert.equal(existsSync(join(here, 'MANIFEST.json')), false);
  writeFileSync(join(here, 'MANIFEST.json'), JSON.stringify({ author: result.author, candidate: result.candidate, authorEvidenceCommit, authorAttemptsAuthenticatedNotReexecuted: authorEvidence.attempts.length, files: inventory }, null, 2) + '\n', { flag: 'wx' });
} else assert.deepEqual(JSON.parse(read('MANIFEST.json')).files, inventory);
console.log(JSON.stringify({ review: '18/18', mutants: '3/3 detected', native: 49, inputs: 24879, uniqueBlobs: 17765, cleanup: 220, packageSha256: archive.files['package.json'].sha256, authorEvidence: 'two22/22 captures authenticated, not independent execution counts', wholeGateLaunched: false }));
