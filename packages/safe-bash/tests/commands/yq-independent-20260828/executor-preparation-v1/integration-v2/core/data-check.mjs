import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bind } from './binding.mjs';
import { coreRoot, hash, jsonHash, readBound, readJson, repository, verifyIntegration } from './components.mjs';
import { assertFullPackage, continuation, directoryMap, runtimeEntries, validateEnvelope } from './translation.mjs';

const [sealPath, sealHash] = process.argv.slice(2);
verifyIntegration(sealPath, sealHash);
const pins = readJson(join(coreRoot, 'COMPONENTS.json'));
const recipe = readJson(join(coreRoot, 'RECIPE.json'));
const schedule = readJson(join(coreRoot, 'DATA-CONTROLS.json'));
for (const binding of [pins.consumers.seal, pins.consumers.verifier, pins.author.manifest, ...['fullReceipt', 'buildReceipt', 'admissionReceipt'].map((name) => pins.packet[name])]) readBound(join(repository, binding.path), binding.sha256);
const verifier = await import(pathToFileURL(join(repository, pins.consumers.verifier.path)).href);
verifier.verifyRecipe(pins.consumers.seal.sha256);
const guards = await import(pathToFileURL(join(repository, pins.consumers.root, 'guards.mjs')).href);
const types = await import(pathToFileURL(join(repository, pins.consumers.root, 'type-worker.mjs')).href);
const beforeConsumers = guards.inspectTree(join(repository, pins.consumers.root));
const beforeFixtures = guards.inspectTree(guards.fixtureRoot);
const oldInputs = readJson(join(coreRoot, '../V1-INPUTS.json'));
for (const [path, identity] of Object.entries(oldInputs.files)) readBound(join(repository, path), identity.sha256);
const oldRecipe = readJson(join(repository, Object.keys(oldInputs.files).find((path) => path.endsWith('/RECIPE.json'))));
const receipt = JSON.parse(readBound(join(repository, pins.packet.fullReceipt.path), pins.packet.fullReceipt.sha256));
const build = JSON.parse(readBound(join(repository, pins.packet.buildReceipt.path), pins.packet.buildReceipt.sha256));
const sourceBase = readJson(join(guards.fixtureRoot, 'SOURCE-BASE.json'));
const baseline = readJson(join(guards.fixtureRoot, 'BASELINE-PACKAGE.json'));
const selected = readJson(join(guards.fixtureRoot, 'SELECTED.json'));
const author = readJson(join(repository, pins.author.manifest.path));
const sourceFiles = { ...Object.fromEntries(Object.entries(sourceBase).map(([path, file]) => [path, { sha256: file.sha256, bytes: file.bytes, mode: file.mode }])), ...receipt.sourceAdditions };
const packageTree = guards.expectedPackage(receipt, baseline, selected.readme);
const syntheticHash = 'a'.repeat(64);
const fileRef = { path: '/synthetic/review.json', sha256: syntheticHash };
const packetRef = (name) => ({ path: join(repository, pins.packet[name].path), sha256: pins.packet[name].sha256 });
const envelope = { schema: 1, purpose: 'YQ_COMPOUND_V2_AFTER_ROOT_PRESEAL', execute: true, rootApproval: 'SYNTHETIC_DATA_NOT_EXECUTION_AUTHORITY', integrationSealSha256: syntheticHash, authorSourceCommit: pins.author.sourceCommit, consumerCandidateCommit: pins.author.sourceCommit, sourceBase: pins.baseline, acceptedLength: pins.acceptedLength, rootSourceCompositionAccepted: true, consumerReceipt: packetRef('fullReceipt'), admissionReceipt: packetRef('admissionReceipt'), frameworkReviewReceipt: fileRef, sourceArchive: { path: '/synthetic/source.tar', sha256: pins.author.archiveSha256 }, packageArchive: { path: '/synthetic/package.tgz', sha256: pins.author.packageSha256 }, archiveSourceRoot: '/synthetic/source-273', consumerSourceRoot: '/synthetic/source-271', packageRoot: '/synthetic/package-870', runtimeRecipeRoot: '/synthetic/runtime-recipe', outputParent: '/synthetic/output', buildProof: { classification: 'AUTHOR_ARTIFACT_BINDING_ONLY', receipt: null } };
const child = { admitted: true, integrity: true, reapProof: true, metadata: { exitCode: 0, signal: null, timedOut: false, reaped: true, overflow: false, spawnError: null } };
const hostResult = { aggregate: 'PASS', results: [child], stop: null, activeChildren: [] };
const runRoot = join(dirname(coreRoot), `data-check-${randomUUID()}`);
mkdirSync(runRoot, { mode: 493 });
const fixture = join(runRoot, 'fixture');
mkdirSync(fixture, { mode: 493 });
writeFileSync(join(fixture, 'README.md'), 'synthetic readonly input\n', { flag: 'wx', mode: 420 });
chmodSync(join(fixture, 'README.md'), 420);
const fixtureBefore = guards.inspectTree(fixture);
const records = [];
const controls = {
  'missing-root-binding-refuses': async () => { await assert.rejects(bind(), /Missing explicit root binding/); },
  'same-selected-origin-no-fake-commit': () => {
    validateEnvelope(envelope, syntheticHash, pins);
    assert.throws(() => validateEnvelope({ ...envelope, consumerCandidateCommit: '1'.repeat(40) }, syntheticHash, pins), /no composite candidate commit/);
  },
  'packet-reference-and-hash-required': () => {
    for (const consumerReceipt of [{ ...envelope.consumerReceipt, path: '/synthetic/other.json' }, { ...envelope.consumerReceipt, sha256: syntheticHash }]) assert.throws(() => validateEnvelope({ ...envelope, consumerReceipt }, syntheticHash, pins), /Exact sealed packet/);
  },
  'independent-build-not-inherited': () => {
    assert.equal(build.independentlyCompiled, false);
    assert.equal(build.rootTrustedBuildReceipt, false);
    assert.throws(() => validateEnvelope({ ...envelope, buildProof: { classification: 'INDEPENDENT_REPRODUCTION_ROOT_ACCEPTED', receipt: fileRef } }, syntheticHash, pins), /Independent compilation/);
  },
  'exact-ten-field-consumer-schema': () => {
    guards.validateReceiptShape(receipt);
    assert.equal(Object.keys(receipt).length, 10);
    assert.equal(receipt.candidateCommit, pins.author.sourceCommit);
    assert.deepEqual(receipt.buildReceipt, packetRef('buildReceipt'));
    assert.throws(() => guards.validateReceiptShape({ ...receipt, extra: true }), /RECEIPT_SCHEMA/);
  },
  'source-273-versus-271-and-map': () => {
    const archive = Object.fromEntries(author.files.filter((file) => !file.path.startsWith('tests/')).map((file) => [file.path, { sha256: file.sha256, bytes: file.bytes, mode: parseInt(file.mode, 8) & 4095 }]));
    assert.equal(Object.keys(archive).length, 273);
    assert.equal(Object.keys(sourceFiles).length, 271);
    assert.equal(Object.keys(receipt.sourceAdditions).length, 7);
    assert.deepEqual(Object.keys(archive).filter((path) => !Object.hasOwn(sourceFiles, path)).sort(), ['package-lock.json', 'scripts/typecheck.mjs']);
    for (const [path, descriptor] of Object.entries(sourceFiles)) assert.deepEqual(archive[path], descriptor);
    assert.equal(guards.sha256(guards.canonical(sourceFiles)), pins.packet.sourceMapSha256);
    assert.equal(build.sourceMapSha256, pins.packet.sourceMapSha256);
  },
  'full-870-baseline-readme': () => {
    assertFullPackage(packageTree.files, selected.readme);
    assert.equal(guards.sha256(guards.canonical(packageTree)), pins.packet.packageMapSha256);
    const incomplete = { ...packageTree.files };
    delete incomplete['README.md'];
    assert.throws(() => assertFullPackage(incomplete, selected.readme), /870 files/);
    assert.throws(() => assertFullPackage({ ...packageTree.files, 'README.md': {} }, selected.readme), /README identity/);
  },
  'readonly-fixture-translation-preserved': () => {
    assert.deepEqual(directoryMap(fixtureBefore.files), fixtureBefore.directories);
    const translated = runtimeEntries(fixtureBefore);
    assert.equal(translated.length, 2);
    assert.equal(translated[1].sha256, hash('synthetic readonly input\n'));
    guards.assertPackageTree(fixture, fixtureBefore);
  },
  'negative-type-declared-diagnostic-only': () => {
    const job = recipe.scopedTypeJobs.find((entry) => entry.name === 'factory-command-extra');
    const files = { cwd: '/synthetic', fixture: '/synthetic/fixture.mts', candidate: '/synthetic/package', candidateFiles: { 'yq.d.ts': {} }, tools: [], requiredDeclarations: ['/synthetic/package/yq.d.ts'] };
    const raw = { status: 2, signal: null, error: null, stderr: '', stdout: '/synthetic/fixture.mts(2,1): error TS2554: Expected 0 arguments, but got 1.\n/synthetic/fixture.mts\n/synthetic/package/yq.d.ts\n' };
    assert.equal(types.classifyCompilerOutcome(job, raw, files).classification, 'ACCEPTED_COMPILE_REJECTION');
    assert.throws(() => types.classifyCompilerOutcome(job, { ...raw, stdout: raw.stdout.replace('TS2554', 'TS2307') }, files), /COMPILER_DIAGNOSTICS/);
  },
  'nonzero-worker-never-waived': () => {
    assert.throws(() => types.assertWorkerExit({ status: 7, signal: null, error: null, stdout: 'PASS' }), /WORKER_EXIT/);
    assert.equal(continuation({ ...hostResult, results: [{ ...child, metadata: { ...child.metadata, exitCode: 7 } }] }).aggregate, 'FAIL');
  },
  'timeout-fail-clean-continuation-only': () => {
    const timeout = { ...hostResult, results: [{ ...child, metadata: { ...child.metadata, timedOut: true } }] };
    assert.equal(continuation(timeout).aggregate, 'FAIL');
    assert.equal(continuation(timeout).admitIndependent, true);
    assert.equal(continuation(timeout, false).admitIndependent, false);
  },
  'integrity-or-reap-uncertainty-stops': () => {
    for (const record of [{ ...child, integrity: false }, { ...child, reapProof: false }, { ...child, metadata: { ...child.metadata, reaped: false } }]) assert.equal(continuation({ ...hostResult, results: [record] }).admitIndependent, false);
  },
  'all-194-routes-and-eight-overlays-unchanged': () => {
    assert.deepEqual(recipe.routes, oldRecipe.routes);
    assert.deepEqual(recipe.roleCounts, oldRecipe.roleCounts);
    assert.deepEqual(recipe.overlays, oldRecipe.overlays);
    assert.equal(recipe.routes.length, 194);
    assert.equal(recipe.overlays.length, 8);
  },
  '132-projection-149-jobs-not-recounted': () => {
    for (const key of ['preparedIds', 'jobsSha256', 'semantic', 'stages', 'scopedTypeJobs', 'sourceProbeRoutes']) assert.deepEqual(recipe[key], oldRecipe[key]);
    assert.equal(recipe.preparedIds.length, 132);
    assert.equal(recipe.jobsPerEnvironment, 149);
    assert.equal(recipe.semantic.passes, 0);
  },
  'all-80-gaps-retained': () => { assert.deepEqual(recipe.missingBindings, oldRecipe.missingBindings); assert.equal(recipe.missingBindings.records, 80); },
  'public-export-gap-retained': () => assert.throws(() => guards.assertPublicAdmission(), /PUBLIC_EXPORT_GAP/),
};
assert.deepEqual(Object.keys(controls), schedule.controls);
for (const id of schedule.controls) {
  try { await controls[id](); records.push({ id, outcome: 'PASS' }); }
  catch (error) { records.push({ id, outcome: 'FAIL', error: String(error) }); }
}
verifyIntegration(sealPath, sealHash);
verifier.verifyRecipe(pins.consumers.seal.sha256);
guards.assertPackageTree(join(repository, pins.consumers.root), beforeConsumers);
guards.assertPackageTree(guards.fixtureRoot, beforeFixtures);
guards.assertPackageTree(fixture, fixtureBefore);
const result = { schema: 1, classification: schedule.classification, aggregate: records.every((record) => record.outcome === 'PASS') ? 'PASS' : 'FAIL', records, runtimeBindingStatus: pins.runtime.status, deferred: schedule.deferred, runtimeHelperImports: 0, ownedChildExecutions: 0, activeChildren: [], productImports: 0, productExecutions: 0, builds: 0, typeCompiles: 0, independentAcceptance: false, fixtureBeforeAfterSha256: jsonHash(runtimeEntries(fixtureBefore)), sealHash };
const temporary = join(runRoot, `.result-${randomUUID()}.tmp`);
const descriptor = openSync(temporary, 'wx', 420);
try { writeFileSync(descriptor, `${JSON.stringify(result, null, 2)}\n`); fsyncSync(descriptor); }
finally { closeSync(descriptor); }
linkSync(temporary, join(runRoot, 'RESULT.json'));
unlinkSync(temporary);
console.log(JSON.stringify({ aggregate: result.aggregate, evidence: join(runRoot, 'RESULT.json'), controls: records.length, runtimeBindingStatus: pins.runtime.status, activeChildren: [] }));
process.exitCode = result.aggregate === 'PASS' ? 0 : 1;
