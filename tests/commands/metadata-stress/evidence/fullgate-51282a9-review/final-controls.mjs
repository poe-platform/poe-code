import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { base, git, hash, save } from '../../../diff-patch-stress/evidence/fullgate-51282a9-review/replay.mjs';

const directory = resolve(base, '.scratch/final-corrected');
const authorDirectory = resolve(directory, 'tests/commands/metadata-stress/canonical-env');
const { authenticateCapturedAuthors, authorSnapshotSha256 } = await import(pathToFileURL(resolve(authorDirectory, 'author-provenance.ts')));
const { verifySetup } = await import(pathToFileURL(resolve(authorDirectory, 'runner.mjs')));
const snapshotBytes = readFileSync(resolve(authorDirectory, 'author-snapshot.json'));
const oracleBytes = readFileSync(resolve(authorDirectory, '../oracle-evidence.json'));
const snapshot = JSON.parse(snapshotBytes);
assert.equal(hash(snapshotBytes), authorSnapshotSha256);
authenticateCapturedAuthors(snapshot, oracleBytes);
const bindings = Object.values(snapshot.files).map(entry => {
  const specifier = `${snapshot.commit}:${entry.path}`;
  const blob = git('--no-replace-objects', 'rev-parse', specifier).toString().trim();
  const bytes = git('--no-replace-objects', 'cat-file', 'blob', specifier);
  assert.equal(blob, entry.blob);
  assert.deepEqual(bytes, Buffer.from(entry.text));
  return { path: entry.path, commit: snapshot.commit, blob, sha256: hash(bytes) };
});
const controls = [];
function reject(name, operation, pattern) {
  let message;
  assert.throws(operation, error => { message = error.message; return pattern.test(message); });
  controls.push({ name, rejected: true, message });
}
const wrongBlob = structuredClone(snapshot);
wrongBlob.files['stat.test.ts'].blob = '0'.repeat(40);
reject('wrong Git blob', () => authenticateCapturedAuthors(wrongBlob, oracleBytes), /Git blob identity/);
const wrongOracle = JSON.parse(oracleBytes);
wrongOracle.binaries.stat = '0'.repeat(64);
reject('wrong oracle record', () => authenticateCapturedAuthors(snapshot, Buffer.from(JSON.stringify(wrongOracle))), /oracle evidence identity/);
const wrongCurrent = structuredClone(snapshot);
wrongCurrent.files['stat.test.ts'].text = readFileSync(resolve(directory, 'tests/commands/metadata/stat.test.ts'), 'utf8');
reject('current source cannot replace immutable history', () => authenticateCapturedAuthors(wrongCurrent, oracleBytes), /immutable source bytes/);
const wrongCommit = structuredClone(snapshot);
wrongCommit.commit = '0'.repeat(40);
reject('wrong historical commit', () => authenticateCapturedAuthors(wrongCommit, oracleBytes), /original recorded source commit/);
for (const [name, options] of [
  ['missing primary cache', { primary: resolve(base, '.scratch/intentionally-absent-native-cache') }],
  ['wrong native binary pin', { secondary: '/usr/bin/stat' }],
  ['wrong host profile', { platform: 'linux', arch: 'arm64' }],
]) {
  const report = verifySetup(options);
  assert.equal(report.status, 'setup-unavailable');
  assert(report.assets.every(asset => !asset.execution));
  controls.push({ name, rejected: true, report });
}
assert.equal(hash(readFileSync(resolve(authorDirectory, 'author-snapshot.json'))), hash(snapshotBytes));
assert.deepEqual(readFileSync(resolve(authorDirectory, '../oracle-evidence.json')), oracleBytes);
save('tests/commands/metadata-stress/evidence/fullgate-51282a9-review/final-adversarial-controls.json', { bindings, positiveHistoricalArtifacts: bindings.length, controls, rejected: controls.length, immutableFilesUnchanged: true, coverage: 'Authentication and setup controls only; no added product corpus cases' });
console.log({ authenticated: bindings.length, rejected: controls.length });
