import assert from 'node:assert/strict';
export const ids = Object.freeze(['C01','C02','C07','C12','C13','C14','R17','R16']);
export const layouts = Object.freeze(['source-built','installed','physically-moved']);
export const bounds = Object.freeze({ knownOS:40, peakOS:3, inclusiveSeconds:1200, publicationSeconds:180, caseSeconds:30, layoutSeconds:270, installSeconds:120, setupSeconds:60, cleanupSeconds:5, captureBytes:67108864, sampledLogicalWorkBytes:268435456, guestWorkers:0, regexWorkers:0 });
function data(value, keys) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort());
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); assert(descriptor && Object.hasOwn(descriptor, 'value'), 'own data only'); }
}
export function validateSelection(selected, layout) { assert.deepEqual(selected, ids); assert(layouts.includes(layout)); }
export function admitProducerParameter(value) {
  data(value, ['schema','authority','sourceManifest','emittedManifest','packageManifest','package','counts']);
  assert.equal(value.schema, 'FINAL_SMOKE_ADMITTED_PRODUCER_V1');
  assert.equal(value.authority, 'HASH_SIZE_TYPE_ADMITTED_PRODUCER_RECEIPT');
  for (const name of ['sourceManifest','emittedManifest','packageManifest','package']) {
    data(value[name], ['path','bytes','sha256']);
    assert(typeof value[name].path === 'string' && value[name].path.startsWith('/') && !value[name].path.includes('\0'));
    assert(Number.isSafeInteger(value[name].bytes) && value[name].bytes > 0); assert.match(value[name].sha256, /^[0-9a-f]{64}$/);
  }
  data(value.counts, ['sourceInputs','emittedFiles','packageMembers']);
  for (const count of Object.values(value.counts)) assert(Number.isSafeInteger(count) && count > 0 && count <= 16384);
  return value;
}
export function reconcileCardinality(receipt, manifests) {
  admitProducerParameter(receipt);
  for (const [kind, count] of [['source','sourceInputs'],['emitted','emittedFiles'],['members','packageMembers']]) {
    assert(Array.isArray(manifests[kind])); assert.equal(manifests[kind].length, receipt.counts[count]);
    const names = manifests[kind].map(row => row.path); assert.equal(new Set(names).size, names.length);
    for (const name of names) assert(typeof name === 'string' && name.length > 0 && !name.startsWith('/') && !name.split('/').includes('..') && !name.includes('\0'));
  }
}
export function beforeCase({ selected, layout, index, now, activeEnd, workers, captureRemaining, workRemaining }) {
  validateSelection(selected, layout); assert(Number.isSafeInteger(index) && index >= 0 && index < ids.length);
  assert(Number.isFinite(now) && Number.isFinite(activeEnd) && now + bounds.caseSeconds * 1000 <= activeEnd, 'insufficient inclusive case headroom');
  assert.equal(workers.guest, 0); assert.equal(workers.regex, 0);
  assert(captureRemaining >= 1048576 && workRemaining >= 1048576, 'precase reserved output/work headroom');
  return ids[index];
}
