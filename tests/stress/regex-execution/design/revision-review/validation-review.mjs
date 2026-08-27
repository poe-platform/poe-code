import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('./', import.meta.url));
const root = resolve(base, '../../../../..');
const prefix = 'tests/stress/regex-execution/design/validation/';
const evidence = resolve(root, prefix, 'evidence');
const markerBytes = readFileSync('/tmp/regex-revision-validation-ready.txt');
const marker = JSON.parse(markerBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(readFileSync(resolve(evidence, name)));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 16777216 });
assert.match(marker.evidenceCommit, /^[0-9a-f]{40}$/u);
const pinned = {};
for (const path of git('ls-tree', '-r', '--name-only', marker.evidenceCommit, '--', prefix).toString().trim().split('\n')) {
  const bytes = readFileSync(resolve(root, path)); assert.deepEqual(bytes, git('show', `${marker.evidenceCommit}:${path}`), path); pinned[path] = hash(bytes);
}
for (const [path, expected] of Object.entries(marker.sourceHashes)) assert.equal(hash(readFileSync(resolve(root, path))), expected, path);
for (const [path, expected] of [[marker.report, marker.reportSha256], [marker.policy, marker.policySha256], [marker.audit, marker.auditSha256], [prefix + 'evidence/cleanup.json', marker.cleanupSha256]]) assert.equal(pinned[path], expected, path);
const records = readdirSync(evidence).filter(name => /^run-(?:\d+|recheck-17)\.json$/u.test(name)).map(name => ({ name, record: read(name) }));
assert.equal(records.length, 53);
const results = records.map(({ name, record }) => {
  for (const event of ['exit', 'disconnect', 'stdout-close', 'stderr-close', 'close']) assert(record.events.some(entry => entry.event === event), name + ':' + event);
  assert.equal(record.killed, false); assert.equal(record.signal, null);
  const result = record.messages.find(message => message.type === 'done')?.result; assert(result, name);
  assert.equal(record.code, result.pass ? 0 : 1, name);
  return { name, args: record.args, result };
});
assert.deepEqual(results.filter(entry => !entry.result.pass).map(entry => entry.name), ['run-17.json']);
const effective = results.filter(entry => entry.name !== 'run-17.json');
const vectors = effective.filter(entry => entry.args[0] === 'vector'); assert.equal(vectors.length, 22);
for (const entry of vectors) {
  assert.deepEqual(entry.result.outputs.current, entry.result.outputs.worker, entry.name);
  assert.equal(entry.result.outputs.current.stdoutHex, entry.result.expected.stdoutHex);
  assert.equal(entry.result.outputs.current.status, entry.result.expected.status);
}
const raw = effective.filter(entry => entry.args[0] === 'raw'); assert.equal(raw.length, 6);
const policy = effective.filter(entry => entry.args[0] === 'policy'); assert.equal(policy.length, 5);
const idle = policy.find(entry => entry.result.id === 'idle-invocation-rejection-demonstration'); assert.equal(idle.result.observedAdmission, 'CAPACITY_BUSY');
const live = policy.find(entry => entry.result.id === 'lease-free-live-shell').result;
assert.equal(live.stdout, 'a\na\n'); assert.equal(live.adapter.active, 0); assert.equal(live.adapter.created, 2); assert.equal(live.adapter.terminated, 2); assert.equal(live.adapter.completed, 6);
const concurrent = policy.find(entry => entry.result.id === 'concurrent-shell-pipelines').result;
assert.equal(concurrent.pipelines, 3); assert.equal(concurrent.adapter.completed, 18); assert.equal(concurrent.adapter.created, 2); assert.equal(concurrent.adapter.terminated, 2); assert.equal(concurrent.adapter.peak, 1); assert.equal(concurrent.adapter.peakWaiting, 5);
const timings = effective.filter(entry => entry.args[0] === 'bench'); assert.equal(timings.length, 18);
const work = {};
for (const workload of ['long-linear', 'small-many-line']) {
  const entries = timings.filter(entry => entry.result.id === workload); assert.equal(entries.length, 9);
  for (const key of ['inputUtf8Bytes', 'inputUtf16Bytes', 'rows', 'hits', 'execCalls', 'captureValues', 'selectedBytes', 'selectedSha256', 'serializedBytes', 'serializedSha256']) assert.equal(new Set(entries.map(entry => entry.result[key])).size, 1, workload + ':' + key);
  for (const engine of ['current', 'worker', 'worker-stream']) assert.equal(entries.filter(entry => entry.result.engine === engine).length, 3);
  work[workload] = entries.map(entry => ({ name: entry.name, engine: entry.result.engine, workMs: entry.result.workMs, startupMs: entry.result.startupMs, logicalSha256: entry.result.serializedSha256, selectedSha256: entry.result.selectedSha256, protocolHitBytes: entry.result.protocolHitBytes, requests: entry.result.metrics?.requests, retirementOverlapsWork: entry.result.streamIncludesAutomaticDisposal }));
}
const packageBuild = read('package-build.json');
assert.equal(packageBuild.status, 0); assert.equal(packageBuild.unpackStatus, 0); assert.equal(packageBuild.manifest.type, 'module'); assert.equal(packageBuild.manifest.engines.node, '>=22'); assert.deepEqual(packageBuild.manifest.dependencies, {}); assert.deepEqual(packageBuild.fileHashes, packageBuild.movedHashes);
const fixed = JSON.parse(readFileSync(resolve(base, 'evidence/fixed-freeze.json')));
for (const name of ['client', 'matching', 'protocol', 'worker']) assert.equal(packageBuild.fileHashes[name + '.js'], fixed.built['tests/stress/regex-execution/design/' + name + '.js']);
assert(packageBuild.pack.files.some(entry => entry.path === 'worker.js'));
const consumer = effective.find(entry => entry.args[0] === 'package').result;
assert.equal(consumer.node, 'v22.22.2'); assert.equal(consumer.metrics.created, 1); assert.equal(consumer.metrics.terminated, 1); assert.equal(consumer.metrics.listenersAfter, 0); assert(consumer.imported.includes('/moved/node_modules/regex-validation-prototype/client.js'));
const native = read('native.json'); assert.equal(native.results.length, 22); assert.equal(native.riskyExecutions, 0);
assert.equal(native.profiles.find(profile => profile.name === 'gnu-grep-primary').available, false);
const differences = native.results.filter(entry => {
  const vector = vectors.find(vector => vector.result.id === entry.id); assert(vector, entry.id);
  return vector.result.outputs.current.stdoutHex !== entry.actual.stdoutHex || vector.result.outputs.current.status !== entry.actual.status;
}).map(entry => ({ id: entry.id, profile: entry.profile, command: entry.command, inputHex: entry.inputHex, actual: entry.actual }));
assert.deepEqual(differences.map(entry => entry.id).sort(), ['grep-ere-order', 'rg-declared-js-digit', 'rg-undocumented-named-backref']);
assert.equal(native.results.filter(entry => !entry.matchesFrozenExpectation).length, 1);
const retainedFailure = results.find(entry => entry.name === 'run-17.json').result;
const recheck = results.find(entry => entry.name === 'run-recheck-17.json').result;
assert.deepEqual(retainedFailure.expected, recheck.expected); assert.equal(retainedFailure.outputs.worker.status, 2); assert.equal(recheck.outputs.worker.status, 0);
const repair = read('repair.json'); assert.equal(repair.unchangedOtherBuiltFiles, 302); assert.equal(repair.benchmarkCodeUnchanged, true);
assert.equal(existsSync(resolve(root, prefix, '.scratch')), false);
const pinnedDocs = Object.fromEntries(['src/commands/README.md', 'src/commands/search/README.md', 'src/commands/search/matcher.ts', 'src/commands/search/options.ts', 'src/shell/types.ts', 'src/shell/runtime.ts', 'package.json', 'src/index.ts'].map(path => [path, hash(git('show', `${marker.evidenceCommit}:${path}`))]));
const review = { utc: new Date().toISOString(), evidenceCommit: marker.evidenceCommit, markerSha256: hash(markerBytes), pinned, pinnedDocs, sourceHashes: marker.sourceHashes, independentlyRecomputed: { actualChildren: 53, retainedFailingChildren: 1, passingObservations: 52, effectiveCommandVectors: 22, rawCaptureVectors: 6, policyVectors: 5, negativePolicyObservations: 1, timingObservations: 18, packageConsumers: 1, nativeCalls: 22, nativeStatusStdoutAgreements: 19, GNUgrepCalls: 0, nativeOriginalExpectationFailures: 1 }, differences, work, package: { archiveSha256: packageBuild.archiveSha256, matchingIndependentCompiledAssets: 4, manifest: packageBuild.manifest, consumer }, preserved: { initialCompilerFailure: pinned[prefix + 'evidence/build-initial.json'], originalAdapterFailure: retainedFailure, targetedRecheck: recheck, repair }, limitations: ['Evidence inspection/recount only; no broad rerun and no additional worker/regex execution.', 'Copied command adapters retain host-side RegExp construction, omit caller signal from workerHits, and reuse cumulative Client budgets per descriptor session; not production-isolated command execution.', 'Eight-waiter/four-session test bounds still fail at saturation and do not implement cancellation-aware admission; finite pipeline demonstrations are not starvation or arbitrary-input guarantees.', 'Prototype invocation Capacity still pins idle slot/rejects competitors; policy correctly rejects adopting that as a global default.', 'No approved default timeout or shared aggregate budget; experimental prototype limits are narrower than documented product limits.', 'Microbenchmark output work matches; framing, JIT warmness, interruption/cohost load, startup, overlapping stream retirement and non-peak RSS preclude strong speed/memory claims.', 'GNU grep unavailable; documented JS choices differ from native targets and named backreference acceptance remains an existing advertised-contract mismatch.', 'Packed moved prototype proof is not the virtual-bash root published package/API integration.'], reviewerNewRiskConsumed: 0 };
writeFileSync(resolve(base, 'evidence/validation-ready.txt'), markerBytes, { flag: 'wx' });
writeFileSync(resolve(base, 'evidence/validation-review.json'), JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pinnedArtifacts: Object.keys(pinned).length, ...review.independentlyRecomputed, reviewerNewRiskConsumed: 0 }));
