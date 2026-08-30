import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = filename => JSON.parse(readFileSync(path.join(directory, filename)));
const seal = json('MANIFEST.json');
const inventory = folder => readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
  const filename = path.join(folder, entry.name);
  assert.ok(!entry.isSymbolicLink(), filename);
  const relative = path.relative(directory, filename);
  if (entry.isDirectory()) return [{ path: relative, kind: 'directory' }, ...inventory(filename)];
  assert.ok(entry.isFile(), filename);
  if (relative === 'MANIFEST.json') return [];
  const bytes = readFileSync(filename);
  return [{ path: relative, kind: 'file', bytes: bytes.length, sha256: hash(bytes) }];
}).sort((left, right) => left.path.localeCompare(right.path));
assert.deepEqual(inventory(directory), seal.entries);
const frozen = json('CASES.json');
assert.equal(frozen.cases.length, 28);
assert.equal(frozen.cases.filter(row => row.expected).length, 13);
for (const entry of frozen.anchors) assert.equal(hash(readFileSync(path.join(root, entry.path))), entry.sha256, entry.path);
const git = argv => {
  const result = spawnSync('/usr/bin/git', argv, { cwd: root, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
};
assert.deepEqual(readFileSync(path.join(directory, 'CASES.json')), git(['show', `${seal.inputFreeze}:${path.relative(root, directory)}/CASES.json`]));
assert.deepEqual(readFileSync(path.join(directory, 'candidate-01/candidate.mjs.data')), git(['show', `a035cb1f5f43108cb4440f8ae9d2745b05bfc6e1:${path.relative(root, directory)}/candidate.mjs`]));
assert.deepEqual(readFileSync(path.join(directory, 'candidate-01/controls.mjs.data')), git(['show', `aa128eac5e3673b51d3281bc9e2658605e1fcf76:${path.relative(root, directory)}/controls.mjs`]));
const provenance = json('candidate-01/provenance.json');
assert.equal(provenance.base, frozen.base);
assert.equal(provenance.workerSha256, seal.workerSha256);
assert.equal(hash(readFileSync(path.join(directory, 'candidate-01/candidate.patch.data'))), provenance.patchSha256);
assert.equal(hash(readFileSync(path.join(directory, 'candidate-01/receipt.txt'))), provenance.receiptSha256);
const changed = provenance.after.filter((entry, index) => entry.sha256 !== provenance.before[index].sha256);
assert.deepEqual(provenance.before.map(entry => entry.path), provenance.after.map(entry => entry.path));
assert.deepEqual(changed, [{ path: 'src/commands/expr/bre-worker.ts', sha256: seal.workerSha256 }]);
for (const entry of provenance.shared) {
  assert.equal(entry.sha256, entry.baseSha256);
  assert.equal(hash(git(['show', `${frozen.base}:${entry.path}`])), entry.sha256);
}
const native = json('native-01/capture.json');
assert.equal(native.rows.length, 29);
assert.equal(native.counts.nativeObservations, 58);
assert.equal(native.counts.candidateExecutions, 0);
assert.deepEqual(native.profiles, native.profilesAfter);
assert.deepEqual(native.anchorsBefore, native.anchorsAfter);
const capture = json('candidate-01/capture.json');
assert.equal(capture.rows.length, 30);
assert.equal(capture.counts.expectationsMet, 13);
assert.equal(capture.counts.controlsPassed, 14);
assert.equal(capture.counts.controls, 17);
assert.equal(capture.counts.originalGNUAgreement, 7);
assert.deepEqual(capture.counts.originalGNUFailures, ['original/aaa']);
const target = capture.rows.find(row => row.id === 'original/aaa');
assert.deepEqual(target.result.overall, { start: 0, end: 3 });
assert.deepEqual(target.result.capture, { start: 1, end: 2 });
assert.deepEqual(target.command, { status: 0, stdoutHex: '610a', stderrHex: '' });
assert.equal(native.rows.find(row => row.id === 'original/aaa').gnu.stdoutHex, '0a');
let tests = 0;
for (const file of capture.scopedTests) {
  assert.equal(file.status, 0);
  const text = readFileSync(path.join(directory, 'candidate-01', file.log), 'utf8');
  tests += Number(text.match(/^# tests (\d+)$/m)[1]);
  assert.match(text, /^# fail 0$/m);
}
assert.equal(tests, 137);
const followup = json('candidate-01/controls-followup.json');
assert.equal(followup.counts.controls, 7);
assert.equal(followup.counts.passed, 6);
assert.equal(followup.counts.resourceProbes, 46);
const cancellation = json('candidate-01/cancellation-final.json');
assert.equal(cancellation.controls.length, 2);
assert.ok(cancellation.controls.every(row => row.passed));
for (const record of [capture, followup]) {
  assert.equal(record.cleanup.activeBeforeSafetyCleanup, 0);
  assert.equal(record.cleanup.activeAfter, 0);
}
assert.equal(cancellation.cleanup.workerAcquisitions, 0);
console.log(JSON.stringify({ verifiedFiles: seal.entries.filter(entry => entry.kind === 'file').length, frozenCases: 28, candidateRows: 30, nativeObservations: 58, unchangedScopedTests: tests, preservedInitialControlFailures: 3, preservedFollowupFailure: 1, finalCancellationChecks: 2, publicAcceptance: false, promotion: false }));
