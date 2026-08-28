import assert from 'node:assert/strict';
import { basename, dirname, join } from 'node:path';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { bind } from './binding.mjs';
import { coreRoot, framework, repository } from './components.mjs';
import { continuation, translateRuntime } from './translation.mjs';

const [rootPath, rootHash, sealPath, sealHash] = process.argv.slice(2);
const bound = await bind(rootPath, rootHash, sealPath, sealHash);
const { runtime, guards, recipe } = bound;
const packageBytes = Object.values(bound.packageTree.files).reduce((sum, file) => sum + file.bytes, 0);
assert(packageBytes * 151 <= 1073741824, 'Fresh materialization storage bound: 1 GiB');
const runRoot = runtime.integrity.createEvidence(bound.root.outputParent, bound.guardList);
const captures = join(runRoot, 'captures');
const moves = join(runRoot, 'moves');
const metadata = join(runRoot, 'metadata');
for (const directory of [captures, moves, metadata]) mkdirSync(directory, { mode: 493 });
const start = Date.now();
const results = [];
const completedMoves = [];
const moveEntries = new Set();
let aggregate = 'PASS';
let stopped = null;
let runtimeBinding;

function proveMoves() {
  assert.deepEqual(readdirSync(moves).sort(), [...moveEntries].sort(), 'Moved-parent membership, including added entries');
  for (const movement of completedMoves) {
    assert.equal(movement.original, bound.root.packageRoot);
    assert(!existsSync(movement.staging));
    const stat = lstatSync(movement.root);
    assert.equal(stat.ino, movement.directoryIdentity.ino);
    assert.equal(stat.dev, movement.directoryIdentity.dev);
    guards.assertPackageTree(movement.root, bound.packageTree);
    assert.deepEqual(readdirSync(dirname(movement.staging)), []);
  }
}

function combinedGuards() {
  const entries = [...bound.guardList, ...(runtimeBinding?.guards ?? [])];
  const unique = new Map();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.path}`;
    if (unique.has(key)) assert.equal(unique.get(key).sha256, entry.sha256, 'Conflicting scope bindings');
    unique.set(key, entry);
  }
  assert(unique.size <= 40, 'Sealed runtime guard-count bound; do not drop a guard');
  return [...unique.values()];
}

async function one(mode, job, callback) {
  if (stopped) return false;
  if (Date.now() - start > recipe.bounds.totalAdmissionMs || results.length >= recipe.bounds.maximumChildren) { stopped = 'total-admission-bound'; aggregate = 'FAIL'; return false; }
  try { bound.verify(); proveMoves(); runtime.integrity.verifyGuards(combinedGuards()); }
  catch (error) { stopped = `integrity-before: ${String(error)}`; aggregate = 'FAIL'; return false; }
  const destination = join(moves, `${mode}-${job.id}`);
  const typeEvidence = join(runRoot, 'scoped-types');
  const args = mode === 'original-runtime'
    ? [join(bound.runtimeRoot, 'child.mjs'), join(metadata, 'runtime-authorization.json'), runtimeBinding.authorizationHash, join(repository, bound.pins.runtime.seal.path), bound.pins.runtime.seal.sha256, job.id]
    : [join(coreRoot, 'worker.mjs'), rootPath, rootHash, sealPath, sealHash, mode, job.id, destination, typeEvidence];
  let receipt = null;
  const result = await runtime.host.runJobs({
    executable: process.execPath, jobs: [{ ...job, cwd: bound.root.packageRoot, args }], guards: combinedGuards(), evidenceParent: captures, bounds: recipe.bounds,
    assertReceipt(value, task, folder) {
      receipt = value;
      if (mode !== 'original-runtime') { assert.equal(value.rootHash, rootHash); assert.equal(value.sealHash, sealHash); assert.equal(value.mode, mode); }
      callback(value, task, folder);
    },
  });
  for (const child of result.results.filter((entry) => entry.admitted)) {
    try { bound.types.assertWorkerExit({ status: child.metadata.exitCode, signal: child.metadata.signal, error: child.metadata.spawnError }); }
    catch { aggregate = 'FAIL'; }
  }
  let movementIntegrity = true;
  try {
    if (['moved-runtime', 'loaded-code', 'types'].includes(mode)) {
      if (!receipt) {
        const receiptFile = join(result.evidence, job.id, 'receipt.json');
        if (existsSync(receiptFile)) receipt = JSON.parse(readFileSync(receiptFile));
      }
      const movement = receipt?.movement;
      assert(movement && movement.root === destination && movement.original === bound.root.packageRoot, 'Materialization receipt missing/unbound');
      const container = dirname(movement.staging);
      assert.equal(dirname(container), moves);
      assert(basename(container).startsWith('.yq-materialization-'));
      assert.equal(basename(movement.staging), 'stage');
      assert(!moveEntries.has(basename(destination)) && !moveEntries.has(basename(container)));
      moveEntries.add(basename(destination));
      moveEntries.add(basename(container));
      completedMoves.push(movement);
    }
    proveMoves();
    bound.verify();
    runtime.integrity.verifyGuards(combinedGuards());
  } catch (error) { movementIntegrity = false; stopped = `integrity-after: ${String(error)}`; }
  const gate = continuation(result, movementIntegrity);
  if (gate.aggregate !== 'PASS') aggregate = 'FAIL';
  if (!gate.admitIndependent) stopped ??= result.stop ?? 'integrity-or-reap-unproved';
  results.push({ mode, jobId: job.id, aggregate: gate.aggregate, evidence: result.evidence, admitted: result.admitted, movementIntegrity });
  return gate.aggregate === 'PASS';
}

try {
  const admitted = await one('source-admission', { id: 'source-admission' }, (receipt) => {
    assert.equal(receipt.outcome, 'CAPTURED');
    assert.equal(receipt.sourceMapSha256, bound.sourceMapSha256);
    assert.equal(receipt.packageMapSha256, bound.packageMapSha256);
    assert.equal(receipt.sourceFiles, 271);
    assert.equal(receipt.packageFiles, 870);
  });
  if (!admitted) stopped ??= 'source-prerequisite-failure';
  if (!stopped) {
    const translated = translateRuntime({ root: { ...bound.root, consumerBuildReceipt: bound.receipt.buildReceipt, sourceAdditions: bound.receipt.sourceAdditions }, pins: bound.pins, recipe, runtimeRoot: bound.runtimeRoot, sourceTree: bound.sourceTree, packageTree: bound.packageTree, entry: { path: bound.receipt.entries.yq, sha256: bound.pins.author.entrySha256 }, metadataRoot: metadata, evidenceParent: captures, frozenRepository: repository, node: bound.node });
    runtime.integrity.atomicWrite(translated.provenancePath, translated.provenanceBytes);
    chmodSync(translated.provenancePath, 420);
    const authorizationPath = join(metadata, 'runtime-authorization.json');
    runtime.integrity.atomicJson(authorizationPath, translated.authorization);
    chmodSync(authorizationPath, 420);
    const authorizationHash = bound.hash(readFileSync(authorizationPath));
    runtimeBinding = { ...runtime.authorization.authorize({ authorizationPath, authorizationSha256: authorizationHash, sealPath: join(repository, bound.pins.runtime.seal.path), sealSha256: bound.pins.runtime.seal.sha256 }), authorizationHash };
    assert.equal(runtimeBinding.jobs.length, 149);
    for (const mode of ['original-runtime', 'moved-runtime']) {
      for (const job of runtimeBinding.jobs) {
        if (stopped) break;
        await one(mode, job, (receipt, task, folder) => {
          if (mode === 'original-runtime') {
            assert.equal(receipt.binding.authorizationSha256, authorizationHash);
            assert.equal(receipt.binding.candidateCommit, bound.pins.author.sourceCommit);
            assert.equal(receipt.binding.jobsSha256, recipe.jobsSha256);
          } else assert.equal(receipt.proofRole, 'DIRECT_MATERIALIZED_MODULE_NOT_PUBLIC_PACKAGE');
          runtime['assert-capture'].assertCapture(receipt, task, folder, runtimeBinding.data.sources.get('final').diagnostics.catalogue);
        });
      }
    }
    if (!stopped) await one('loaded-code', { id: 'loaded-code' }, (receipt) => {
      assert.equal(receipt.outcome, 'CAPTURED');
      assert.equal(receipt.publicStatus, 'PUBLIC_EXPORT_GAP');
      assert.deepEqual(receipt.factories, ['createYqCommand', 'createYqCommands', 'yqCommands']);
      assert(receipt.imported.length > 0);
    });
    if (!stopped) await one('types', { id: 'types' }, (receipt) => {
      assert.equal(receipt.outcome, 'CAPTURED');
      assert.equal(receipt.facts.length, recipe.scopedTypeJobs.length);
      assert.deepEqual(receipt.facts.map((fact) => fact.name), recipe.scopedTypeJobs.map((job) => job.name));
    });
  }
} catch (error) { aggregate = 'FAIL'; stopped ??= `binding-or-execution: ${String(error)}`; }
if (stopped || results.length !== recipe.bounds.maximumChildren || runtime.host.activeChildren().length) aggregate = 'FAIL';
const summary = { schema: 1, aggregate, stopped, rootHash, sealHash, results, activeChildren: runtime.host.activeChildren(), uniqueOriginalIds: 194, semanticEligibility: { eligibleIds: 111, completeExplicitProjectionIds: 94, partialIds: 17 }, runtimeChildAdmissions: results.filter((result) => ['original-runtime', 'moved-runtime'].includes(result.mode)).reduce((sum, result) => sum + result.admitted, 0), missingBindings: recipe.missingBindings, publicStatus: 'PUBLIC_EXPORT_GAP', buildProofClassification: bound.root.buildProof.classification, semanticPassRate: 'Not computed: two environments are not additive; 80 original binding gaps remain.', productAcceptance: false };
runtime.integrity.atomicJson(join(runRoot, 'COMPOUND-RESULT.json'), summary);
console.log(JSON.stringify({ aggregate, stopped, evidence: runRoot, children: results.length, activeChildren: summary.activeChildren }));
process.exitCode = aggregate === 'PASS' ? 0 : 1;
