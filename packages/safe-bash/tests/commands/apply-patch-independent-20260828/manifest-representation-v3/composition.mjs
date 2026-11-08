import assert from 'node:assert/strict';
import { objectId, treeHash } from './path-bytes.mjs';
import { sha } from './common.mjs';

function rawTree(bytes) {
  const entries = []; const names = new Set(); let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset); const zero = bytes.indexOf(0, space + 1);
    assert.ok(space > offset && zero > space && zero + 21 <= bytes.length);
    const mode = bytes.subarray(offset, space).toString('ascii'); assert.match(mode, /^(40000|100644|100755|120000|160000)$/);
    const name = Buffer.from(bytes.subarray(space + 1, zero)); assert.ok(!name.includes(47));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(name); assert.ok(text && text !== '.' && text !== '..' && !names.has(text)); names.add(text);
    const entry = { mode, name, object: Buffer.from(bytes.subarray(zero + 1, zero + 21)) }; entries.push(entry); offset = zero + 21;
  }
  assert.deepEqual(serialize(entries), bytes, 'Git directory-sort canonical serialization');
  return entries;
}
function serialize(entries) {
  const ordered = [...entries].sort((left, right) => Buffer.compare(Buffer.concat([left.name, left.mode === '40000' ? Buffer.from('/') : Buffer.alloc(0)]), Buffer.concat([right.name, right.mode === '40000' ? Buffer.from('/') : Buffer.alloc(0)])));
  return Buffer.concat(ordered.map(entry => Buffer.concat([Buffer.from(entry.mode + ' '), entry.name, Buffer.from([0]), entry.object])));
}
export function verifyComposition(binding) {
  const expected = binding.derivedTrees;
  for (const tree of [...binding.ancestorInputs, ...expected]) {
    const bytes = Buffer.from(tree.rawBase64, 'base64'); assert.equal(objectId('tree', bytes), tree.oid); assert.equal(sha(bytes), tree.sha256); rawTree(bytes);
  }
  const src = binding.selectedInputs.filter(entry => entry.path.startsWith('src/')).map(entry => ({ ...entry, path: entry.path.slice(4) }));
  const sourceTree = treeHash(src); assert.equal(sourceTree, expected.at(-2).oid);
  const module = binding.selectedInputs.filter(entry => entry.path.startsWith('src/commands/apply-patch/')).map(entry => ({ ...entry, path: entry.path.slice('src/commands/apply-patch/'.length) }));
  assert.equal(module.length, 6); assert.equal(treeHash(module), expected.at(-4).oid);
  for (const [previousIndex, nextIndex, child, nextObject] of [[1, 8, 'apply-patch', expected[7].oid], [5, 9, 'commands', expected[8].oid], [6, 10, 'src', expected[9].oid]]) {
    const before = rawTree(Buffer.from(expected[previousIndex].rawBase64, 'base64'));
    const existing = before.find(entry => entry.name.toString() === child);
    if (existing) { assert.equal(existing.mode, '40000'); existing.object = Buffer.from(nextObject, 'hex'); }
    else before.push({ mode: '40000', name: Buffer.from(child), object: Buffer.from(nextObject, 'hex') });
    const bytes = serialize(before); assert.equal(bytes.toString('base64'), expected[nextIndex].rawBase64); assert.equal(objectId('tree', bytes), expected[nextIndex].oid);
  }
  assert.equal(expected[6].oid, binding.acceptedBaseDerivedTree); assert.equal(expected[10].oid, binding.newSelectedDerivedTree);
  return { selectedFiles: binding.selectedInputs.length, moduleFiles: 6, derivedObjects: expected.length, storedAncestorObjects: binding.ancestorInputs.length, tree: binding.newSelectedDerivedTree, instructionBodiesMaterialized: 0 };
}
