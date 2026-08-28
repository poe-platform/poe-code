import { readFileSync, lstatSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const own = 'tests/commands/node-worker-independent-20260828/v2/';
const packet = 'tests/commands/node-design-20260828/worker-resource-quiescence-proposal-v2/';
const candidate = '82aae2f5bff404423e81ddb6ddfacb6e0abd35a9';
const started = performance.now();
let processed = 0;
function charge(count) {
  processed += count;
  assert(processed <= 64 * 1024 * 1024 && performance.now() - started < 60000);
}
function read(path) {
  assert(!path.startsWith('/') && !path.split('/').includes('..'));
  const parts = path.split('/');
  for (let index = 1; index <= parts.length; index++) assert(!lstatSync(parts.slice(0, index).join('/')).isSymbolicLink());
  const stat = lstatSync(path);
  assert(stat.isFile() && stat.size <= 2 * 1024 * 1024);
  const bytes = readFileSync(path);
  charge(bytes.length);
  return bytes;
}
function hash(bytes, algorithm = 'sha256') {
  charge(bytes.length);
  return createHash(algorithm).update(bytes).digest('hex');
}
function gitHash(kind, bytes) {
  return hash(Buffer.concat([Buffer.from(`${kind} ${bytes.length}\0`), bytes]), 'sha1');
}
function inventory(path) {
  const bytes = read(path);
  assert.equal(bytes.at(-1), 0);
  return bytes.toString().slice(0, -1).split('\0').map(record => {
    const tab = record.indexOf('\t');
    assert(tab > 0);
    const [mode, type, blob] = record.slice(0, tab).split(' ');
    assert.equal(mode, '100644');
    assert.equal(type, 'blob');
    return { path: record.slice(tab + 1), blob, mode };
  });
}
const commit = read(`${own}candidate-commit.data`);
assert.equal(gitHash('commit', commit), candidate);
const records = inventory(`${own}candidate-inventory.data`);
assert.equal(records.length, 12);
const bodies = new Map();
for (const record of records) {
  assert(record.path.startsWith(packet));
  const bytes = read(record.path);
  assert.equal(gitHash('blob', bytes), record.blob, record.path);
  bodies.set(record.path.slice(packet.length), bytes);
}
assert.equal(hash(bodies.get('HANDOFF.md')), '6041fe928927ffc672075a5fbbdfb38b0360b8af750e6ce184d57d0884208682');
assert.equal(hash(bodies.get('SEAL.json')), 'afeeb6c6aa42577b9e7e0e7ebd682cf0ace17e09c54368a1c2d1101cc097b7a4');
const json = Object.fromEntries([...bodies].filter(([name]) => name.endsWith('.json')).map(([name, bytes]) => [name, JSON.parse(bytes)]));
const seal = json['SEAL.json'];
const arrays = Object.entries(seal).filter(([, value]) => Array.isArray(value));
const outputArray = arrays.find(([name]) => /output/i.test(name));
assert(outputArray, JSON.stringify(Object.keys(seal)));
assert.equal(outputArray[1].length, 11);
for (const entry of outputArray[1]) {
  const name = entry.path.startsWith(packet) ? entry.path.slice(packet.length) : entry.path;
  const bytes = bodies.get(name);
  assert(bytes, name);
  assert.equal(bytes.length, entry.bytes, name);
  assert.equal(hash(bytes), entry.sha256, name);
}
const pinnedInputs = [];
for (const entry of seal.inputBodies) {
  let bytes;
  if (entry.path === 'src/contracts/errors.ts') bytes = read(`${own}errors-contract.data`);
  else bytes = read(entry.path);
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(hash(bytes), entry.sha256, entry.path);
  assert.equal(gitHash('blob', bytes), entry.blob, entry.path);
  pinnedInputs.push({ path: entry.path, commit: entry.commit, blob: entry.blob, sha256: entry.sha256 });
}
const errorsSource = read(`${own}errors-contract.data`);
const errorRecord = inventory(`${own}errors-inventory.data`);
assert.equal(errorRecord.length, 1);
assert.equal(errorRecord[0].path, 'src/contracts/errors.ts');
assert.equal(gitHash('blob', errorsSource), errorRecord[0].blob);
assert.match(errorsSource.toString(), /export type ErrnoCode = keyof typeof descriptions;/);
const descriptions = errorsSource.toString().match(/const descriptions = \{([\s\S]*?)\} as const;/);
assert(descriptions);
const codes = [...descriptions[1].matchAll(/^  ([A-Z0-9_]+):/gm)].map(match => match[1]);
assert.equal(codes.length, 28);
assert.deepEqual([...codes].sort(), [...json['ERRORS.json'].fsCodes].sort());
assert.equal(new Set(json['ERRORS.json'].fsCodes).size, 28);
const rpc = json['RPC.json'];
assert.equal(rpc.layout.globalInt32Words.length * 4, rpc.layout.globalBytes);
assert.equal(rpc.layout.slotInt32Words.length * 4, rpc.layout.slotHeaderBytes);
assert.equal(rpc.layout.globalBytes + rpc.layout.slotCount * (rpc.layout.slotHeaderBytes + rpc.layout.slotPayloadBytes), rpc.layout.bytes);
assert.equal(rpc.layout.bytes, 197056);
assert.deepEqual(rpc.layout.activeSlots, [0]);
assert.deepEqual(rpc.layout.inactiveSlots, [1, 2]);
assert.equal(Object.keys(rpc.states).length, 7);
assert.equal(json['DISPOSITIONS.json'].findings.length, 7);
assert.deepEqual(json['DISPOSITIONS.json'].findings.map(entry => entry.id), ['F1','F2','F3','F4','F5','F6','F7']);
assert.deepEqual(json['OBLIGATIONS.json'].obligations.map(entry => [entry.id, entry.rootId]), Array.from({ length: 8 }, (_, index) => [`WRQ0${index + 1}`, `L0${index + 1}`]));
assert.equal(json['OBLIGATIONS.json'].counts.executedQualificationObligations, 0);
const result = {
  role: 'Frozen packet DATA authentication; no model, Worker, provider or engine execution',
  candidate, tree: commit.toString().match(/^tree ([a-f0-9]{40})/)[1],
  packet: records.map(record => ({ ...record, sha256: hash(bodies.get(record.path.slice(packet.length))) })),
  sealKeys: Object.keys(seal), outputBodiesVerified: 11, inputBodiesVerified: pinnedInputs,
  fsCodes: codes, sharedBytes: 197056, sourceFunctionProof: 'Earlier independent37-body authentication inherited; not rerun',
  obligationsShape: Object.keys(json['OBLIGATIONS.json']), capsShape: Object.keys(json['CAPS.json']),
  processedBytes: processed, elapsedMs: performance.now() - started, processorVersion: process.version,
};
for (const [name, value] of [['RESULT.json', result], ['packet-readable.data', json]]) {
  const text = JSON.stringify(value, null, 2) + '\n';
  assert(Buffer.byteLength(text) < 1024 * 1024);
  writeFileSync(`${own}${name}`, text, { flag: 'wx' });
}
console.log(JSON.stringify({ packet: 12, sealedOutputs: 11, pinnedInputs: pinnedInputs.length, codes: 28, sharedBytes: 197056, processedBytes: processed, elapsedMs: performance.now() - started }));
