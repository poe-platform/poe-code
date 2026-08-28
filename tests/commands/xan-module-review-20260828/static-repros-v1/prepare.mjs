import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ROOT, REVIEW, NODE, identity, tree, durable, authenticate, inputsIdentity, checkInputs } from './common.mjs';
import { cases, obligations, assertObservation } from './recipe.mjs';
import { supervise } from '../preparation-v2/supervisor.mjs';

const binding = await authenticate();
const inputs = await inputsIdentity();
assert.equal(cases.length, 14); assert.equal(new Set(cases.map(item => item.id)).size, 14);
assert.equal(Object.values(obligations[0].implementationWork).reduce((total, value) => total + value, 0), 36);
assert.equal(Object.values(obligations[0].omittedLowerBound).reduce((total, value) => total + value, 0), 12);
assert.equal(24736 + 4097 + 8194, 37027);
await durable(path.join(ROOT, 'HOST-PRE.json'), { at: new Date().toISOString(), productExecutions: 0, inputs, externalInputs: binding.inputs });
const qualification = path.join(ROOT, 'qualification'); await mkdir(qualification);
const controls = [];
for (const kind of ['pass', 'fail', 'timeout']) {
  const receipt = await supervise({ executable: NODE, args: [path.join(ROOT, 'worker.mjs'), 'synthetic', kind], cwd: ROOT, directory: path.join(qualification, kind), timeoutMs: kind === 'timeout' ? 300 : 5000, rawBytes: 4096, kind: `synthetic-${kind}` });
  controls.push({ kind, receipt }); await checkInputs(inputs);
  assert.equal(receipt.reaped, true); assert.equal(receipt.overflow, false); assert.equal(receipt.spawnError, null);
  if (kind === 'timeout') assert.equal(receipt.timeout, true);
  else { assert.equal(receipt.timeout, false); assert.equal(receipt.code, kind === 'fail' ? 1 : 0); }
}
const spec = cases.find(item => item.id === 'SA01-numeric-witness');
const valid = { id: spec.id, closed: true, naturalSettlement: true, thrown: false, result: { exitCode: 0 }, stdoutBase64: spec.expected.stdoutBase64, stderrBase64: '', fsCalls: 0, events: [{ type: 'input-delivery' }] };
assertObservation(assert, spec, valid);
const counterfeit = [
  { ...valid, events: [] }, { ...valid, stdoutBase64: '' }, { ...valid, result: { exitCode: 1 } }, { ...valid, naturalSettlement: false },
];
for (const record of counterfeit) assert.throws(() => assertObservation(assert, spec, record));
await durable(path.join(qualification, 'CONTROLS.json'), { controls, counterfeitRejected: counterfeit.length, candidateExecuted: false });
await checkInputs(inputs); await checkInputs(binding.inputs);
await durable(path.join(ROOT, 'PRE-SEAL.json'), { at: new Date().toISOString(), attemptLimit: 1, candidateExecutionsBeforeSeal: 0, inputs, binding, cases, obligations,
  qualification: await tree(qualification), hostPre: await identity(path.join(ROOT, 'HOST-PRE.json')), perChild: { timeoutMs: 10000, rawBytes: 2097152, stderrBytes: 16384 },
  reads: 'worker file, loader file, job file, chosen authenticated emission tree only', noCandidateWrites: true, noNewDependencies: true, noNativeOracle: true, noNetwork: true });
console.log(JSON.stringify({ sealed: await identity(path.join(ROOT, 'PRE-SEAL.json')), casesPerLayout: cases.length, candidateRuns: 0, syntheticChildren: controls.length }));
