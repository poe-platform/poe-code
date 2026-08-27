import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const base = new URL('./', import.meta.url);
const root = new URL('../../../../', base);
const digest = value => createHash('sha256').update(value).digest('hex');
const frozen = JSON.parse(readFileSync(new URL('frozen.json', base)));
const all = readdirSync(new URL('evidence/', base)).sort().map(name => ({ name, bytes: readFileSync(new URL('evidence/' + name, base)) })).map(item => ({ ...item, row: JSON.parse(item.bytes) }));
const children = all.filter(item => item.row.messages);
assert.equal(children.length, 178);
const rows = children.map(item => {
  const child = item.row;
  assert.equal(child.killed, false); assert.equal(child.code, 0); assert.equal(child.signal, null);
  for (const event of ['exit', 'disconnect', 'stdout-close', 'stderr-close', 'close']) assert(child.events.some(item => item.event === event));
  const done = child.messages.find(item => item.type === 'done');
  assert(done); assert.equal(done.failure, undefined);
  for (const metrics of done.cleanup) { assert.equal(metrics.created, metrics.terminated); assert.equal(metrics.listenersAfter, 0); }
  return { file: item.name, args: child.args, ...done };
});
const benches = rows.filter(row => row.args[0] === 'bench');
assert.equal(benches.length, 144);
for (const row of benches) { assert.equal(row.result.status, 'completed'); assert.equal(row.result.matches, row.result.expectedMatches); }
const risks = rows.filter(row => row.args[0] === 'risk');
assert.equal(risks.length, 3);
assert.equal(risks[0].result.status, 'completed'); assert.equal(risks[0].result.outcome, null);
assert.equal(risks[1].result.error, 'WORK_DEADLINE'); assert(risks[1].heartbeats > 0);
assert.equal(risks[2].result.error, 'EXPLICIT_ABORT'); assert(risks[2].heartbeats > 0);
const median = values => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
const range = values => ({ min: Math.min(...values), median: median(values), max: Math.max(...values) });
const groups = {};
for (const row of benches) {
  const key = row.args.slice(1, 4).join('/');
  (groups[key] ??= []).push(row);
}
const benchmarkSummary = Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, {
  repetitions: values.length,
  startupMs: range(values.map(row => row.result.startupMs)), setupMs: range(values.map(row => row.result.setupMs)),
  steadyMs: range(values.map(row => row.result.steadyMs)), endToEndMs: range(values.map(row => row.result.endToEndMs)),
  peakRss: range(values.map(row => row.peakRss)), responseBytes: values.map(row => row.result.responseBytes),
  calls: values.map(row => row.result.calls), requests: values.map(row => row.result.metrics?.requests ?? null),
}]));
const verified = {};
for (const [path, expected] of Object.entries({ ...frozen.source, ...frozen.built })) {
  const actual = digest(readFileSync(new URL(path, root)));
  assert.equal(actual, expected, path); verified[path] = actual;
}
const prior = JSON.parse(readFileSync(new URL('../compiled-matrix/frozen.json', base)));
const overlap = Object.keys(prior.sourceHashes).filter(path => path in frozen.source);
const historicalDrift = overlap.filter(path => prior.sourceHashes[path] !== frozen.source[path]);
const observation = {};
for (const path of ['src/commands/search/rg.ts', 'src/commands/search/shared.ts', 'src/commands/search/output.ts', 'src/commands/search/glob.ts', 'src/commands/text-programs/sed.ts', 'src/commands/text-programs/awk-runtime.ts', 'src/commands/search/README.md', 'src/commands/README.md', 'src/commands/text-programs/README.md']) observation[path] = digest(readFileSync(new URL(path, root)));
const workerGraph = {};
for (const name of ['worker', 'matching', 'protocol']) {
  const path = `tests/stress/regex-execution/design/.build/js/tests/stress/regex-execution/design/${name}.js`;
  const text = readFileSync(new URL(path, root), 'utf8');
  const imports = text.split('\n').filter(line => line.startsWith('import '));
  workerGraph[name] = { sha256: digest(text), imports };
  assert(!text.includes('eval(')); assert(!text.includes('process.')); assert(!text.includes('node:fs')); assert(!text.includes('node:net'));
}
const summary = {
  utc: new Date().toISOString(), sourceFreezeCommit: spawnSync('git', ['rev-parse', '4484026'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  frozenArtifactSha256: digest(readFileSync(new URL('frozen.json', base))), sourceBundleSha256: digest(readFileSync(new URL('source-bundle.json', base))),
  counts: { children: rows.length, benign: 175, vectorProfiles: 30, vectorAccepted: rows.filter(row => row.result?.status === 'exact-native-worker').length, vectorRejected: rows.filter(row => row.result?.status === 'tool-rejection-preserved-no-worker-regex').length, lifecycleChildren: 1, lifecycleCases: rows.find(row => row.args[0] === 'lifecycle').result.length, benchmarkChildren: benches.length, pathological: 3, historicalPathological: 7, cumulativePathological: 10, reviewerReserved: 2, failedChildren: 0, watchdogKills: 0, workerCreated: rows.reduce((sum, row) => sum + row.cleanup.reduce((total, metric) => total + metric.created, 0), 0), workerTerminated: rows.reduce((sum, row) => sum + row.cleanup.reduce((total, metric) => total + metric.terminated, 0), 0) },
  risks, lifecycle: rows.find(row => row.args[0] === 'lifecycle'), vectors: rows.filter(row => row.args[0] === 'vector'),
  benchmarkSummary, globalRss: range(rows.map(row => row.peakRss)),
  workerStartupMs: range(benches.filter(row => row.result.metrics).map(row => row.result.startupMs)),
  workerTerminationMs: range(rows.flatMap(row => row.cleanup.filter(metric => metric.created).map(metric => metric.terminationMs))),
  historicalOverlap: overlap, historicalDrift, postRunObservationOnly: observation, workerGraph,
  verified, evidenceHashes: Object.fromEntries(all.map(item => [item.name, digest(item.bytes)])),
  claims: all.filter(item => item.name.endsWith('.claim.json')).map(item => item.row),
  cleanup: 'All recorded exact children exit/disconnect/stdout-close/stderr-close/close; all created workers awaited termination and closed listeners. No active test child claimed beyond those observed handles.',
};
writeFileSync(new URL('summary.json', base), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ counts: summary.counts, risks: risks.map(row => ({ name: row.args[1], result: row.result, heartbeats: row.heartbeats, maxGap: row.maxGap, peakRss: row.peakRss })), startup: summary.workerStartupMs, termination: summary.workerTerminationMs, rss: summary.globalRss, historicalDrift }, null, 2));
