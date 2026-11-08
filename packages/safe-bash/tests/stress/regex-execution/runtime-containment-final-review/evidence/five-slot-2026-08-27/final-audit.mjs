import assert from 'node:assert/strict';
import { open, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { release } from 'node:os';
import { owned, jobs, json, identity, hash, verifyPrepared } from './binding.mjs';

const prepared = await verifyPrepared();
const evidence = resolve(owned, 'evidence');
const preparation = await identity(resolve(evidence, 'prepared.json'));
const gatePath = '/tmp/regex-containment-six-authorized.txt';
const gate = await json(gatePath);
const gateIdentity = await identity(gatePath);
const journal = (await readFile(resolve(evidence, 'journal.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
const targetClaims = journal.filter(record => record.targetSlotsReserved);
assert.deepEqual(targetClaims.map(record => record.job), jobs.slice(0, 5));
assert.equal(targetClaims.reduce((sum, record) => sum + record.pathologicalRequestsReserved, 0), 4);
assert.equal(gate.preparedSha256, preparation.sha256);
assert.equal(gate.benignSha256, (await identity(resolve(evidence, 'benign.json'))).sha256);
assert.equal(gate.controlsSha256, (await identity(resolve(evidence, 'controls.json'))).sha256);
assert.equal(gate.authority, 'ROOT_EXPLICIT_EXECUTION_AFTER_REVIEWED_BENIGN_GREEN');
assert.equal(gate.totalTargetBudget, 6);
assert.equal(gate.totalPathologicalRequestBudget, 4);
assert.deepEqual(gate.jobs, jobs);
const files = await readdir(evidence);
assert.equal(files.includes('active.lock'), false);
assert.equal(files.includes('STOP.json'), true);
for (const suffix of ['-claim.json', '.json', '-inspection.json']) assert.equal(files.includes(`rg-queued-abort${suffix}`), false);
const runs = [];
const resultIdentities = [];
const inspections = [];
for (const [index, job] of jobs.slice(0, 5).entries()) {
  const resultPath = resolve(evidence, `${job}.json`);
  const result = await json(resultPath);
  const resultIdentity = await identity(resultPath);
  const inspection = await json(resolve(evidence, `${job}-inspection.json`));
  assert.equal(result.pass, true);
  assert.equal(result.preparedSha256, preparation.sha256);
  assert.equal(result.runs.length, 1);
  assert.deepEqual(result.claim, targetClaims[index]);
  assert.deepEqual(await json(resolve(evidence, `${job}-claim.json`)), result.claim);
  assert.equal(result.claim.approval.sha256, gateIdentity.sha256);
  assert.ok(Date.parse(result.claim.time) < Date.parse(gate.expiresAt));
  assert.equal(inspection.resultSha256, resultIdentity.sha256);
  assert.equal(inspection.decision, index < 4 ? 'PASS_REVIEWED_CONTINUE' : 'PASS_REVIEWED_STOP_ALREADY_LATCHED');
  const run = result.runs[0];
  assert.equal(run.code, 0);
  assert.equal(run.signal, null);
  assert.equal(run.killed, false);
  assert.equal(run.outputBytes, 0);
  assert.ok(run.ipcBytes <= 65536);
  assert.equal(run.closeAwaited, true);
  assert.equal(run.streamsAndIPCClosed, true);
  assert.equal(run.activeChildren, 0);
  assert.equal(run.watchdogMs, index < 4 ? 6000 : 8000);
  assert.equal(run.result.pathologicalRequests, index < 4 ? 1 : 0);
  assert.equal(run.result.entry, pathToFileURL(resolve(prepared.package.packageRoot, 'dist/index.js')).href);
  assert.deepEqual(run.result.lateErrors, []);
  for (const worker of run.result.finalWorkers) {
    assert.equal(worker.exited, true);
    assert.equal(worker.terminationCalls, 1);
    assert.equal(worker.terminationAwaited, true);
    assert.equal(worker.heldResponses, 0);
    assert.ok(Object.values(worker.listeners).every(count => count === 0));
    assert.equal(worker.url, pathToFileURL(resolve(prepared.package.packageRoot, 'dist/commands/regex-execution/worker.js')).href);
  }
  resultIdentities.push(resultIdentity);
  inspections.push(await identity(resolve(evidence, `${job}-inspection.json`)));
  runs.push(run);
}
const controls = await json(resolve(evidence, 'controls.json'));
const benign = await json(resolve(evidence, 'benign.json'));
const pidChecks = [];
for (const run of [...controls.runs, ...benign.runs, ...runs]) {
  let absent = false;
  try { process.kill(run.pid, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; absent = true; }
  assert.equal(absent, true, `owned PID ${run.pid} absent`);
  pidChecks.push({ job: run.job, pid: run.pid, absent: true, errorCode: 'ESRCH', closeAwaited: run.closeAwaited, streamsAndIPCClosed: run.streamsAndIPCClosed });
}
const boundaries = runs.flatMap(run => run.result.boundaries);
assert.equal(boundaries.length, 7);
assert.ok(boundaries.every(boundary => boundary.signals.every(signal => signal.listeners === 0)));
const audit = {
  phase: 'STOPPED_AFTER_FIVE_NO_RESUME',
  recordedAt: new Date().toISOString(),
  auditOnly: 'Passive evidence/hash/PID verification; no target launch, worker import, risky matching, fixture replay or benchmark.',
  environment: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch, osRelease: release() },
  gate: gateIdentity,
  gateExpiresAt: gate.expiresAt,
  prepared: preparation,
  sourceAndAssetsVerifiedAgain: { source: prepared.package.sourceCount, emitted: prepared.package.emittedCount },
  frozenPackage: prepared.package,
  fixture: prepared.fixture,
  journal: await identity(resolve(evidence, 'journal.jsonl')),
  stop: await identity(resolve(evidence, 'STOP.json')),
  results: resultIdentities,
  inspections,
  budget: { totalSlots: 6, consumedSlots: 5, unusedSlots: 1, totalPathologicalRequests: 4, consumedPathologicalRequests: 4, retries: 0 },
  counts: { rawHarnessPassed: 5, rawHarnessFailed: 0, scopedReviewedPassed: 5, defaultPassed: 2, activeAbortPassed: 2, queuedPassed: 1, queuedUnexecuted: 1, targetPublicSettlements: boundaries.length, targetWorkers: runs.reduce((sum, run) => sum + run.result.finalWorkers.length, 0) },
  unused: ['rg-queued-abort'],
  targetOutputBytes: runs.reduce((sum, run) => sum + run.outputBytes, 0),
  targetIpcBytes: runs.reduce((sum, run) => sum + run.ipcBytes, 0),
  firstTargetClaimAt: targetClaims[0].time,
  lastTargetResultAt: (await json(resolve(evidence, 'grep-queued-abort.json'))).time,
  targetForkToCloseSumMs: runs.reduce((sum, run) => sum + run.childElapsedMs, 0),
  pidChecks,
  activeOwnedChildren: 0,
  substantiveProductOrFrozenHarnessDefectEstablished: false,
  stopClassification: 'Reviewer confused constructor-scope labels with current shared-pool ownership; read-only diagnosis resolved ambiguity. Stop was already latched and no sixth launch followed.',
  recommendation: 'Default and active-abort probes accepted only within frozen measured scope. Complete six-slot acceptance withheld; rg queued control unexecuted.',
  limits: ['No direct V8 native-call instrumentation', 'Queue control uses benign held real-worker replies, not catastrophic matching', 'Creation owner is not current lease ownership', 'No full-shell, universal-preemption, RSS, performance-win or superiority claim', 'Historical twelve probes, original five, corrected phase1 fixture and benchmark not rerun', 'No global data-TS qualification or five-custom-first-read claim'],
  auditScriptSha256: hash(await readFile(resolve(owned, 'final-audit.mjs')))
};
const handle = await open(resolve(evidence, 'final-audit.json'), 'wx');
try { await handle.writeFile(JSON.stringify(audit, null, 2) + '\n'); await handle.sync(); }
finally { await handle.close(); }
console.log(JSON.stringify({ phase: audit.phase, budget: audit.budget, counts: audit.counts, pidChecks, activeOwnedChildren: 0 }));
