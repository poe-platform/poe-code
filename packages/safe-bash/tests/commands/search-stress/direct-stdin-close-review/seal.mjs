import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const root = resolve(own, '../../../..');
const label = process.argv[2] ?? 'baseline-02';
if (!/^baseline-[0-9]{2}$/.test(label)) throw new Error('baseline-NN label required');
const report = join(own, 'runs', label);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const preparation = read(join(report, 'preparation.json'));
const summary = read(join(report, 'summary.json'));
const packageRoot = join(preparation.move.to, 'node_modules/virtual-bash');
const expected = new Map(preparation.packedInventory.map(entry => [entry.path, entry.sha256]));
const sourceAfter = preparation.sourceBefore.map(entry => {
  const actual = hash(readFileSync(join(preparation.move.quarantine, entry.path)));
  assert.equal(actual, entry.sha256, `source/config drift: ${entry.path}`);
  return { path: entry.path, sha256: actual };
});
for (const entry of preparation.packedInventory) {
  assert.equal(hash(readFileSync(join(packageRoot, entry.path))), entry.sha256, `packed asset drift: ${entry.path}`);
}
assert.equal(hash(readFileSync(join(report, 'virtual-bash-baseline.tgz'))), preparation.tarball.sha256);
for (const entry of preparation.frozen) assert.equal(hash(readFileSync(join(own, entry.path))), entry.sha256);
assert.equal(hash(readFileSync(join(preparation.move.to, 'cases.mjs'))), preparation.fixture.preparedSha256);
assert.equal(hash(readFileSync(join(report, 'prepared-cases.mjs.data'))), preparation.fixture.preparedSha256);
assert.equal(hash(readFileSync(join(preparation.move.to, 'consumer.mjs'))), preparation.frozen.find(entry => entry.path === 'consumer.mjs').sha256);
const toolPackages = [['typescript', preparation.tools.compilerPackage], ['@types/node', preparation.tools.nodeTypes],
  ['undici-types', preparation.tools.undiciTypes]];
for (const [directory, files] of toolPackages) for (const entry of files) {
  assert.equal(hash(readFileSync(join(root, 'node_modules', directory, entry.path))), entry.sha256, `build tool drift: ${directory}/${entry.path}`);
}
const checks = [];
let workerCount = 0;
let workerCases = 0;
let assertionCount = 0;
let failedAssertions = 0;
for (const row of summary.results) {
  const run = read(join(report, `${row.name}.json`));
  const outcome = run.outcome;
  assert.equal(run.naturalExit, true, row.name);
  assert.equal(outcome.authentication.packageModulesOnly, true);
  assert.equal(outcome.authentication.workerAssetsMoved, true);
  assert.ok(outcome.authentication.modules.length > 0);
  for (const loaded of [...outcome.authentication.modules, ...outcome.authentication.workerEvents]) {
    const path = relative(packageRoot, fileURLToPath(loaded.url));
    assert.equal(loaded.sha256, expected.get(path), `actual load authentication: ${path}`);
  }
  for (const worker of outcome.authentication.workerEvents) {
    assert.equal(worker.exited, true);
    assert.deepEqual(worker.options, { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
  }
  const zeroWorkerControl = ['already-aborted-zero-active-workers', 'invalid-zero-maxworkers'].includes(row.name);
  assert.equal(outcome.authentication.workerEvents.length > 0, !zeroWorkerControl, row.name);
  if (!zeroWorkerControl) workerCases++;
  workerCount += outcome.authentication.workerEvents.length;
  assertionCount += outcome.checks.length;
  failedAssertions += outcome.checks.filter(check => !check.pass).length;
  assert.equal(outcome.checks.find(check => check.identity === 'zero-live-workers-after-cleanup').actual, 0);
  for (const state of outcome.observations.afterFixtureCleanup) assert.equal(state.closed ?? state.finalized, true);
  let pidExists = false;
  try { process.kill(run.pid, 0); pidExists = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
  assert.equal(pidExists, false, `owned child PID still exists: ${run.pid}`);
  checks.push({ case: row.name, modules: outcome.authentication.modules.length, workers: outcome.authentication.workerEvents.length,
    loadedHashesMatchPackedManifest: true, workerExited: true, childPid: run.pid, childAbsent: true,
    fixtureResourcesClosed: true, failures: row.failures });
}
const workerGraph = [];
const seen = new Set();
function visit(path) {
  if (seen.has(path)) return;
  seen.add(path);
  const bytes = readFileSync(join(packageRoot, path));
  const text = bytes.toString('utf8');
  assert.equal(/\bimport\s*\(/u.test(text), false, `unexpected dynamic worker import: ${path}`);
  const imports = [...text.matchAll(/\bfrom\s+["']([^"']+)["']/gu)].map(match => match[1]);
  workerGraph.push({ path, sha256: hash(bytes), imports });
  for (const specifier of imports) if (specifier.startsWith('.')) visit(relative(packageRoot, resolve(packageRoot, dirname(path), specifier)));
}
visit('dist/commands/regex-execution/worker.js');
const historicalTimeout = read(join(own, 'runs/baseline-01/shared-executor-sibling-isolation.json'));
let historicalPidExists = false;
try { process.kill(historicalTimeout.pid, 0); historicalPidExists = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
assert.equal(historicalPidExists, false);
const git = argv => {
  const result = spawnSync('git', argv, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0);
  return result.stdout.trim();
};
const data = { baseline: preparation.baseline, freezeCommit: preparation.freezeCommit,
  preparationFixCommit: git(['log', '-1', '--format=%H', '--', relative(root, join(own, 'prepare-fixture.mjs'))]),
  preparationV2Commit: git(['log', '-1', '--format=%H', '--', relative(root, join(own, 'prepare-fixture-v2.mjs'))]),
  observedHeadNotCandidate: git(['rev-parse', 'HEAD']), candidate: null, candidateSourceAfter: 'not routed or inspected',
  totalCases: summary.total, passed: summary.passed, failed: summary.failed, assertionCount, failedAssertions,
  workerCount, workerCases, checks, workerStaticGraph: workerGraph, sourceAfter,
  sourceAndConfigUnchanged: true, packedAssetsUnchanged: true, toolsUnchanged: true, originalFrozenFilesUnchanged: true,
  preparedFixture: preparation.fixture, historicalTimeout: { pid: historicalTimeout.pid, status: historicalTimeout.status,
    signal: historicalTimeout.signal, childAbsent: true, classification: 'retained preparation defect; not contract evidence' },
  scope: 'Bounded baseline only; not candidate acceptance, whole-gate acceptance or opaque hard-preemption proof',
  sealedAt: new Date().toISOString() };
writeFileSync(join(report, 'seal.json'), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ totalCases: summary.total, passed: summary.passed, failed: summary.failed,
  assertionCount, failedAssertions, workerCount, workerCases, workerStaticGraph: workerGraph }, null, 2));
