import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { owned, jobs, json, identity, verifyPrepared } from './binding.mjs';

const prepared = await verifyPrepared();
const evidence = resolve(owned, 'evidence');
const preparation = await identity(resolve(evidence, 'prepared.json'));
const controls = await json(resolve(evidence, 'controls.json'));
const benign = await json(resolve(evidence, 'benign.json'));
assert.equal(controls.preparedSha256, preparation.sha256);
assert.equal(benign.preparedSha256, preparation.sha256);
assert.equal(controls.pass, true);
assert.equal(benign.pass, true);
assert.equal(controls.runs.length, 4);
assert.equal(benign.runs.length, 1);
const result = benign.runs[0].result;
assert.deepEqual(result.counts, { controls: 9, passed: 9, failed: 0 });
assert.equal(result.entry, pathToFileURL(resolve(prepared.package.packageRoot, 'dist/index.js')).href);
assert.equal(result.boundaries.length, 25);
assert.equal(result.finalWorkers.length, 2);
for (const worker of result.finalWorkers) {
  assert.equal(worker.url, pathToFileURL(resolve(prepared.package.packageRoot, 'dist/commands/regex-execution/worker.js')).href);
  assert.equal(worker.exited, true);
  assert.equal(worker.terminationCalls, 1);
  assert.equal(worker.terminationAwaited, true);
  assert.ok(Object.values(worker.listeners).every(count => count === 0));
}
for (const boundary of result.boundaries) {
  assert.ok(boundary.signals.every(signal => signal.listeners === 0));
  if (boundary.callerListeners !== null) assert.equal(boundary.callerListeners, 0);
  for (const worker of boundary.workers.filter(worker => worker.owner === boundary.owner)) {
    assert.equal(worker.exited, true);
    assert.equal(worker.terminationAwaited, true);
    assert.ok(Object.values(worker.listeners).every(count => count === 0));
  }
}
assert.deepEqual(result.lateErrors, []);
const original = await readFile(resolve(evidence, 'original-runtime.mjs.txt'), 'utf8');
const corrected = await readFile(resolve(evidence, 'corrected-runtime.mjs.txt'), 'utf8');
const addedStart = corrected.indexOf("await check('public:ordinary-handler-throw-result-and-cleanup-identities'");
const addedEnd = corrected.indexOf("await check('public:nested-abort-late-admission-before-child-work'");
assert.ok(addedStart >= 0 && addedEnd > addedStart);
const restored = (corrected.slice(0, addedStart) + corrected.slice(addedEnd))
  .replace("const primary = new api.ShellLimitError('maxCommands');", "const primary = new Error('selected execution failure');")
  .replace("assert.deepEqual(Object.keys(primary), ['limit', 'name']);\n    assert.equal(primary.limit, 'maxCommands');\n    assert.equal(primary.name, 'ShellLimitError');", 'assert.deepEqual(Object.keys(primary), []);');
assert.equal(restored, original, 'all original unrelated fixture bytes preserved');
const author = await json(prepared.fixture.authorCompiledResult.path);
assert.equal(author.code, 0);
assert.equal(author.killed, false);
assert.deepEqual(author.result.counts, { controls: 9, passed: 9, failed: 0 });
const files = await readdir(evidence);
for (const job of jobs) assert.equal(files.includes(`${job}-claim.json`), false, `${job} still unused`);
assert.equal(files.includes('active.lock'), false);
const childChecks = [];
for (const run of [...controls.runs, ...benign.runs]) {
  assert.equal(run.closeAwaited, true);
  assert.equal(run.streamsAndIPCClosed, true);
  assert.equal(run.activeChildren, 0);
  let absent = false;
  try { process.kill(run.pid, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; absent = true; }
  assert.equal(absent, true, `exact child PID ${run.pid} absent`);
  childChecks.push({ job: run.job, pid: run.pid, exactPidAbsent: absent, closeAwaited: true, streamsAndIPCClosed: true });
}
const audit = { phase: 'PHASE1_READY_WAIT_ROOT', time: new Date().toISOString(), pass: true, prepared: preparation, controls: await identity(resolve(evidence, 'controls.json')), benign: await identity(resolve(evidence, 'benign.json')), authorCompiled: { result: prepared.fixture.authorCompiledResult, groups: 9, passed: 9, boundariesIncludingDispose: 51 }, independentPacked: { groups: 9, passed: 9, execBoundariesBeforeDispose: 25, workers: 2, finalLiveWorkers: 0, finalWorkerListeners: 0, lateErrors: 0 }, unrelatedOriginalFixtureBytesUnchanged: true, childChecks, matrix: prepared.matrix, totalTargetBudget: 6, targetSlotsConsumed: 0, remainingTargetSlots: 6, pathologicalRequestsExecuted: 0, defaultAcceptance: false, limits: ['original runtime remains 7/8', 'historical 16 positive variants are separate', 'old five compiled/packed not rerun', 'five custom first-read controls separate', 'benchmark not rerun', 'queue target design reviewed statically, not executed', 'no native-call entry instrumentation or RSS claim', 'phase1 is not authorization'] };
await writeFile(resolve(evidence, 'phase1-audit.json'), JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ phase: audit.phase, pass: true, authorCompiled: '9/9', independentPacked: '9/9', supervisorControls: '4/4', execBoundaries: 25, childChecks, targetSlotsConsumed: 0, remainingTargetSlots: 6 }));
