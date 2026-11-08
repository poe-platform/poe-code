import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commands, raw, policyNames, workloads } from './fixtures.mjs';
const base = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(base, '../../../../..');
const directory = resolve(base, 'evidence');
const read = name => JSON.parse(readFileSync(resolve(directory, name)));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const frozen = read('frozen.json');
const repair = read('repair.json');
for (const [path, expected] of Object.entries(frozen.source)) assert.equal(sha(resolve(base, '.scratch/source', path)), expected, path);
for (const [path, expected] of Object.entries({ ...frozen.harness, ...frozen.built, ...frozen.generatedCopies, ...repair.overrides })) assert.equal(sha(resolve(root, path)), expected, path);
const runs = readdirSync(directory).filter(name => /^run-.*\.json$/.test(name)).map(name => ({ file: name, ...read(name) }));
assert.equal(runs.length, 53);
const done = entry => entry.messages.find(message => message.type === 'done')?.result;
for (const entry of runs) {
  assert.equal(entry.killed, false, entry.file);
  assert.equal(entry.signal, null, entry.file);
  assert.equal(entry.streamBytes, 0, entry.file);
  assert.equal(entry.messages.filter(message => message.type === 'done').length, 1);
  for (const event of ['exit', 'disconnect', 'stdout-close', 'stderr-close', 'close']) assert(entry.events.some(item => item.event === event), entry.file + ':' + event);
}
const failed = runs.filter(entry => !done(entry)?.pass);
assert.deepEqual(failed.map(entry => entry.file), ['run-17.json']);
const effective = runs.filter(entry => entry.file !== 'run-17.json');
assert(effective.every(entry => done(entry).pass && entry.code === 0));
const native = read('native.json');
const correctedNative = native.results.map(entry => {
  const vector = commands.find(vector => vector.id === entry.id);
  const actual = entry.actual;
  return { id: entry.id, profile: entry.profile, originalExpectedMatches: entry.matchesFrozenExpectation, correctedExpectedMatches: actual.status === vector.native.status && actual.stdoutHex === vector.native.stdoutHex && actual.error === null, productStatusStdoutMatches: actual.status === vector.expected.status && actual.stdoutHex === vector.expected.stdoutHex };
});
assert(correctedNative.every(entry => entry.correctedExpectedMatches));
const benchmarks = [];
const median = values => [...values].sort((left, right) => left - right)[1];
for (const name of workloads) {
  const selected = effective.filter(entry => entry.args[0] === 'bench' && entry.args[1] === name).map(done);
  assert.equal(selected.length, 9);
  for (const field of ['inputUtf8Bytes', 'inputUtf16Bytes', 'rows', 'hits', 'execCalls', 'captureValues', 'selectedBytes', 'selectedSha256', 'serializedBytes', 'serializedSha256']) assert.equal(new Set(selected.map(entry => entry[field])).size, 1, name + ':' + field);
  for (const engine of ['current', 'worker', 'worker-stream']) {
    const records = selected.filter(entry => entry.engine === engine);
    assert.equal(records.length, 3);
    benchmarks.push({ name, engine, medianWorkMs: median(records.map(entry => entry.workMs)), minWorkMs: Math.min(...records.map(entry => entry.workMs)), maxWorkMs: Math.max(...records.map(entry => entry.workMs)), medianStartupMs: median(records.map(entry => entry.startupMs)), medianTerminationMs: engine === 'current' ? null : median(records.map(entry => entry.metrics.terminationMs)), inputUtf8Bytes: records[0].inputUtf8Bytes, inputUtf16Bytes: records[0].inputUtf16Bytes, rows: records[0].rows, hits: records[0].hits, captures: records[0].captureValues, execCalls: records[0].execCalls, batches: records[0].batches, requestsIncludingInit: records[0].metrics?.requests ?? 0, selectedBytes: records[0].selectedBytes, selectedSha256: records[0].selectedSha256, canonicalResultBytes: records[0].serializedBytes, canonicalResultSha256: records[0].serializedSha256, protocolHitBytes: records[0].protocolHitBytes, startupSeparated: true, streamWorkIncludesRetirement: engine === 'worker-stream' });
  }
}
const pack = read('package-build.json');
for (const name of ['client', 'worker', 'matching', 'protocol']) assert.equal(pack.fileHashes[name + '.js'], sha(resolve(base, '.scratch/built/tests/stress/regex-execution/design', name + '.js')));
const results = { pass: true, originalCohortChildren: 52, actualChildren: runs.length, originalFailuresRetained: failed.map(entry => entry.file), targetedRechecks: 1, effectivePasses: effective.length, uniqueVectors: commands.length + raw.length + policyNames.length, commandVectors: commands.length, captureVectors: raw.length, policyVectors: policyNames.length, negativePolicyControls: 1, timingObservations: benchmarks.length * 3, packageConsumers: 1, exactClosedChildren: runs.length, outerKills: 0, riskyExecutions: 0, nativeCalls: native.results.length, originalNativeExpectationFailures: native.results.filter(entry => !entry.matchesFrozenExpectation).length, correctedNativeExpectationPasses: correctedNative.filter(entry => entry.correctedExpectedMatches).length, nativeStatusStdoutAgreements: correctedNative.filter(entry => entry.productStatusStdoutMatches).length, nativeDifferences: correctedNative.filter(entry => !entry.productStatusStdoutMatches), benchmarks, sourceHashes: Object.fromEntries(Object.entries(frozen.source).filter(([path]) => path === 'src/commands/grep.ts' || path.endsWith('/client.ts') || path.endsWith('/worker.ts') || path.endsWith('/protocol.ts') || path.endsWith('/matching.ts') || path === 'src/commands/search/matcher.ts')), frozenSha256: sha(resolve(directory, 'frozen.json')), repairSha256: sha(resolve(directory, 'repair.json')), sourceSnapshotVerified: Object.keys(frozen.source).length, builtFilesVerified: Object.keys(frozen.built).length, initialFailedBuildArtifactsIncludedInHarnessHashCount: Object.keys(frozen.harness).filter(path => path.includes('/.scratch-initial/')).length };
writeFileSync(resolve(directory, 'audit.json'), JSON.stringify(results, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(results, null, 2));
