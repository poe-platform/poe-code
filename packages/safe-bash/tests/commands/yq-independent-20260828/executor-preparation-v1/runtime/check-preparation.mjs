import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeChildren, runJobs } from './recipe/host.mjs';
import { atomicJson, jsonHash, readJson, regularBytes, sha256, treeSnapshot } from './recipe/integrity.mjs';

const runtime = dirname(fileURLToPath(import.meta.url));
const repository = realpathSync(resolve(runtime, '../../../../..'));
const prefix = 'tests/commands/yq-independent-20260828/executor-preparation-v1/runtime';
const preseal = '0f138190073cb5419aa86c63e0a10075fe67f88f';
const [sourceCommit] = process.argv.slice(2);
assert(/^[a-f0-9]{40}$/.test(sourceCommit ?? ''), 'Supply committed harness source seal before controls');
const readCommit = (revision, path) => execFileSync('git', ['show', `${revision}:${path}`], { cwd: repository, timeout: 5000, maxBuffer: 2097152 });
const files = ['PROTOCOL.md', 'controls.json', 'synthetic-child.mjs'];
const guards = files.map((path) => {
  const bytes = readCommit(preseal, `${prefix}/${path}`);
  assert.deepEqual(regularBytes(join(runtime, path)), bytes, `Presealed fixture changed: ${path}`);
  assert.equal(lstatSync(join(runtime, path)).mode & 0o7777, 0o644, 'Presealed fixture mode');
  return { kind: 'file', path: join(runtime, path), sha256: sha256(bytes), mode: 0o644 };
});
const recipeRoot = join(runtime, 'recipe');
const recipeEntries = treeSnapshot(recipeRoot);
const committedNames = execFileSync('git', ['ls-tree', '-r', '--name-only', sourceCommit, '--', `${prefix}/recipe`], { cwd: repository, timeout: 5000, maxBuffer: 2097152 }).toString().trim().split('\n');
assert.deepEqual(recipeEntries.filter((entry) => entry.kind === 'file').map((entry) => `${prefix}/recipe/${entry.path}`).sort(), committedNames.sort(), 'Exact committed harness file membership');
for (const entry of recipeEntries.filter((entry) => entry.kind === 'file')) assert.deepEqual(regularBytes(join(recipeRoot, entry.path)), readCommit(sourceCommit, `${prefix}/recipe/${entry.path}`));
for (const name of ['check-preparation.mjs', 'check-static.mjs']) assert.deepEqual(regularBytes(join(runtime, name)), readCommit(sourceCommit, `${prefix}/${name}`));
guards.push({ kind: 'tree', path: recipeRoot, sha256: jsonHash(recipeEntries) });
const controls = readJson(join(runtime, 'controls.json'));
const work = join(runtime, `synthetic-work-${randomUUID()}`);
mkdirSync(work, { mode: 0o700 });
const evidenceParent = join(runtime, 'evidence');
mkdirSync(evidenceParent, { recursive: true, mode: 0o700 });
const results = [];
let failed = false;
for (const control of controls.controls) {
  const fixtureRoot = join(work, control.id);
  mkdirSync(fixtureRoot, { mode: 0o700 });
  writeFileSync(join(fixtureRoot, 'fixture'), 'original\n', { flag: 'wx', mode: 0o644 });
  chmodSync(join(fixtureRoot, 'fixture'), 0o644);
  const fixtureGuard = { kind: 'tree', path: fixtureRoot, sha256: jsonHash(treeSnapshot(fixtureRoot)) };
  const jobs = control.children.map((mode, index) => ({ id: `${control.id}-${index}`, mode, cwd: fixtureRoot, args: [join(runtime, 'synthetic-child.mjs'), mode, `${control.id}-${index}`, fixtureRoot] }));
  try {
    const result = await runJobs({
      executable: process.execPath, jobs, guards: [...guards, fixtureGuard], evidenceParent, bounds: controls.bounds,
      withholdReapProof: control.withholdReapProof ?? false,
      assertReceipt(receipt, job, evidence) {
        assert(readFileSync(join(evidence, 'stdout.bin')).length > 0, 'Raw capture missing before assertion');
        if (job.mode === 'assert-fail') {
          assert(readFileSync(join(evidence, 'stdout.bin'), 'utf8').includes(control.rawWitness));
          assert.equal(receipt.observed, receipt.expected, 'Deliberate post-capture assertion failure');
        }
        assert.equal(receipt.outcome, 'PASS');
      },
    });
    assert.equal(result.aggregate, control.aggregate);
    assert.equal(result.admitted, control.admitted);
    assert.equal(result.stop, control.stop ?? null);
    assert(result.results.filter((entry) => entry.admitted).every((entry) => entry.metadata.reaped), 'Actual known children must be reaped, including simulated uncertainty');
    if (control.timedOut) assert.equal(result.results[0].metadata.timedOut, true);
    if (control.admitted === 2) assert.equal(result.results[1].outcome, 'PASS', 'Independent second job did not complete');
    assert.deepEqual(activeChildren(), []);
    results.push({ id: control.id, outcome: 'PASS', aggregateObserved: result.aggregate, admitted: result.admitted, evidence: result.evidence, activeChildren: result.activeChildren });
  } catch (error) {
    failed = true;
    results.push({ id: control.id, outcome: 'FAIL', error: String(error), activeChildren: activeChildren() });
    if (activeChildren().length) break;
  }
}
const receipt = { schemaVersion: 1, classification: 'SYNTHETIC_ONLY_NOT_YQ_SEMANTIC_RESULTS', preseal, sourceCommit, node: { path: process.execPath, version: process.version, sha256: sha256(regularBytes(process.execPath, 134217728)) }, results, activeChildren: activeChildren(), aggregate: failed || results.length !== controls.controls.length ? 'FAIL' : 'PASS', productExecutions: 0, nativeOracles: 0, work };
const summaryPath = join(evidenceParent, `synthetic-summary-${randomUUID()}.json`);
atomicJson(summaryPath, receipt);
console.log(JSON.stringify({ summaryPath, aggregate: receipt.aggregate, controls: results.length, activeChildren: activeChildren() }));
process.exitCode = receipt.aggregate === 'PASS' ? 0 : 1;
