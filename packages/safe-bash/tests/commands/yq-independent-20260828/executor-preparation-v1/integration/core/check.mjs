import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadComponents, coreRoot, framework, hash, jsonHash, readJson } from './components.mjs';
import { assertFullPackage, continuation, runtimeEntries, translateRuntime, validateEnvelope } from './translation.mjs';

const components = await loadComponents();
const { pins, recipe, runtime, guards, types } = components;
const cases = readJson(join(coreRoot, 'SYNTHETIC.json')).controls;
const records = [];
const runRoot = join(dirname(coreRoot), `check-${randomUUID()}`);
mkdirSync(runRoot, { mode: 493 });
const fixtureRoot = join(runRoot, 'fixture');
mkdirSync(fixtureRoot, { mode: 493 });
writeFileSync(join(fixtureRoot, 'README.md'), 'synthetic read-only fixture\n', { flag: 'wx', mode: 420 });
chmodSync(join(fixtureRoot, 'README.md'), 420);
const tree = guards.inspectTree(fixtureRoot);
const syntheticHash = 'a'.repeat(64);
const fileRef = { path: '/synthetic/explicit-input.json', sha256: syntheticHash };
const envelope = { schema: 1, purpose: 'YQ_COMPOUND_AFTER_ROOT_PRESEAL', execute: true, rootApproval: 'SYNTHETIC_METADATA_ONLY_NOT_AUTHORIZATION', integrationSealSha256: syntheticHash, authorSourceCommit: pins.author.sourceCommit, consumerCandidateCommit: '1'.repeat(40), sourceBase: pins.baseline, acceptedLength: pins.acceptedLength, rootSourceCompositionAccepted: true, consumerReceipt: fileRef, admissionReceipt: fileRef, frameworkReviewReceipt: fileRef, sourceArchive: { path: '/synthetic/source.tar', sha256: pins.author.archiveSha256 }, packageArchive: { path: '/synthetic/package.tgz', sha256: pins.author.packageSha256 }, archiveSourceRoot: '/synthetic/source-273', consumerSourceRoot: '/synthetic/source-271', packageRoot: '/synthetic/package-870', outputParent: '/synthetic/output', buildProof: { classification: 'AUTHOR_ARTIFACT_BINDING_ONLY', receipt: null } };
const rootMutation = (patch, pattern) => assert.throws(() => validateEnvelope({ ...envelope, ...patch }, syntheticHash, pins), pattern);
const child = { admitted: true, integrity: true, reapProof: true, metadata: { exitCode: 0, signal: null, timedOut: false, reaped: true, overflow: false, spawnError: null } };
const result = { aggregate: 'PASS', results: [child], stop: null, activeChildren: [] };
const negativeJob = recipe.scopedTypeJobs.find((job) => job.name === 'factory-command-extra');
const compilerFiles = { cwd: '/synthetic', fixture: '/synthetic/fixture.mts', candidate: '/synthetic/package', candidateFiles: { 'yq.d.ts': {} }, tools: [], requiredDeclarations: ['/synthetic/package/yq.d.ts'] };
const compilerRaw = { status: 2, signal: null, error: null, stderr: '', stdout: '/synthetic/fixture.mts(2,1): error TS2554: Expected 0 arguments, but got 1.\n/synthetic/fixture.mts\n/synthetic/package/yq.d.ts\n' };
const controls = {
  'missing-root-authorization': () => assert.throws(() => validateEnvelope(null, syntheticHash, pins), /Missing root/),
  'wrong-purpose': () => rootMutation({ purpose: 'run-current-HEAD' }, /Missing root/),
  'wrong-author-source': () => rootMutation({ authorSourceCommit: '2'.repeat(40) }, /Author source/),
  'wrong-recipe-hash': () => rootMutation({ integrationSealSha256: 'b'.repeat(64) }, /Integration seal/),
  'wrong-package-artifact': () => rootMutation({ packageArchive: fileRef }, /full870/),
  'raw-author-git-tree-refusal': () => rootMutation({ consumerCandidateCommit: pins.author.sourceCommit }, /CONSUMER_RAW_AUTHOR_TREE_GAP/),
  'distinct-source-views': () => {
    const source = readJson(join(framework, 'consumers/SOURCE-BASE.json'));
    const author = readJson(join(guards.workspaceRoot, pins.author.manifest.path));
    const newFiles = author.files.filter((file) => file.path.startsWith('src/commands/yq/') || file.path === 'src/commands/structured/query-core.ts');
    assert.equal(Object.keys(source).length + newFiles.length, 271);
    assert.equal(author.files.filter((file) => !file.path.startsWith('tests/')).length, 273);
  },
  'runtime-tree-translation': () => {
    const before = runtime.integrity.treeSnapshot(fixtureRoot);
    assert.deepEqual(runtimeEntries(tree), before);
    assert.equal(readFileSync(join(fixtureRoot, 'README.md'), 'utf8'), 'synthetic read-only fixture\n');
    assert.deepEqual(runtime.integrity.treeSnapshot(fixtureRoot), before);
    guards.assertPackageTree(fixtureRoot, tree);
  },
  'runtime-authorization-translation': () => {
    validateEnvelope(envelope, syntheticHash, pins);
    const translated = translateRuntime({ root: { ...envelope, sourceAdditions: { 'src/commands/yq/fake.ts': {} }, consumerBuildReceipt: fileRef }, pins, recipe, runtimeRoot: components.runtimeRoot, sourceTree: tree, packageTree: tree, entry: { path: 'dist/commands/yq/index.js', sha256: syntheticHash }, metadataRoot: '/synthetic/metadata', evidenceParent: '/synthetic/capture', frozenRepository: guards.workspaceRoot, node: { path: '/synthetic/node', sha256: syntheticHash, mode: 493 } });
    assert.equal(translated.authorization.candidateCommit, pins.author.sourceCommit);
    assert.equal(translated.provenance.consumerCandidateCommit, envelope.consumerCandidateCommit);
    assert.equal(translated.authorization.source.treeSha256, jsonHash(runtimeEntries(tree)));
    assert.equal(translated.authorization.source.provenance.sha256, hash(translated.provenanceBytes));
    assert.equal(translated.authorization.selection.ids.length, 132);
    assert.equal(translated.authorization.selection.jobsSha256, recipe.jobsSha256);
  },
  'missing-baseline-readme': () => {
    const baseline = readJson(join(framework, 'consumers/BASELINE-PACKAGE.json'));
    delete baseline['README.md'];
    assert.throws(() => guards.expectedPackage({}, baseline, readJson(join(framework, 'consumers/SELECTED.json')).readme), /README_IDENTITY/);
  },
  'package-count-not-870': () => {
    const files = Object.fromEntries(Array.from({ length: 869 }, (_, index) => [`fixture-${index}`, {}]));
    assert.throws(() => assertFullPackage(files, {}), /870 files/);
  },
  'source-addition-mismatch': () => assert.throws(() => guards.assertSourceMap({ 'src/commands/yq/fake.ts': { sha256: syntheticHash } }, {}), /SOURCE_BINDING/),
  'negative-type-diagnostic-match': () => assert.equal(types.classifyCompilerOutcome(negativeJob, compilerRaw, compilerFiles).classification, 'ACCEPTED_COMPILE_REJECTION'),
  'negative-type-wrong-diagnostic': () => assert.throws(() => types.classifyCompilerOutcome(negativeJob, { ...compilerRaw, stdout: compilerRaw.stdout.replace('TS2554', 'TS2307') }, compilerFiles), /COMPILER_DIAGNOSTICS/),
  'nonzero-worker-even-pass-receipt': () => {
    assert.throws(() => types.assertWorkerExit({ status: 7, signal: null, error: null, stdout: 'PASS' }), /WORKER_EXIT/);
    assert.equal(continuation({ ...result, results: [{ ...child, metadata: { ...child.metadata, exitCode: 7 } }] }).aggregate, 'FAIL');
  },
  'timeout-always-fail': () => assert.equal(continuation({ ...result, results: [{ ...child, metadata: { ...child.metadata, timedOut: true } }] }).aggregate, 'FAIL'),
  'timeout-continue-only-intact-and-reaped': () => {
    assert.equal(continuation({ ...result, aggregate: 'FAIL', results: [{ ...child, metadata: { ...child.metadata, timedOut: true } }] }).admitIndependent, true);
    assert.equal(continuation(result, false).admitIndependent, false);
  },
  'integrity-failure-stops': () => assert.equal(continuation({ ...result, results: [{ ...child, integrity: false }] }).admitIndependent, false),
  'reap-failure-stops': () => assert.equal(continuation({ ...result, results: [{ ...child, reapProof: false }] }).admitIndependent, false),
  'all-194-routes': () => {
    const inventory = readJson(join(components.runtimeRoot, 'inventory.json'));
    assert.deepEqual(recipe.routes.map((row) => row.id), inventory.rows.map((row) => row.id));
    assert.equal(new Set(recipe.routes.map((row) => row.id)).size, 194);
    assert.deepEqual(recipe.roleCounts, inventory.roleCounts);
    assert.equal(recipe.missingBindings.records, 80);
    assert.equal(recipe.scopedTypeJobs.length, 6);
  },
  '149-jobs-no-rescoring': () => {
    const data = runtime.fixtures.loadData(components.runtimeRoot, guards.workspaceRoot);
    const jobs = runtime.fixtures.materializeJobs(data, recipe.preparedIds);
    assert.equal(jobs.length, 149);
    assert.equal(jsonHash(jobs), recipe.jobsSha256);
    assert.deepEqual(recipe.semantic, { eligibleIds: 111, completeExplicitProjectionIds: 94, partialIds: 17, executed: 0, passes: 0, denominatorRule: 'Two environments share the same original IDs; no sum. Admission/type/source/package/data/controls are excluded.' });
    assert.equal(recipe.stages.reduce((sum, stage) => sum + stage.children, 0), 301);
  },
  'public-gap-retained': () => assert.throws(() => guards.assertPublicAdmission(), /PUBLIC_EXPORT_GAP/),
};
assert.deepEqual(Object.keys(controls), cases);
for (const id of cases) {
  try { controls[id](); records.push({ id, outcome: 'PASS' }); }
  catch (error) { records.push({ id, outcome: 'FAIL', error: String(error) }); }
}
components.verify();
guards.assertPackageTree(fixtureRoot, tree);
const output = { schema: 1, classification: 'SYNTHETIC_DATA_COMPOSITION_ONLY', records, aggregate: records.every((record) => record.outcome === 'PASS') ? 'PASS' : 'FAIL', activeChildren: [], childExecutions: 0, productImports: 0, productExecutions: 0, builds: 0, typeCompiles: 0, independentFrameworkAcceptance: false, sourceFixtureBeforeAfterSha256: jsonHash(runtimeEntries(tree)) };
runtime.integrity.atomicJson(join(runRoot, 'RESULT.json'), output);
console.log(JSON.stringify({ aggregate: output.aggregate, controls: records.length, evidence: join(runRoot, 'RESULT.json'), productImports: 0, activeChildren: [] }));
process.exitCode = output.aggregate === 'PASS' ? 0 : 1;
