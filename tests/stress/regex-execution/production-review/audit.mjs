import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const owned = resolve('tests/stress/regex-execution/production-review');
const json = async path => JSON.parse(await readFile(resolve(owned, path), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const snapshots = {};
for (const name of ['baseline', 'production-first', 'production-final']) {
  const manifest = await json(`evidence/${name}-freeze.json`);
  for (const entry of manifest.identities) assert.equal(hash(await readFile(resolve(manifest.snapshot, entry.path))), entry.sha256, `${name}:${entry.path}`);
  snapshots[name] = { head: manifest.head, time: manifest.time, count: manifest.identities.length, dirtyConsumed: manifest.identities.filter(entry => entry.dirty), manifestSha256: hash(await readFile(resolve(owned, `evidence/${name}-freeze.json`))) };
  if (name !== 'baseline') {
    const build = await json(`evidence/${name}/build.json`);
    assert.equal(build.status, 0);
    for (const entry of build.emitted) assert.equal(hash(await readFile(resolve(manifest.snapshot, entry.path))), entry.sha256, `${name}:${entry.path}`);
    snapshots[name].emittedCount = build.emitted.length;
  }
}
const original = await json('evidence/baseline-freeze.json');
assert.equal(hash(await readFile(resolve(owned, 'prior-evidence.tgz'))), original.historicalArchiveSha256);
const historicalDrift = [];
for (const entry of original.historical) if (hash(await readFile(resolve(entry.path))) !== entry.sha256) historicalDrift.push(entry.path);
const runs = [];
for (const name of ['baseline', 'production-first', 'production-final']) {
  for (const entry of await readdir(resolve(owned, 'evidence', name))) {
    if (!entry.endsWith('.json') || entry.endsWith('-claim.json')) continue;
    const value = await json(`evidence/${name}/${entry}`);
    if (!value.claim || !value.events) continue;
    assert.equal(value.killed, false); assert.equal(value.code, 0);
    for (const event of ['exit', 'disconnect', 'output-close', 'error-close']) assert.ok(value.events.some(item => item.kind === event), `${name}/${entry}: ${event}`);
    runs.push({ snapshot: name, file: entry, summary: value.result.summary, pass: value.result.pass, failures: value.result.observations.filter(item => !item.pass), metricsCount: value.result.metrics.length, unresolvedAtObservation: value.result.metrics.filter(worker => !worker.exited).length });
  }
}
const baseline = await json('evidence/baseline-commands.json');
const nativeAgreement = baseline.native.map(item => {
  const product = baseline.results.find(result => result.id === item.id);
  return { id: item.id, profile: item.profile, sameStdoutStatus: product.code === item.code && product.stdout === item.stdout, nativeStatus: item.code, productStatus: product.code };
});
const benchmark = await json('evidence/production-final/benchmark.json');
const timings = {};
const median = values => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
for (const observation of benchmark.result.observations) {
  const group = observation.name.replace(/-\d+$/u, '');
  (timings[group] ??= []).push(observation.details);
}
const timingSummary = Object.fromEntries(Object.entries(timings).map(([name, samples]) => [name, {
  observations: samples.length,
  baselineMs: samples.map(sample => sample.baseline.milliseconds),
  productionMs: samples.map(sample => sample.production.milliseconds),
  baselineMedianMs: median(samples.map(sample => sample.baseline.milliseconds)),
  productionMedianMs: median(samples.map(sample => sample.production.milliseconds)),
  workerReadyMs: samples.flatMap(sample => sample.production.workerStartupMs),
  equalOutputs: samples.every(sample => JSON.stringify(sample.baseline.output) === JSON.stringify(sample.production.output)),
}]));
const finalManifest = await json('evidence/production-final-freeze.json');
const firstManifest = await json('evidence/production-first-freeze.json');
const changes = finalManifest.identities.filter(entry => firstManifest.identities.find(prior => prior.path === entry.path)?.sha256 !== entry.sha256);
const baselineToFirst = firstManifest.identities.filter(entry => original.identities.find(prior => prior.path === entry.path)?.sha256 !== entry.sha256).map(entry => entry.path);
const liveDrift = [];
for (const entry of finalManifest.identities) if (hash(await readFile(resolve(entry.path))) !== entry.sha256) liveDrift.push(entry.path);
const packageResult = await json('evidence/production-final/package-corrected.json');
const consumer = packageResult.commands.find(command => command.executable?.endsWith('/node'));
assert.equal(consumer.status, 0);
const consumerResult = JSON.parse(consumer.stdout);
assert.ok(consumerResult.packageLocation.includes('/.temporary/moved-production-final-package-corrected/node_modules/virtual-bash/dist/index.js'));
const packedAssets = [];
for (const moduleName of ['client', 'matching', 'protocol', 'worker']) {
  for (const extension of ['js', 'd.ts']) {
    const path = `dist/commands/regex-execution/${moduleName}.${extension}`;
    const sourceHash = hash(await readFile(resolve(finalManifest.snapshot, path)));
    const packedHash = hash(await readFile(resolve(owned, '.temporary/moved-production-final-package-corrected/node_modules/virtual-bash', path)));
    assert.equal(sourceHash, packedHash); packedAssets.push({ path, sha256: packedHash });
  }
}
const riskClaims = await readdir(resolve(owned, 'evidence/risk-claims')).catch(() => []);
assert.equal(riskClaims.length, 0);
const result = { auditTime: new Date().toISOString(), snapshots, baselineToFirstChanges: baselineToFirst, firstToFinalChanges: changes, liveDrift, historical: { checked: original.historical.length, drift: historicalDrift, archiveSha256: original.historicalArchiveSha256 }, guardedChildCount: runs.length, observedWorkerCount: runs.reduce((total, run) => total + run.metricsCount, 0), pendingWorkerObservations: runs.reduce((total, run) => total + run.unresolvedAtObservation, 0), runs, nativeAgreement, timingSummary, package: { correctedPass: packageResult.pass, consumerResult, packedAssets, initialFalsePositive: 'evidence/audit.json packagePass and evidence/production-final/package.json pass erroneously accepted repository self-reference; retained unchanged, superseded only for package claim' }, risk: { historicalArchived: 12, previousRevision: 0, author: '0/2 as reported', independent: '0/4', reason: 'Root deferred entire six-probe tranche at confirmed lifecycle blocker' } };
await writeFile(resolve(owned, 'evidence/audit-final.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
