import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { output, owned, verification } from './verify.mjs';

const [label] = process.argv.slice(2);
if (!/^[a-z][a-z0-9-]*$/u.test(label ?? '')) throw new Error('existing result label required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = await readFile(resolve(output, 'original-runtime.mjs.txt'), 'utf8');
const corrected = await readFile(resolve(owned, 'runtime.mjs'), 'utf8');
const start = corrected.indexOf("await check('public:ordinary-handler-throw-result-and-cleanup-identities'");
const end = corrected.indexOf("await check('public:nested-abort-late-admission-before-child-work'");
assert.ok(start > 0 && end > start);
const restored = (corrected.slice(0, start) + corrected.slice(end))
  .replace("const primary = new api.ShellLimitError('maxCommands');", "const primary = new Error('selected execution failure');")
  .replace("assert.deepEqual(Object.keys(primary), ['limit', 'name']);\n    assert.equal(primary.limit, 'maxCommands');\n    assert.equal(primary.name, 'ShellLimitError');", "assert.deepEqual(Object.keys(primary), []);");
assert.equal(restored, original);
const resultPath = resolve(output, label + '-result.json');
const bytes = await readFile(resultPath);
const result = JSON.parse(bytes);
assert.deepEqual(result.result.counts, { controls: 9, passed: 9, failed: 0 });
assert.equal(result.claim.harnessSha256, verification.fixtureSha256);
assert.equal(result.claim.runnerSha256, hash(await readFile(resolve(output, 'run.mjs'))));
assert.equal(result.claim.verificationSha256, hash(await readFile(resolve(output, label + '-verification.json'))));
assert.equal(result.code, 0);
assert.equal(result.killed, false);
assert.equal(result.exactChildAbsent, true);
assert.throws(() => process.kill(result.pid, 0), error => error.code === 'ESRCH');
for (const entry of JSON.parse(await readFile(resolve(output, 'original-freeze.json'))).preserved.filter(entry => entry.path.includes('/runtime-error-adjudication/'))) {
  const immutable = execFileSync('git', ['show', 'c6303827ea27a53a42806879103fcddac5972201:' + entry.path]);
  assert.equal(hash(immutable), entry.sha256);
}
const commits = [];
for (const commit of [verification.fixtureCorrectionCommit, verification.fixtureCommit]) {
  const paths = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', commit]).toString().trim().split('\n');
  assert.deepEqual(paths, ['tests/stress/regex-execution/cleanup-boundary-review/runtime.mjs']);
  commits.push({ commit, paths });
}
execFileSync('git', ['merge-base', '--is-ancestor', 'a3d3f773bac699bd11ac37f53694004cc4842797', 'HEAD']);
const summary = {
  time: new Date().toISOString(), resultPath, resultSha256: hash(bytes),
  fixtureSha256: verification.fixtureSha256, commits,
  unchangedOriginalGroups: 7, correctedOriginalGroups: 1, addedOrdinaryGroupVariants: 3,
  counts: result.result.counts, preservedArtifacts: verification.preservedArtifacts,
  adjudicationFilesMatchCommit: true, minimalDeltaExactlyReversible: true,
  childPid: result.pid, exactChildAbsent: true, strictUnhandled: result.claim.strictUnhandled,
  publicBoundaries: result.result.boundaryObserver.boundaries.length,
  finalWorkers: result.result.boundaryObserver.finalWorkers.length,
  concurrentVerifierOriginalCommitRestored: 'a3d3f773bac699bd11ac37f53694004cc4842797',
  riskConsumed: 0, additionalSix: 'UNUSED', packedCorrectedCohort: 'different verifier; not executed here',
};
await writeFile(resolve(output, label + '-audit.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(summary));
