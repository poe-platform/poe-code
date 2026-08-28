import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scope = dirname(fileURLToPath(import.meta.url)), owned = dirname(scope), repository = resolve(owned, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('/usr/bin/git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const initialSealBytes = git(['show', 'c05ea6ed:tests/commands/structured-length-independent-20260828/SEAL.json']);
assert.deepEqual(await readFile(join(owned, 'SEAL.json')), initialSealBytes);
const initialSeal = JSON.parse(initialSealBytes);
for (const [name, expected] of Object.entries(initialSeal)) assert.equal(hash(await readFile(join(owned, name))), expected, name);
const ownSeal = JSON.parse(await readFile(join(scope, 'SEAL.json')));
const all = {};
async function visit(folder) {
  for (const name of (await readdir(folder)).sort()) {
    const path = join(folder, name), stat = await lstat(path), key = relative(owned, path);
    assert.equal(stat.isSymbolicLink(), false, key);
    if (stat.isDirectory()) { all[key] = null; await visit(path); }
    else { assert.ok(stat.isFile()); all[key] = hash(await readFile(path)); }
  }
}
await visit(owned);
const expected = { ...initialSeal, 'SEAL.json': hash(initialSealBytes), 'actual-review-v1': null,
  ...Object.fromEntries(Object.entries(ownSeal).map(([name, value]) => [`actual-review-v1/${name}`, value])),
  'actual-review-v1/SEAL.json': hash(await readFile(join(scope, 'SEAL.json'))) };
for (const name of Object.keys(initialSeal)) {
  let parent = dirname(name);
  while (parent !== '.') { expected[parent] = null; parent = dirname(parent); }
}
assert.deepEqual(all, expected, 'exact original plus explicitly versioned review scope, including directories');
const report = JSON.parse(await readFile(join(scope, 'attempt-01/REPORT.json')));
assert.equal(report.candidate, '74361026502d76b8c2b696f9c60e410ac9b78d95');
assert.equal(report.freeze, '20351e9920f89cc2a07a98eb24ac062f42be78ad');
assert.equal(report.completed, true); assert.equal(report.scratchRemoved, true);
assert.equal(hash(await readFile(join(scope, 'run.mjs'))), report.runnerSha256);
assert.equal(report.pack.sha256, '351e03ad72b0bd82bb16d97cc50ec80b136edeaf705ec1590b414cb4cdf8b82e');
assert.equal(report.pack.filesMatchedIndependentBuild, 845);
assert.equal(report.archive.sha256, '9b9b7c8a7e4c117c2348dfcbc06be64f6dc569301182142122e806d8c7282625');
for (const [name, digest] of Object.entries(report.holdouts)) {
  assert.equal(hash(git(['show', `${report.freeze}:tests/commands/structured-length-independent-20260828/${name}`])), digest);
}
for (const phase of report.phases) { assert.equal(phase.signal, null); assert.equal(phase.error, null); }
const phase = name => report.phases.find(row => row.id === name);
for (const flavor of ['candidate', 'reverted']) for (const [name, count] of [['semantics', 37], ['trusted-iterator', 4], ['public', 19]]) {
  assert.equal(phase(`${flavor}-${name}`).exitCode, 0); assert.equal(phase(`${flavor}-${name}`).receipt.observations.length, count);
}
for (const [flavor, collected, status] of [['candidate', false, 0], ['reverted', true, 1], ['restored', false, 0]]) {
  assert.equal(phase(`${flavor}-allocation`).receipt.observations[0].productCollected, collected);
  assert.equal(phase(`${flavor}-require-noncollecting`).exitCode, status);
}
assert.equal(phase('moved-public-type-negative').exitCode, 2);
assert.equal((phase('moved-public-type-negative').stdout.match(/error TS2322:/g) ?? []).length, 1);
for (const name of ['changed-module-denied', 'changed-manifest-denied', 'source-fallback-denied']) assert.equal(phase(name).exitCode, 1);
for (const [name, count] of [['semantic-regressions', 91], ['bounded-resource-regressions', 2]]) {
  assert.deepEqual(phase(name).counts, { tests: count, pass: count, fail: 0, skipped: 0, cancelled: 0 });
}
assert.equal(report.productEdits, false); assert.equal(report.nativeOracleExecutions, 0); assert.equal(report.rssMeasurements, 0);
assert.equal(report.packages[0].actualInterpreterSha256, report.packages[2].actualInterpreterSha256);
assert.notEqual(report.packages[0].actualInterpreterSha256, report.packages[1].actualInterpreterSha256);
process.stdout.write(JSON.stringify({ verdict: 'scoped independent acceptance', candidate: report.candidate, unchangedHoldouts: 60,
  unchangedSelectedRegressions: 93, selectedSkips: 0, realReversion: 'rejected', restoredCandidate: 'passes',
  matchedPackedFiles: 845, bindingNegatives: 3, publicTypeNegative: 'one TS2322', originalEvidencePreserved: true }) + '\n');
