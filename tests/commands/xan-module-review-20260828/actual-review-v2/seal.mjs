import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT, OLD, REPO, NODE, json, hash, identity, frozen, verifyTree, durable } from './common.mjs';
import { manifest } from './manifest.mjs';

const ownNames = ['.gitignore', 'common.mjs', 'manifest.mjs', 'adapter.mjs', 'lifecycle.mjs', 'worker.mjs', 'controls.mjs', 'CONTROLS.json', 'compiler-control.mts', 'COMPILER-CONTROL.json', 'consumer-positive.mts', 'consumer-negative.mts', 'denials.mjs', 'seal.mjs', 'runner.mjs', 'bundle.mjs', 'PROTOCOL.md'];
const helpers = ['core.mjs', 'mocks.mjs', 'actual-review-v1/extra.mjs', 'actual-review-v1/loader.mjs', 'actual-review-v1/a01.mjs', 'preparation-v2/cases.mjs', 'preparation-v2/scenarios.mjs', 'preparation-v2/diagnostics.mjs', 'preparation-v2/resources.mjs', 'preparation-v2/supervisor.mjs', 'preparation-v2/CASE-MAP.json', 'preparation-v2/RECIPE-SEAL.json'];
const evidenceSeal = await identity(path.join(OLD, 'ADMISSION-EVIDENCE-SEAL.json'));
assert.equal(evidenceSeal.sha256, 'a7a2814fb74306da8f78fb4f8e4498ee520615e8ab011c60e7cec465cf302fd4');
const sealed = await json(path.join(OLD, 'ADMISSION-EVIDENCE-SEAL.json'));
await verifyTree(path.join(OLD, 'evidence'), sealed.entries);
const admission = await json(path.join(OLD, 'evidence/ADMISSION.json'));
assert.equal(admission.sourceCommit, '0ec84fc38c3fafd75776d80148d4f3c2d77e6247');
assert.equal(admission.base, '5137a74ec855a32d8a8860eb66b62eb44d11e290');
for (const [name, entries] of [['source', admission.source], ['tools', admission.tools], ['installed-moved', admission.installed]]) await verifyTree(path.join(OLD, 'work', name), entries);
assert.deepEqual(await identity(NODE), admission.node);
const documents = await frozen(); const cohort = manifest(documents);
assert.equal(new Set(cohort.jobs.map(job => job.id)).size, cohort.jobs.length);
const controls = await json(path.join(ROOT, 'CONTROLS.json')); assert.equal(controls.passed, 12); assert.equal(controls.failed, 0);
const compilerControl = await json(path.join(ROOT, 'COMPILER-CONTROL.json')); assert.equal(compilerControl.code, 0); assert.equal(compilerControl.reaped, true);
const inputs = [];
for (const name of ownNames) inputs.push({ path: path.join(ROOT, name), ...await identity(path.join(ROOT, name)) });
for (const name of helpers) { const filename = path.resolve(ROOT, '..', name); inputs.push({ path: filename, ...await identity(filename) }); }
const freeze = await json(path.resolve(ROOT, '../preparation-v2/RECIPE-SEAL.json'));
for (const entry of freeze.inputs) inputs.push({ path: path.join(REPO, entry.path), ...await identity(path.join(REPO, entry.path)) });
const seal = { schema: 'xan-actual-review-v2-pre', created: new Date().toISOString(), normativeFreeze: freeze.frozenCommit,
  source: admission.sourceCommit, base: admission.base, inventorySha256: admission.compositionIdentity, admissionSeal: evidenceSeal,
  reusedAdmission: { recipe: '9847b13fcf03e54d00cfa455eb3b0b16723f4254', evidence: '2244dc59fe3e1ef804c34f53d698dc0223f11ea5', serializationNotAuthenticated: 'historical baseline/tools archives; author package authenticated, not independently serialized' },
  node: { path: NODE, ...admission.node }, toolRoot: path.join(OLD, 'work/tools'), toolEntries: admission.tools,
  inputs, cohort, manifestSha256: hash(JSON.stringify(cohort)), actualRunsBeforeSeal: 0, maxCohorts: 1, syntheticControls: controls.passed,
  package: admission.packed, moduleEntry: 'dist/commands/xan/index.js', noPublicExportRequired: true };
await durable(path.join(ROOT, 'PRE-SEAL.json'), seal);
console.log(JSON.stringify({ recipeSha256: hash(await readFile(path.join(ROOT, 'PRE-SEAL.json'))), jobsPerLayout: cohort.jobs.length, actualRuns: 0 }));
