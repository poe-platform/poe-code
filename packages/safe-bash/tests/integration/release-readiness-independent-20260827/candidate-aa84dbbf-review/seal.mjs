import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { authenticateTree, base, candidate, evidence, freezeRevision, frozen, git, inventory, repository, revision, save as firstSave, scratch, sha } from './review.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
function save(name, value) {
  if (existsSync(join(evidence, name))) assert.equal(readFileSync(join(evidence, name), 'utf8'), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', 'Previously captured sealing evidence changed: ' + name);
  else firstSave(name, value);
}
const boundary = JSON.parse(readFileSync(join(frozen, 'boundary.json')));
const boundaryReferences = boundary.references.map(entry => {
  const bytes = git(['show', entry.revision + ':' + entry.path]); assert.equal(sha(bytes), entry.sha256, entry.path);
  assert.equal(git(['rev-parse', entry.revision + ':' + entry.path]).toString().trim(), entry.gitBlob);
  return entry;
});
assert.equal(boundaryReferences.length, 34); save('boundary34-authentication.json', boundaryReferences);
const before = JSON.parse(readFileSync(join(evidence, 'candidate-after-setup.json'))), after = inventory(candidate);
assert.deepEqual(after, before); authenticateTree(revision, candidate);
save('candidate-final-integrity.json', { completeMembership: true, entries: after.length, beforeSha256: sha(JSON.stringify(before)), afterSha256: sha(JSON.stringify(after)), changes: [] });
const frozenBefore = JSON.parse(readFileSync(join(evidence, 'frozen-before.json')));
const frozenAfter = inventory(frozen);
const frozenOutputs = frozenAfter.filter(entry => entry.path === 'evidence/independent-aa84dbbf' || entry.path.startsWith('evidence/independent-aa84dbbf/'));
assert.deepEqual(frozenAfter.filter(entry => !frozenOutputs.includes(entry)), frozenBefore);
const snapshotFrozen = authenticateTree(freezeRevision, join(scratch, 'frozen'), 'tests/integration/release-readiness-independent-20260827');
const liveFrozen = authenticateTree(freezeRevision, repository, 'tests/integration/release-readiness-independent-20260827');
assert.deepEqual(snapshotFrozen, liveFrozen);
save('frozen-preservation.json', { original31Unchanged: true, oldEvidenceUnchanged: true, completeBeforeSha256: sha(JSON.stringify(frozenBefore)), exactNewCaptureEntries: frozenOutputs, liveFiles: liveFrozen });
const guardedBefore = JSON.parse(readFileSync(join(evidence, 'guarded-probe-before.json'))).filter(entry => entry.path === 'source' || entry.path.startsWith('source/'));
const currentSource = inventory(join(scratch, 'runtime-controls')).filter(entry => entry.path === 'source' || entry.path.startsWith('source/'));
const originalPaths = new Set(guardedBefore.map(entry => entry.path));
assert.deepEqual(currentSource.filter(entry => originalPaths.has(entry.path)), guardedBefore);
const allowedAdded = [
  'source/src/commands/execution.js', 'source/tests', 'source/tests/shell', 'source/tests/shell/invocation-cleanup-public.test.ts',
  'source/tests/shell-stress', 'source/tests/shell-stress/invocation-cleanup-runtime',
  'source/tests/shell-stress/invocation-cleanup-runtime/public-worker.mjs', 'source/tests/shell-stress/invocation-cleanup-runtime/migration',
  'source/tests/shell-stress/invocation-cleanup-runtime/migration/binding.ts',
];
const added = currentSource.filter(entry => !originalPaths.has(entry.path)); assert.deepEqual(added.map(entry => entry.path).sort(), allowedAdded.sort());
save('calibration-source-preservation.json', { originalSourceToolsBuildUnchanged: true, beforeEntries: guardedBefore.length, afterEntries: currentSource.length, exactIntentionalAdditions: added, reason: 'Three exact c355 cleanup inputs and ancestor directories; one inert compiled-source fallback guard mutation. No other additions admitted.' });
const native = JSON.parse(readFileSync(join(evidence, 'native49-availability.json')));
for (const asset of native.assets) assert.equal(sha(readFileSync(asset.origin)), asset.sha256, asset.origin);
save('native-after-authentication.json', native.assets.map(asset => ({ name: asset.name, path: asset.origin, sha256: sha(readFileSync(asset.origin)), mode: lstatSync(asset.origin).mode & 0o777 })));
const alias = 'tests/commands/grep-aliases/consumer.mts';
const eleven = boundary.individualMts.map(entry => ({ path: entry.path, frozenSha256: entry.sha256, actualSha256: sha(readFileSync(join(candidate, entry.path))) }));
assert.ok(eleven.filter(entry => entry.path !== alias).every(entry => entry.frozenSha256 === entry.actualSha256));
const aliasDiff = git(['diff', boundary.observationRevision, revision, '--', alias]).toString();
assert.equal(aliasDiff.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---')).length, 2);
assert.equal(aliasDiff.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).length, 2);
save('eleven-fixture-byte-audit.json', { eleven, aliasDiff });
const historicalPaths = git(['ls-tree', '-rz', revision, base]).toString().split('\0').filter(Boolean).map(row => row.slice(row.indexOf('\t') + 1)).filter(path => !/\.(?:mjs|fixture)$/u.test(path));
save('historical-capture-preservation.json', { source: revision, count: historicalPaths.length, scope: 'All these historical/evidence paths were included in the complete unchanged archive check, not rewritten or rescored.', paths: historicalPaths });
const authorEvidence = ['candidate-profile-73/README.md', 'candidate-profile-73/CALIBRATION_RECEIPT.json', 'candidate-profile-73/CALIBRATION_CLEANUP.json', 'native-recovery-73/README.md', 'native-recovery-73/RECOVERY.json', 'consumer-inventory-73/README.md', 'integrity-73/README.md', 'registry-73-migration/README.md'];
save('author-chronology.json', authorEvidence.map(path => { const bytes = git(['show', 'aa84dbbfae5c2f394dc1ec2516a809d659f72b4a:' + base + path]); return { path: base + path, revision: 'aa84dbbfae5c2f394dc1ec2516a809d659f72b4a', sha256: sha(bytes), text: bytes.toString(), qualification: 'Read for chronology, not substituted for independent execution' }; }));
const staged = git(['diff', '--cached', '--name-status']).toString();
save('live-preservation-before-commit.json', { head: git(['rev-parse', 'HEAD']).toString().trim(), status: git(['status', '--short']).toString(), staged, stagedEntries: git(['diff', '--cached', '--raw', '--full-index']).toString(), initialStaging: 'No staged changes in initial explicit inspection; full original index listing retained.', scope: 'Concurrent foreign staging/commits are permitted and preserved. Initial sealing wrongly required an empty index; its failed assertion is retained. No false byte-identical-index claim. All review Git input assembly used a separate scratch index; final commit uses explicit --only owned paths.' });
save('review-script-bindings.json', readdirSync(owned).filter(name => name.endsWith('.mjs')).map(path => ({ path, sha256: sha(readFileSync(join(owned, path))), bytes: readFileSync(join(owned, path)).length })));
const files = {}, rawFiles = {};
function add(path, bytes, mode = 0o644) { assert.equal(files[path], undefined); files[path] = bytes.toString('base64'); rawFiles[path] = { sha256: sha(bytes), bytes: bytes.length, mode }; }
function addTree(prefix, root) {
  for (const entry of inventory(root)) if (entry.kind === 'file') add(prefix + '/' + entry.path, readFileSync(join(root, entry.path)), entry.mode & 0o777);
}
addTree('evidence', evidence);
addTree('frozen-independent-capture', join(frozen, 'evidence/independent-aa84dbbf'));
for (const label of ['consumer-smoke-driver', 'count-migration-driver']) {
  const output = JSON.parse(readFileSync(join(evidence, label + '.stdout'))).output; addTree(label + '-outputs', output);
}
addTree('draft-profile', join(scratch, 'independent-controls/profile'));
for (const name of ['harness/runtime-probe-imports', 'guard-outside-import', 'guard-compiled-source-fallback', 'stale-guard-imports']) addTree('guard-loads/' + name, join(scratch, 'runtime-controls', name));
const packageReceipt = JSON.parse(readFileSync(join(evidence, 'type-package-identity.json'))); add('package/virtual-bash.tgz', readFileSync(packageReceipt.packageFile));
add('generated/cleanup-binding.mjs', readFileSync(join(scratch, 'runtime-controls/cleanup-binding.mjs')));
const completeMatrix = JSON.parse(readFileSync(join(evidence, 'CASE_MATRIX.json')));
const matrix = { ...completeMatrix, results: completeMatrix.results.map(({ id, group, expected, observed, status, method, target, rawReceipt, limitation, qualification }) => ({ id, group, expected, observed, status, method, target, rawReceipt: 'evidence/' + rawReceipt, ...(limitation ? { limitation } : {}), ...(qualification ? { qualification } : {}) })) };
const raw = gzipSync(Buffer.from(JSON.stringify({ format: 'independent-aa84dbbf-lossless-v1', files })), { level: 9 }).toString('base64').match(/.{1,120}/g).join('\n') + '\n';
const additions = { 'CASE_MATRIX.json': JSON.stringify(matrix, null, 2) + '\n', 'RAW.json.gz.base64': raw };
const outer = Object.fromEntries(readdirSync(owned).map(path => { const bytes = readFileSync(join(owned, path)); return [path, { sha256: sha(bytes), bytes: bytes.length, mode: lstatSync(join(owned, path)).mode & 0o777 }]; }));
for (const [path, bytes] of Object.entries(additions)) outer[path] = { sha256: sha(bytes), bytes: Buffer.byteLength(bytes), mode: 0o644 };
additions['MANIFEST.json'] = JSON.stringify({ format: 'independent-aa84dbbf-sealed-v1', sealedAt: new Date().toISOString(), candidate: revision, handoff: 'aa84dbbfae5c2f394dc1ec2516a809d659f72b4a', fixture: freezeRevision, files: outer, rawFiles, wholeGateExecuted: false, successorActivated: false }, null, 2) + '\n';
const patch = '*** Begin Patch\n' + Object.entries(additions).map(([path, bytes]) => '*** Add File: ' + relative(repository, join(owned, path)) + '\n' + bytes.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n').join('') + '*** End Patch\n';
const applied = spawnSync('apply_patch', [], { cwd: repository, input: patch, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); assert.equal(applied.status, 0, applied.stderr); console.log(applied.stdout);
console.log(JSON.stringify({ rawFiles: Object.keys(files).length, base64Bytes: raw.length, outerFiles: Object.keys(outer).length + 1, counts: matrix.counts }));
