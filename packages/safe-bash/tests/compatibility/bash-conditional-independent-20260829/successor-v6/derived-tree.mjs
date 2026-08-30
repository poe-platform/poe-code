import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const objectHash = (kind, bytes) => createHash('sha1').update(Buffer.from(kind + ' ' + bytes.length + '\0')).update(bytes).digest('hex');
function encode(entries) { return Buffer.concat([...entries].sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === '40000' ? '/' : '')), Buffer.from(right.name + (right.mode === '40000' ? '/' : '')))).map(row => Buffer.concat([Buffer.from(row.mode + ' ' + row.name + '\0'), Buffer.from(row.oid, 'hex')]))); }
function decode(bytes) { const rows = []; let offset = 0; while (offset < bytes.length) { const space = bytes.indexOf(32, offset), nul = bytes.indexOf(0, space); assert.ok(space >= offset && nul > space && nul + 21 <= bytes.length); rows.push({ mode: bytes.subarray(offset, space).toString(), name: bytes.subarray(space + 1, nul).toString(), oid: bytes.subarray(nul + 1, nul + 21).toString('hex') }); offset = nul + 21; } return rows; }
export function verifyComposition(manifest) {
 const root = new Map();
 for (const row of manifest.inputs) { assert.ok(row.mode === '100644' || row.mode === '100755'); assert.ok(!row.path.startsWith('/') && !row.path.split('/').some(part => !part || part === '..' || part === 'AGENTS.md')); if (!row.path.startsWith('src/')) continue; let node = root; const parts = row.path.slice(4).split('/'); for (const name of parts.slice(0,-1)) { if (!node.has(name)) node.set(name, new Map()); node = node.get(name); assert.ok(node instanceof Map); } assert.ok(!node.has(parts.at(-1))); node.set(parts.at(-1), row); }
 const finish = node => objectHash('tree', encode([...node].map(([name,value]) => value instanceof Map ? { name, mode:'40000', oid:finish(value) } : { name, mode:value.mode, oid:value.blob })));
 const sourceTree = finish(root); const rootWitness = [...manifest.reconstructedTrees, ...manifest.ancestorTrees].find(row => row.oid === '26215b99cb379a9f825f803454f758fab5a3c8e9'); assert.ok(rootWitness); const bytes = Buffer.from(rootWitness.base64, 'base64'); assert.equal(objectHash('tree', bytes), rootWitness.oid); const entries = decode(bytes).map(row => row.name === 'src' ? { ...row, oid:sourceTree } : row);
 const computed = objectHash('tree', encode(entries)); assert.equal(computed, '74dfe69135a3fc5ba89396b20dd32d9c9daae131'); assert.equal(manifest.computedTree, computed); assert.equal(manifest.inputs.length, 293); return { computed, sourceTree };
}

