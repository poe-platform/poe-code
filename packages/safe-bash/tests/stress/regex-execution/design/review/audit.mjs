import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { scenarios, risks, flags } from './fixtures.mjs';

const base = new URL('./', import.meta.url); const root = new URL('../../../../../', base);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(new URL(path, base));
const json = path => JSON.parse(read(path));
const build = json('evidence/build.json');
for (const [path, expected] of Object.entries(build.source)) assert.equal(hash(readFileSync(new URL(path, root))), expected, path);
for (const [path, expected] of Object.entries(build.built)) assert.equal(hash(read('.temporary/js/' + path)), expected, path);
assert.equal(hash(readFileSync(build.runtime.execPath)), build.runtime.sha256);
const evidence = {};
const rows = [...scenarios, ...risks].map(name => {
  const path = 'evidence/' + name + '.json'; evidence[path] = hash(read(path));
  const claimPath = 'evidence/' + name + '.claim.json'; evidence[claimPath] = hash(read(claimPath));
  const raw = json(path); const done = raw.messages.find(message => message.type === 'done');
  assert(done); assert.equal(raw.killed, false); assert.equal(raw.code, 0); assert.equal(raw.stderr, '');
  assert.deepEqual(done.flags, flags);
  for (const event of ['exit', 'disconnect', 'stdout-close', 'stderr-close', 'close']) assert(raw.events.some(item => item.event === event));
  for (const client of done.cleanup) {
    assert.equal(client.metrics.created, client.metrics.terminated);
    assert.equal(client.metrics.listenersAfter, 0); assert.equal(client.pending, false); assert.equal(client.busy, false);
    assert.equal(client.releaseHeld, false); assert.equal(client.capacityActive, 0); assert.equal(client.signalListeners, 0);
    assert(Object.values(client.workerListeners).every(count => count === 0));
    if (client.metrics.created) assert.equal(client.workerThreadId, -1);
  }
  return { name, status: done.failure ? 'failed-frozen-expectation' : 'passed', failure: done.failure, elapsedMs: done.elapsedMs, heartbeats: done.heartbeats, maxGap: done.maxGap, created: done.cleanup.reduce((total, client) => total + client.metrics.created, 0), terminated: done.cleanup.reduce((total, client) => total + client.metrics.terminated, 0), observations: done.observations };
});
assert.deepEqual(rows.filter(row => row.failure).map(row => row.name), ['idle-exit', 'live-source']);
const author = json('../summary.json');
let authorEvidenceVerified = 0;
for (const [path, expected] of Object.entries(author.evidenceHashes)) {
  assert.equal(hash(read('../evidence/' + path)), expected, path); authorEvidenceVerified++;
}
const previous = json('../../compiled-matrix/frozen.json');
const overlap = Object.keys(previous.sourceHashes).filter(path => path in build.source);
const historicalDrift = overlap.filter(path => previous.sourceHashes[path] !== build.source[path]);
const observedPaths = ['src/commands/search/rg.ts', 'src/commands/search/shared.ts', 'src/commands/search/output.ts', 'src/commands/search/matcher.ts', 'src/commands/grep.ts', 'src/commands/internal.ts', 'package.json', 'tsconfig.build.json'];
const staticObservation = Object.fromEntries(observedPaths.map(path => [path, hash(readFileSync(new URL(path, root)))]));
const artifact = {
  utc: new Date().toISOString(), independent: { benignScenarios: scenarios.length, benignPassed: rows.filter(row => scenarios.includes(row.name) && !row.failure).length, benignFailed: rows.filter(row => scenarios.includes(row.name) && row.failure).length, riskExecuted: risks.length, riskPassed: rows.filter(row => risks.includes(row.name) && !row.failure).length, historicalRisk: 7, authorRisk: 3, cumulativeRisk: 12, riskReservationRemaining: 0, childExecutions: rows.length, outerKills: 0, createdWorkers: rows.reduce((total, row) => total + row.created, 0), awaitedWorkerDisposals: rows.reduce((total, row) => total + row.terminated, 0), finalOwnedChildren: 0 },
  buildSha256: hash(read('evidence/build.json')), authorReportSha256: hash(read('../REPORT.md')), authorSummarySha256: hash(read('../summary.json')), authorEvidenceVerified, authorCountsNotReviewCounts: author.counts,
  authorBenchmarkObservationOnly: { repeatedByReviewer: 0, startup: author.workerStartupMs, selected: Object.fromEntries(Object.entries(author.benchmarkSummary).filter(([key]) => key.includes('short-10000'))) },
  historical: { reportCommit: 'df4d05b28436114e115b5c1cae9e6667ef98b810', reportSha256: hash(read('../../compiled-matrix/REPORT.md')), sourceOverlap: overlap.length, historicalDrift },
  staticObservation, evidence, rows,
};
writeFileSync(new URL('evidence/audit.json', base), JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...artifact.independent, authorEvidenceVerified, historicalDrift, buildSha256: artifact.buildSha256 }));
