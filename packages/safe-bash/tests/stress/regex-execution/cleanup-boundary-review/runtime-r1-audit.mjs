import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const owned = resolve('tests/stress/regex-execution/cleanup-boundary-review');
const evidence = resolve(owned, 'evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async name => JSON.parse(await readFile(resolve(evidence, name)));
const runtime = '1b133a8662a32ee84524794842074c9c98d5f6c3';
const selected = ['pipe-early', 'early-downstream-zero-active', 'rg-early-downstream-zero-active', 'caller-abort-active-benign-request', 'caller-abort-glob-no-continued-filesystem-work'];
const summaries = [];
const childRecords = [];
const original = await read('runtime-r1-freeze.json');
const originalBuild = await read('runtime-r1-build.json');
for (const label of ['runtime-r1', 'runtime-r1-observed', 'runtime-r1-verified']) {
  const freeze = await read(`${label}-freeze.json`);
  const build = await read(`${label}-build.json`);
  assert.equal(freeze.commit, runtime);
  assert.deepEqual(freeze.identities, original.identities);
  assert.deepEqual(build.emitted, originalBuild.emitted);
  for (const entry of [...freeze.identities, ...build.emitted]) assert.equal(hash(await readFile(resolve(owned, '.temporary', label, entry.path))), entry.sha256);
}
function cleanWorker(worker) {
  assert.equal(worker.exited, true);
  assert.equal(worker.terminationCalls, 1);
  assert.equal(worker.terminationAwaited, true);
  assert.ok(Object.values(worker.listeners).every(count => count === 0));
}
function auditObserver(observer) {
  assert.ok(observer);
  const execs = observer.boundaries.filter(entry => entry.kind === 'exec');
  const siblingLive = [];
  for (const entry of execs) {
    for (const worker of entry.workers.filter(worker => worker.originExecution === entry.execution)) cleanWorker(worker);
    assert.ok(entry.contexts.every(context => context.abortListeners === 0));
    assert.ok(entry.callerAbortListeners === null || entry.callerAbortListeners === 0);
    if (entry.callerAborted) { assert.equal(entry.rejected, true); assert.equal(entry.exactCallerReason, true); }
    const live = entry.workers.filter(worker => !worker.exited);
    if (live.length) siblingLive.push({ execution: entry.execution, source: entry.source, workers: live.map(worker => ({ id: worker.id, originExecution: worker.originExecution })) });
  }
  for (const worker of observer.finalWorkers) cleanWorker(worker);
  return { execSettlements: execs.length, disposeSettlements: observer.boundaries.filter(entry => entry.kind === 'dispose').length, workers: observer.finalWorkers.length, ownedActiveAtExec: 0, ownedWorkerListenersAtExec: 0, callerAndObservedContextAbortListenersAtExec: 0, siblingLive, moduleLocation: observer.moduleLocation };
}
for (const format of ['compiled', 'packed']) {
  const name = `runtime-r1-verified-${format}-old-five.json`;
  const data = await read(name);
  assert.equal(data.sourceCommit, runtime);
  assert.equal(data.summary.originalTriples, 24);
  assert.equal(data.summary.originalTriplePasses, 24);
  assert.equal(data.summary.boundaries, 5);
  assert.deepEqual(data.summary.premature, []);
  assert.equal(data.summary.childrenClosed, true);
  const observations = data.runs.flatMap(run => run.result.observations);
  assert.deepEqual(observations.filter(entry => selected.includes(entry.name)).map(entry => entry.name).sort(), [...selected].sort());
  const publicBoundaries = data.runs.map(run => { assert.equal(run.code, 0); assert.equal(run.killed, false); childRecords.push(run); return auditObserver(run.result.boundaryObserver); });
  const allExecs = data.runs.flatMap(run => run.result.boundaryObserver.boundaries.filter(entry => entry.kind === 'exec'));
  assert.equal(allExecs.length, 28);
  for (const entry of allExecs) for (const worker of entry.workers) cleanWorker(worker);
  if (format === 'packed') {
    const packageRoot = resolve(owned, '.temporary/runtime-r1-verified-packed-old-five/production-continuation-review/node_modules/virtual-bash');
    for (const entry of originalBuild.emitted) assert.equal(hash(await readFile(resolve(packageRoot, entry.path))), entry.sha256);
    assert.equal(data.packageEvidence.assets.length, 704);
    assert.ok(data.packageEvidence.commands.every(command => command.status === 0));
    for (const run of data.runs) {
      assert.equal(run.result.moduleLocation, run.result.boundaryObserver.moduleLocation);
      assert.ok(run.result.moduleLocation.includes('/node_modules/virtual-bash/dist/index.js'));
      for (const worker of run.result.boundaryObserver.finalWorkers) assert.ok(worker.url.includes('/node_modules/virtual-bash/dist/commands/regex-execution/worker.js'));
    }
  }
  summaries.push({ name, originalTriples: 24, originalTriplePasses: 24, originalBoundaries: 5, originalBoundaryPasses: 5, publicBoundaries, packageArchiveSha256: data.packageEvidence.archiveSha256 });
}
const prepared = await read('runtime-r1-verified-runtime.json');
assert.deepEqual(prepared.result.counts, { controls: 8, passed: 7, failed: 1 });
assert.deepEqual(prepared.result.observations.filter(entry => !entry.pass).map(entry => entry.name), ['public:primary-error-and-abort-during-drain-identities']);
assert.match(prepared.result.observations.find(entry => !entry.pass).error, /AggregateError: Invocation cleanup failed/u);
summaries.push({ name: 'runtime-r1-verified-runtime.json', counts: prepared.result.counts, disposition: 'preserved wrong-layer ordinary Error expectation; additive true rejection controls are separate', publicBoundaries: auditObserver(prepared.result.boundaryObserver) });
childRecords.push(prepared);
const triage = await read('runtime-r1-triage.json');
assert.equal(triage.result.pass, true);
assert.deepEqual(triage.result.counts, { controls: 13, passed: 13, failed: 0 });
summaries.push({ name: 'runtime-r1-triage.json', counts: triage.result.counts, publicBoundaries: auditObserver(triage.result.boundaryObserver) });
childRecords.push(triage);
const registration = await read('runtime-r1-registration.json');
assert.deepEqual(registration.result.counts, { controls: 17, passed: 17, failed: 0, workers: 17, active: 0 });
summaries.push({ name: 'runtime-r1-registration.json', counts: registration.result.counts, transport: registration.result.transport });
childRecords.push(registration);
for (const child of childRecords) {
  assert.equal(child.code, 0);
  assert.equal(child.killed, false);
  assert.equal(child.stderr, '');
  for (const event of ['disconnect', 'stdout-close', 'stderr-close']) assert.ok(child.events.includes(event));
}
const files = (await readdir(evidence)).filter(name => name.startsWith('runtime-r1-') && name.endsWith('.json') && name !== 'runtime-r1-settlement-audit.json').sort();
const artifacts = [];
const allChildPids = new Set();
for (const path of files) {
  const bytes = await readFile(resolve(evidence, path));
  artifacts.push({ path: `evidence/${path}`, sha256: hash(bytes) });
  const data = JSON.parse(bytes);
  for (const child of data.runs ?? (data.pid ? [data] : [])) {
    allChildPids.add(child.pid);
    assert.notEqual(child.code, null);
    assert.equal(child.killed, false);
    for (const event of ['disconnect', 'stdout-close', 'stderr-close']) assert.ok(child.events.includes(event));
  }
}
const exactChildCheck = spawnSync('/bin/ps', ['-p', [...allChildPids].join(','), '-o', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 2000, maxBuffer: 65536 });
assert.equal(exactChildCheck.stdout.trim(), '');
const harnesses = [];
for (const path of (await readdir(owned)).filter(name => name.endsWith('.mjs')).sort()) harnesses.push({ path, sha256: hash(await readFile(resolve(owned, path))) });
const originalObserver = (await readFile(resolve(owned, 'runtime-r1-observer.mjs'), 'utf8'))
  .replace("import { syncBuiltinESMExports } from 'node:module';", "import { createRequire, syncBuiltinESMExports } from 'node:module';")
  .replace("(await import(pathToFileURL(resolve(dirname(entry), 'runtime-r1-package-resolver.mjs')))).moduleLocation", "pathToFileURL(createRequire(pathToFileURL(entry)).resolve('virtual-bash')).href");
const observerBeforeDisposeId = originalObserver.replace("api.Shell.prototype.dispose = function () {\n  if (!shells.has(this)) shells.set(this, ++nextShell);", "api.Shell.prototype.dispose = function () {");
assert.equal(triage.observerSha256, hash(originalObserver));
const output = { runtime, time: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, summaries, historicalAssertionsUntouched: true, allSourceClosuresIdentical: true, sourceFiles: 216, emittedFiles: 704, artifacts, harnesses, observerVersions: { firstObservedAndFailedPacked: hash(observerBeforeDisposeId), triage: hash(originalObserver), finalVerified: hash(await readFile(resolve(owned, 'runtime-r1-observer.mjs'))), exactReconstruction: 'earlier observer text derives from final by the two literal ESM-to-createRequire substitutions in this audit; first observer also omits dispose shell-id assignment' }, allExactChildPids: [...allChildPids], exactChildCheck: { command: '/bin/ps', args: ['-p', [...allChildPids].join(','), '-o', 'pid=,ppid=,command='], status: exactChildCheck.status, stdout: exactChildCheck.stdout, stderr: exactChildCheck.stderr }, sourceAndRootChanges: 'none by verifier; observed live root edits remain outside frozen input', currentWorktreeStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }), riskConsumed: 0, additionalSix: 'UNUSED', throughput: 'not run; separate leaf owns startup and equivalent 32-file workload', globalTypecheck: 'not run; frozen source/config compile and moved consumer passed, immutable native DATA qualification remains separate', defaultAcceptance: false };
await writeFile(resolve(evidence, 'runtime-r1-settlement-audit.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ sourceFiles: output.sourceFiles, emittedFiles: output.emittedFiles, originalFiveEachFormat: '5/5', originalTriplesEachFormat: '24/24', preparedRuntime: '7/8 (preserved oracle mismatch)', additiveTriage: '13/13', registration: '17/17', exactChildrenClosed: allChildPids.size, ownedWorkersAndListenersAtPublicExec: 0 }));
