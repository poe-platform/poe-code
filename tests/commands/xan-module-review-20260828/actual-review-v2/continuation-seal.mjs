import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, json, identity, durable, tree } from './common.mjs';
const previous = await json(path.join(ROOT, 'evidence/RESULT.json')); assert.equal(previous.children.started, 1);
const names = ['continuation.mjs', 'continuation-seal.mjs', 'repair-controls.mjs', 'REPAIR-CONTROLS.json', 'COMPILER-ADDENDUM.md', 'WORKER-CONTROL.json', 'bundle-continuation.mjs'];
const worker = await json(path.join(ROOT, 'WORKER-CONTROL.json')); assert.equal(worker.code, 0); assert.equal(worker.reaped, true);
const inputs = [];
for (const name of names) inputs.push({ path: path.join(ROOT, name), ...await identity(path.join(ROOT, name)) });
for (const entry of (await tree(path.join(ROOT, 'compiler-fixtures'))).filter(entry => !entry.directory)) { const { path: filename, ...expected } = entry; inputs.push({ path: path.join(ROOT, 'compiler-fixtures', filename), ...expected }); }
await durable(path.join(ROOT, 'CONTINUATION-PRE.json'), { classification: 'INFRASTRUCTURE_CORRECTION_PRE_FIRST_RUNTIME_COHORT', date: new Date().toISOString(), originalRecipe: '549f2055eb964c33cdbf26109645a422b2b5194a', originalSeal: await identity(path.join(ROOT, 'PRE-SEAL.json')), priorFailure: await identity(path.join(ROOT, 'evidence/RESULT.json')), inputs, changedPermission: 'read fresh emission only; same directory is only compiler write grant', unchangedJobs: 667, candidateCasesExecutedBeforeSeal: 0 });
console.log(JSON.stringify({ inputs: inputs.length, candidateRuntimeBeforeSeal: 0 }));
