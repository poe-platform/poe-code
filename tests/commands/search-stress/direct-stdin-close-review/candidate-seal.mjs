import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const root = resolve(own, '../../../..');
const report = join(own, 'runs/candidate-01');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (name, value) => writeFileSync(join(report, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const binding = read(join(report, 'execution-binding.json'));
const replay = read(join(report, 'replay-started.json'));
const work = '/tmp/rg-direct-close-candidate-independent-01';
const packageRootLogical = join(binding.move.to, 'node_modules/virtual-bash');
const packageRoot = realpathSync(packageRootLogical);
const expected = new Map(binding.packedInventory.map(entry => [entry.path, entry.sha256]));
function inventory(directory) {
  const entries = [];
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = join(path, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile()) { const bytes = readFileSync(filename); entries.push({ path: relative(directory, filename), bytes: bytes.length, sha256: hash(bytes) }); }
    }
  }
  visit(directory);
  return entries;
}
function absent(pid) {
  assert.ok(Number.isInteger(pid) && pid > 0);
  try { process.kill(pid, 0); return false; } catch (error) { if (error.code !== 'ESRCH') throw error; return true; }
}
const retainedBefore = inventory(report);
assert.equal(hash(readFileSync(join(report, 'execution-binding.json'))), replay.bindingSha256);
for (const path of [binding.runner.path, relative(root, join(report, 'execution-binding.json'))]) {
  const result = spawnSync('git', ['show', `${replay.freezeCommit}:${path}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout, readFileSync(join(root, path)));
  assert.equal(absent(result.pid), true);
}
assert.equal(hash(readFileSync(join(root, binding.runner.path))), binding.runner.sha256);
assert.equal(process.version, binding.tools.node.version);
assert.equal(process.execPath, binding.tools.node.path);
for (const name of ['node', 'compiler', 'npm', 'tar']) assert.equal(hash(readFileSync(binding.tools[name].path)), binding.tools[name].sha256);
for (const [directory, entries] of [['typescript', binding.tools.compilerPackage], ['@types/node', binding.tools.nodeTypes], ['undici-types', binding.tools.undiciTypes]]) {
  assert.deepEqual(inventory(join(root, 'node_modules', directory)), entries);
}
for (const entry of binding.historical) assert.equal(hash(readFileSync(join(own, entry.path))), entry.sha256);
const sourceAfter = binding.sourceBefore.map(entry => {
  const sha256 = hash(readFileSync(join(binding.move.quarantine, entry.path)));
  assert.equal(sha256, entry.sha256);
  return { path: entry.path, sha256 };
});
assert.deepEqual(inventory(packageRoot), binding.packedInventory);
assert.equal(hash(readFileSync(join(report, 'virtual-bash-candidate.tgz'))), binding.tarball.sha256);
assert.equal(hash(readFileSync(join(report, 'prepared-cases.mjs.data'))), binding.fixture.preparedSha256);
assert.equal(hash(readFileSync(join(binding.move.to, 'cases.mjs'))), binding.fixture.preparedSha256);
assert.equal(hash(readFileSync(join(binding.move.to, 'consumer.mjs'))), binding.consumer.sha256);
const transitions = [];
const checks = [];
const results = [];
let assertionCount = 0;
let failedAssertions = 0;
let workerCount = 0;
for (const name of binding.caseNames) {
  const run = read(join(report, `${name}.json`));
  const outcome = run.outcome;
  assert.deepEqual(JSON.parse(readFileSync(join(report, `${name}.stdout.data`))), outcome);
  assert.equal(readFileSync(join(report, `${name}.stderr.data`)).length, 0);
  assert.equal(run.naturalExit, true, name);
  assert.equal(outcome.authentication.packageModulesOnly, true);
  assert.equal(outcome.authentication.workerAssetsMoved, true);
  assert.equal(outcome.authentication.expectedPackagePrefix, pathToFileURL(packageRoot + '/').href);
  assert.equal(outcome.authentication.resolved, pathToFileURL(join(packageRoot, 'dist/index.js')).href);
  assert.ok(outcome.authentication.modules.length > 0);
  assert.deepEqual(run.argv, [process.execPath, ...binding.execution.execArgv, join(binding.move.to, 'consumer.mjs'), name]);
  assert.deepEqual(outcome.authentication.execArgv, binding.execution.execArgv);
  assert.equal(outcome.authentication.node, binding.tools.node.version);
  const loadedAfter = [...outcome.authentication.modules, ...outcome.authentication.workerEvents].map(loaded => {
    const path = relative(packageRoot, fileURLToPath(loaded.url));
    assert.equal(loaded.sha256, expected.get(path), `actual load authentication: ${path}`);
    const sha256 = hash(readFileSync(join(packageRoot, path)));
    assert.equal(sha256, loaded.sha256);
    return { path, before: expected.get(path), loaded: loaded.sha256, after: sha256 };
  });
  for (const worker of outcome.authentication.workerEvents) {
    assert.equal(worker.exited, true);
    assert.deepEqual(worker.options, { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
  }
  const zeroWorkerControl = ['already-aborted-zero-active-workers', 'invalid-zero-maxworkers'].includes(name);
  assert.equal(outcome.authentication.workerEvents.length, zeroWorkerControl ? 0 : 1);
  workerCount += outcome.authentication.workerEvents.length;
  assertionCount += outcome.checks.length;
  failedAssertions += outcome.checks.filter(check => !check.pass).length;
  assert.equal(outcome.checks.find(check => check.identity === 'zero-live-workers-after-cleanup').actual, 0);
  for (const state of outcome.observations.afterFixtureCleanup) assert.equal(state.closed ?? state.finalized, true);
  assert.equal(absent(run.pid), true);
  const prior = read(join(own, 'runs/baseline-03', `${name}.json`));
  assert.deepEqual(outcome.checks.map(check => [check.identity, check.expected]), prior.outcome.checks.map(check => [check.identity, check.expected]));
  transitions.push({ name, before: prior.pass, after: run.pass, checks: outcome.checks.map((check, index) => ({ identity: check.identity,
    before: prior.outcome.checks[index].pass, after: check.pass, beforeActual: prior.outcome.checks[index].actual,
    afterActual: check.actual, expected: check.expected })) });
  checks.push({ name, childPid: run.pid, childAbsent: true, fixtureResourcesClosed: true, workers: outcome.authentication.workerEvents.length, loadedAfter });
  results.push({ name, pass: run.pass, status: run.status, naturalExit: run.naturalExit, failures: run.failures });
}
const workerGraph = [];
const seen = new Set();
function visit(path) {
  if (seen.has(path)) return;
  seen.add(path);
  const bytes = readFileSync(join(packageRoot, path));
  const text = bytes.toString('utf8');
  assert.equal(/\bimport\s*\(/u.test(text), false);
  const imports = [...text.matchAll(/\bfrom\s+["']([^"']+)["']/gu)].map(match => match[1]);
  workerGraph.push({ path, sha256: hash(bytes), imports });
  for (const specifier of imports) if (specifier.startsWith('.')) visit(relative(packageRoot, resolve(packageRoot, dirname(path), specifier)));
}
visit('dist/commands/regex-execution/worker.js');
assert.deepEqual(inventory(report), retainedBefore);
write('retained-preseal.json', retainedBefore);
write('transitions.json', transitions);
const passed = results.filter(run => run.pass).length;
write('seal.json', { candidate: binding.candidate, baseline: binding.baseline, freezeCommit: replay.freezeCommit,
  sealer: { path: relative(root, fileURLToPath(import.meta.url)), sha256: hash(readFileSync(fileURLToPath(import.meta.url))) },
  postprocessingCorrection: { originalErrorPreserved: 'replay-error.json', packageRootLogical, packageRoot,
    correction: 'Resolve the existing macOS /tmp -> /private/tmp alias before manifest-relative path comparison; no replay or assertion changes' },
  total: results.length, passed, failed: results.length - passed, assertionCount, failedAssertions, workerCount, zeroWorkerControls: 2,
  results, checks, workerGraph, sourceAfter, sourceAndConfigUnchanged: true, packedAssetsUnchanged: true, toolsUnchanged: true,
  historicalEvidenceUnchanged: true, preparedFixtureUnchanged: true, allChildrenNaturalExit: true, sealedAt: new Date().toISOString(),
  scope: 'Exact unchanged prepared-v2 cohort only; not whole-gate acceptance, opaque hard preemption or author-suite acceptance' });
const commandPids = [...read(join(report, 'prepare-commands.json')), ...read(join(report, 'replay-commands.json'))].map(entry => ({ pid: entry.pid, absent: absent(entry.pid) }));
assert.ok(commandPids.every(entry => entry.absent));
assert.equal(dirname(binding.move.to), work);
assert.equal(dirname(binding.move.quarantine), work);
rmSync(work, { recursive: true });
assert.equal(existsSync(work), false);
write('cleanup.json', { commandPids, childPids: checks.map(check => ({ pid: check.childPid, absent: absent(check.childPid) })), liveWorkers: 0,
  scratch: work, scratchAbsent: true, cleanedAt: new Date().toISOString() });
console.log(JSON.stringify({ total: results.length, passed, assertionCount, failedAssertions, workerCount, scratchAbsent: true }));
if (passed !== results.length) process.exitCode = 1;
