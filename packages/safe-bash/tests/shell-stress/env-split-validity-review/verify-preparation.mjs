import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

assert.equal(process.argv.length, 2, 'Preparation accepts no execution/replay arguments');
const pins = JSON.parse(readFileSync(new URL('./pins.json', import.meta.url), 'utf8'));
assert.equal(realpathSync(process.cwd()), pins.root);
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const git = args => execFileSync('git', args, { cwd: pins.root, timeout: 20000, maxBuffer: 64 * 1024 * 1024 });
const text = args => git(args).toString().trim();
const blob = (commit, filename) => git(['show', `${commit}:${filename}`]);
const parseInventory = bytes => bytes.toString().split('\0').filter(Boolean).map(line => {
  const [entry, filename] = line.split('\t');
  const [mode, type, object] = entry.split(' ');
  return { mode, type, blob: object, path: filename };
});

assert.equal(text(['rev-parse', '--show-toplevel']), pins.root);
assert.equal(text(['rev-parse', `${pins.candidate}^{tree}`]), pins.candidateTree);
assert.equal(process.version, pins.node.version);
assert.equal(realpathSync(process.execPath), pins.node.path);
assert.equal(digest(readFileSync(process.execPath)), pins.node.hash);

let preservedFiles = 0;
for (const historical of pins.historicalTrees) {
  assert.equal(text(['rev-parse', `${historical.commit}:${historical.directory}`]), historical.tree);
  const inventoryBytes = git(['ls-tree', '-r', '-z', historical.commit, '--', historical.directory]);
  assert.equal(digest(inventoryBytes), historical.inventorySha256);
  const entries = parseInventory(inventoryBytes);
  assert.equal(entries.length, historical.files);
  for (const entry of entries) {
    assert.equal(entry.type, 'blob');
    const filename = resolve(pins.root, entry.path);
    assert.ok(lstatSync(filename).isFile(), entry.path);
    assert.equal(digest(readFileSync(filename)), digest(blob(historical.commit, entry.path)), entry.path);
    preservedFiles++;
  }
}

const evidence = {};
for (const [filename, expected] of Object.entries(pins.evidenceSha256)) {
  const bytes = blob(pins.packedEvidenceCommit, `tests/shell-stress/${filename}`);
  assert.equal(digest(bytes), expected, filename);
  evidence[filename] = JSON.parse(bytes);
}
const packed = evidence['env-split-consumer/packed-core-84ab66c.json'];
const audit = evidence['env-split-consumer/packed-core-84ab66c-audit.json'];
const tarball = evidence['env-split-consumer/packed-core-84ab66c-tarball.json'];
for (const report of [packed, audit, tarball]) assert.equal(report.candidate, pins.candidate);
const inventory = parseInventory(git(['ls-tree', '-r', '-z', pins.candidate]));
assert.equal(inventory.length, pins.wholeTreeFiles);
assert.equal(digest(JSON.stringify(inventory)), pins.wholeTreeInventoryDigest);
const selected = inventory.filter(entry => entry.path.startsWith('src/') || !entry.path.includes('/'));
assert.equal(selected.length, pins.archiveFiles);
assert.equal(selected.filter(entry => entry.path.startsWith('src/')).length, pins.sourceFiles);
assert.deepEqual(selected.filter(entry => !entry.path.includes('/')).map(entry => entry.path), pins.rootFiles);
const selectedMap = Object.fromEntries(selected.map(entry => [entry.path, { blob: entry.blob, mode: entry.mode }]));
assert.equal(digest(JSON.stringify(selectedMap)), pins.selectedGitInputs);
assert.deepEqual(selectedMap, packed.manifests[packed.selectedGitInputs]);

const sourceHashes = {};
for (const entry of selected) {
  assert.equal(entry.type, 'blob');
  assert.ok(['100644', '100755'].includes(entry.mode));
  const bytes = blob(pins.candidate, entry.path);
  assert.equal(digest(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1'), entry.blob);
  sourceHashes[entry.path] = digest(bytes);
}
assert.equal(packed.sourceBefore, pins.sourceManifest);
assert.deepEqual(sourceHashes, packed.manifests[pins.sourceManifest]);
assert.equal(digest(JSON.stringify(packed.manifests[pins.sourceManifest])), pins.sourceManifest);
assert.equal(audit.sourceProof.length, pins.archiveFiles);
assert.ok(audit.sourceProof.every(entry => entry.committed === true));
assert.deepEqual(Object.fromEntries(audit.sourceProof.map(entry => [entry.path, entry.hash])), sourceHashes);
const archive = git(['archive', '--format=tar', pins.candidate, 'src', ...pins.rootFiles]);
assert.equal(digest(archive), pins.archiveSha256);
assert.equal(packed.archiveSha256, pins.archiveSha256);
assert.equal(packed.packedFiles, pins.packedManifest);
assert.equal(digest(JSON.stringify(packed.manifests[pins.packedManifest])), pins.packedManifest);
assert.equal(Object.keys(packed.manifests[pins.packedManifest]).length, pins.packedFiles);
assert.equal(Object.keys(packed.manifests[packed.emitted]).length, pins.emittedFiles);
assert.equal(packed.installedBefore, packed.installedAfter);

assert.equal(tarball.encoding, 'base64');
const compressed = Buffer.from(tarball.data, 'base64');
assert.equal(compressed.toString('base64'), tarball.data);
assert.equal(compressed.length, pins.tarball.size);
assert.equal(digest(compressed), pins.tarball.sha256);
assert.equal(digest(compressed, 'sha1'), pins.tarball.shasum);
assert.equal(`sha512-${digest(compressed, 'sha512', 'base64')}`, pins.tarball.integrity);
for (const [key, expected] of Object.entries(pins.tarball)) {
  assert.equal(tarball[key], expected);
  assert.equal(packed.tarball[key], expected);
}
assert.equal(audit.tarballSha256, pins.tarball.sha256);

const hidden = evidence['env-split-holdout/core-review-84ab66c.json'];
assert.deepEqual(hidden.history.original, { rows: 48, exact: 1, mismatch: 41, unavailable: 6, hostPassed: 0, hosts: 7 });
assert.deepEqual(hidden.history.setupV2, { rows: 48, exact: 2, mismatch: 46, unavailable: 0, hostPassed: 0, hosts: 7 });
for (const [key, expected] of Object.entries({ rows: 48, exact: 40, mismatch: 8, commandsExact: 39, commands: 42, shebangExact: 1, shebangs: 6, hostPassed: 6, hostFailed: 1, hosts: 7, cohortExecutions: 55 })) assert.equal(hidden.current[key], expected, key);
const diagnosticLines = {
  'packed-non-s-single-operand': [127, 'shell: line 1: argvprobe two words: command not found\n'],
  'missing-command-negative': [127, 'shell: line 1: env-split-never-a-real-command: command not found\n'],
  'nonexecutable-command-negative': [126, 'shell: line 1: ./nonexec: Permission denied\n'],
};
for (const [id, [status, stderr]] of Object.entries(diagnosticLines)) {
  const row = hidden.mismatches.find(entry => entry.id === id);
  assert.equal(row.exact, false);
  assert.equal(row.actual.status, status);
  assert.equal(row.actual.stderr, Buffer.from(stderr).toString('base64'));
  assert.deepEqual(row.fields, { status: true, stdout: true, stderr: false, effects: true });
}
assert.deepEqual(packed.summary.native, [{ role: 'primary', total: 10, passed: 0 }, { role: 'historical', total: 10, passed: 0 }]);
assert.deepEqual(packed.summary.host, { cases: 3, executions: 5, passed: 0 });
assert.deepEqual(audit.rawTupleSummaryNotAssertionPass, [{ role: 'primary', passed: 7, total: 10 }, { role: 'historical', passed: 7, total: 10 }]);
const nativeHidden = evidence['env-split-holdout/native-aligned.json'];
assert.deepEqual(nativeHidden.profiles.map(profile => profile.id), ['gnu97-darwin-primary', 'apple-env-bash32-historical']);
for (const profile of nativeHidden.profiles) {
  assert.equal(profile.rows.filter(row => row.category === 'command').length, 42);
  assert.equal(profile.rows.filter(row => row.category === 'single-optional').length, 6);
}
const nativePacked = evidence['env-split-consumer/native-frozen.json'];
assert.deepEqual(nativePacked.profiles.map(profile => [profile.role, profile.rows.length]), [['primary', 10], ['historical', 10]]);

console.log(JSON.stringify({
  phase: 'preparation-only',
  reviewerThreadId: pins.reviewerThreadId,
  candidate: pins.candidate,
  candidateTree: pins.candidateTree,
  historicalFilesPreserved: preservedFiles,
  sourceFilesAuthenticated: pins.sourceFiles,
  archiveFilesAuthenticated: pins.archiveFiles,
  archiveSha256: pins.archiveSha256,
  capturedTarballSha256: pins.tarball.sha256,
  capturedTarballBytes: compressed.length,
  historicalCountsChecked: true,
  authorRevisionRead: false,
  productImports: 0,
  productExecutions: 0,
  productInstallations: 0,
  nativeExecutions: 0,
  scratchCreated: false,
  acceptance: 'not released; awaiting ROOT author fixture freeze',
}, null, 2));
