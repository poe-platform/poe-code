import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)), repository = resolve(root, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [];
const visit = async relative => {
  for (const name of (await readdir(join(root, relative))).sort()) {
    const child = join(relative, name), stat = await lstat(join(root, child));
    assert.equal(stat.isSymbolicLink(), false, child);
    if (stat.isDirectory()) await visit(child); else { assert.ok(stat.isFile()); if (child !== 'SEAL.json') files.push(child); }
  }
};
await visit('');
const seal = JSON.parse(await readFile(join(root, 'SEAL.json'), 'utf8'));
assert.deepEqual(files.sort(), Object.keys(seal).sort(), 'exact evidence file census');
for (const name of files) assert.equal(hash(await readFile(join(root, name))), seal[name], name);
const git = args => execFileSync('/usr/bin/git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
for (const name of ['worker.mjs', 'vectors.json', 'deny-native.mjs', 'PRECODE.md', 'run.mjs']) {
  assert.deepEqual(await readFile(join(root, name)), git(['show', `20351e99:tests/commands/structured-length-independent-20260828/${name}`]), name);
}
const baseline = JSON.parse(await readFile(join(root, 'baseline-v2/REPORT.json'), 'utf8'));
assert.equal(baseline.freezeCommit, '20351e9920f89cc2a07a98eb24ac062f42be78ad');
assert.equal(baseline.baseline, '5137a74ec855a32d8a8860eb66b62eb44d11e290');
assert.equal(baseline.completed, true); assert.equal(baseline.scratchRemoved, true);
assert.equal(baseline.implementationCandidateReviewed, false);
assert.equal(baseline.realCandidateReversionMutant, 'pending candidate');
assert.equal(baseline.source['src/commands/structured/interpreter.ts'].sha256, 'bac1cf5325eff5bfa69f1c8bec5d3d8a80bb452fd61cdc802d55a26788acaffc');
for (const [name, count] of [['semantics', 37], ['trusted-iterator', 4], ['public', 19]]) {
  const phase = baseline.phases.find(phase => phase.id === name); assert.equal(phase.exitCode, 0);
  assert.equal(phase.receipt.observations.length, count);
}
const allocation = baseline.phases.find(phase => phase.id === 'allocation').receipt.observations[0];
assert.equal(allocation.productCollected, true); assert.equal(allocation.counterControl, true);
assert.equal(allocation.instrumentationCountercontrol, true); assert.equal(allocation.restored, true);
for (const name of ['changed-built-module-denied', 'changed-manifest-denied']) assert.equal(baseline.phases.find(phase => phase.id === name).exitCode, 1);
for (const [name, count] of [['semantic-regressions', 91], ['bounded-resource-regressions', 2]]) {
  assert.deepEqual(baseline.phases.find(phase => phase.id === name).counts, { tests: count, pass: count, fail: 0, cancelled: 0, skipped: 0 });
}
const before = JSON.parse(await readFile(join(root, 'baseline-v1/REPORT.json'), 'utf8'));
assert.equal(before.phases[0].exitCode, 0); assert.equal(before.phases[1].exitCode, 1);
assert.match(before.phases[1].stderr, /ERR_ACCESS_DENIED/); assert.equal(before.phases[1].receipt, undefined);
assert.equal(baseline.nativeExecution, 0);
assert.equal(hash(await readFile(join(root, 'run-v2.mjs'))), baseline.runnerSha256);
process.stdout.write(JSON.stringify({ sealedFiles: files.length, precodeFreeze: baseline.freezeCommit, boundedObservationGroups: 60,
  unchangedRegressions: 93, bindingControlsRejected: 2, desiredNoncollection: 'still fails on unchanged baseline',
  initialSetupFailureRetained: true, candidateReview: 'pending', realReversion: 'pending' }) + '\n');
