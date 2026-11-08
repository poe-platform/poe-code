import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('freeze-manifest.json', root), 'utf8'));
for (const [name, expected] of Object.entries(manifest.controls)) {
  assert(!name.includes('/') && !name.includes('..'), `unexpected frozen path: ${name}`);
  const bytes = await readFile(new URL(name, root));
  assert.equal(bytes.length, expected.bytes, `${name}: byte length`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, `${name}: SHA256`);
}
const { semanticControls, nativeControls } = await import('./semantic-controls.mjs');
const policy = JSON.parse(await readFile(new URL('policy-controls.json', root), 'utf8'));
const types = JSON.parse(await readFile(new URL('type-probes.json', root), 'utf8'));
const ids = new Set(semanticControls.map((control) => control.id));
assert.equal(ids.size, semanticControls.length);
const scans = semanticControls.flatMap((control) => control.operations).filter((operation) => operation.operation === 'scan');
for (const operation of scans) {
  assert.equal(typeof operation.optstring, 'string');
  assert(operation.args.every((argument) => typeof argument === 'string'));
  assert.equal(typeof operation.reportErrors, 'boolean');
  assert.deepEqual(Object.keys(operation.expected).sort(), ['argument', 'diagnostic', 'kind', 'optind', 'option', 'status']);
  assert.equal(operation.expected.status, operation.expected.kind === 'end' ? 1 : 0);
}
let nativeRecords = 0;
for (const control of nativeControls) {
  assert.equal(typeof control.stderr, 'string');
  for (const id of control.semanticIds) {
    assert(ids.has(id), `${control.id}: missing semantic id ${id}`);
    nativeRecords += semanticControls.find((semantic) => semantic.id === id).operations.filter((operation) => operation.operation === 'scan').length;
  }
}
const policyIds = new Set(policy.controls.map((control) => control.id));
assert.equal(policyIds.size, policy.controls.length);
for (const mutation of policy.mutationControls) {
  assert(mutation.mustBeKilledBy.length > 0);
  for (const id of mutation.mustBeKilledBy) assert(ids.has(id) || policyIds.has(id), `${mutation.id}: missing target ${id}`);
}
const typeIds = [...types.positive, ...types.negative].map((probe) => probe.id);
assert.equal(new Set(typeIds).size, typeIds.length);
const counts = {
  semanticSequences: semanticControls.length,
  scanProjections: scans.length,
  indexEvents: semanticControls.flatMap((control) => control.operations).filter((operation) => operation.operation === 'index').length,
  nativeScripts: nativeControls.length,
  nativeRecordsPerProfile: nativeRecords,
  policyControls: policy.controls.length,
  mutationTargets: policy.mutationControls.length,
  positiveTypeProbes: types.positive.length,
  negativeTypeProbes: types.negative.length,
};
assert.deepEqual(counts, manifest.counts);
console.log(JSON.stringify({ scope: 'frozen owned control integrity only; no candidate/native/type/mutation execution', counts }, null, 2));
