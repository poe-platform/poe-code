import { readFileSync, lstatSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const own = 'tests/commands/node-worker-independent-20260828/';
const proposal = 'tests/commands/node-design-20260828/worker-resource-quiescence-proposal-v1/';
const start = performance.now();
let processed = 0;
function charge(bytes) {
  processed += bytes;
  assert(processed <= 64 * 1024 * 1024 && performance.now() - start < 60000);
}
function read(path) {
  const parts = path.split('/');
  for (let index = 1; index <= parts.length; index++) {
    assert(!lstatSync(parts.slice(0, index).join('/')).isSymbolicLink());
  }
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
function objectHash(kind, bytes) {
  return hash(Buffer.concat([Buffer.from(`${kind} ${bytes.length}\0`), bytes]), 'sha1');
}
function parseTree(bytes) {
  const entries = [];
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    const nul = bytes.indexOf(0, space + 1);
    assert(space > offset && nul > space && nul + 21 <= bytes.length);
    entries.push({ mode: bytes.subarray(offset, space).toString(), name: bytes.subarray(space + 1, nul), id: bytes.subarray(nul + 1, nul + 21).toString('hex') });
    offset = nul + 21;
  }
  assert.equal(offset, bytes.length);
  return entries;
}
const inventories = [];
for (const [label, commit] of [['author', '53e5bffd5e808b198cfda2ff3a5cedccf88990e9'], ['root', '700651e5ec6f50435a0298845c411a8f2a5a386f']]) {
  const commitBytes = read(`${own}${label}-commit.data`);
  assert.equal(objectHash('commit', commitBytes), commit);
  const inventory = read(`${own}${label}-inventory.data`);
  const records = inventory.toString('utf8').split('\0');
  assert.equal(records.pop(), '');
  for (const record of records) {
    const tab = record.indexOf('\t');
    const [mode, kind, blob] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    assert.equal(mode, '100644');
    assert.equal(kind, 'blob');
    const bytes = read(path);
    assert.equal(objectHash('blob', bytes), blob, path);
    inventories.push({ commit, path, bytes: bytes.length, blob, sha256: hash(bytes) });
  }
}
const bindings = JSON.parse(read(`${proposal}SOURCES.json`));
const manifestBytes = read(bindings.frozenEngine.sourceManifestPath);
assert.equal(hash(manifestBytes), bindings.frozenEngine.sourceManifestSha256);
const manifest = JSON.parse(manifestBytes);
const encoded = read(bindings.frozenEngine.archivePath);
assert.equal(encoded.length, bindings.frozenEngine.archiveEncodedBytes);
assert.equal(hash(encoded), bindings.frozenEngine.archiveEncodedSha256);
const compressed = Buffer.from(encoded.toString(), 'base64');
assert.equal(hash(compressed), manifest.archive.gzipSha256);
const decoded = gunzipSync(compressed, { maxOutputLength: 8 * 1024 * 1024 });
assert.equal(decoded.length, manifest.archive.decodedBytes);
assert.equal(hash(decoded), manifest.archive.decodedSha256);
const archive = JSON.parse(decoded);
const engineCommit = Buffer.from(archive.proof.commitBase64, 'base64');
assert.equal(objectHash('commit', engineCommit), bindings.frozenEngine.commit);
assert.equal(hash(engineCommit), bindings.frozenEngine.commitBodySha256);
const trees = new Map();
const treeShapes = [];
for (const [key, record] of Object.entries(archive.proof.trees)) {
  const possibleIds = [key, ...Object.values(record)].filter(value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value));
  const matches = [];
  for (const [field, value] of Object.entries(record)) {
    if (typeof value !== 'string' || value.length < 44) continue;
    const bytes = Buffer.from(value, 'base64');
    const id = objectHash('tree', bytes);
    if (possibleIds.includes(id)) matches.push({ field, bytes, id });
  }
  assert.equal(matches.length, 1, `raw tree shape ${JSON.stringify(Object.keys(record))}`);
  const match = matches[0];
  assert(!trees.has(match.id));
  trees.set(match.id, parseTree(match.bytes));
  treeShapes.push({ id: match.id, rawField: match.field, keys: Object.keys(record) });
}
assert.equal(trees.size, 13);
function member(root, components) {
  let current = root;
  for (const component of components) {
    const entries = trees.get(current);
    assert(entries, `missing tree ${current}`);
    const matches = entries.filter(entry => entry.name.equals(Buffer.from(component)));
    assert.equal(matches.length, 1, component);
    current = matches[0].id;
  }
  return current;
}
const rootTree = engineCommit.toString().match(/^tree ([a-f0-9]{40})\n/)[1];
assert.equal(rootTree, bindings.frozenEngine.rootTree);
assert.equal(member(rootTree, ['packages', 'safejs']), bindings.frozenEngine.packageTree);
const files = new Map();
for (const entry of archive.files) {
  assert(!files.has(entry.path));
  files.set(entry.path, Buffer.from(entry.base64, 'base64'));
}
assert.equal(files.size, 66);
for (const expected of manifest.files) {
  const bytes = files.get(expected.path);
  assert(bytes);
  assert.equal(bytes.length, expected.bytes);
  assert.equal(hash(bytes), expected.sha256);
  assert.equal(objectHash('blob', bytes), expected.gitBlob);
  assert.equal(member(bindings.frozenEngine.packageTree, expected.path.split('/')), expected.gitBlob);
}
const bodies = [];
for (const group of bindings.sourceGroups) {
  for (const entry of group.members) {
    const bytes = files.get(entry.path);
    assert.equal(hash(bytes), entry.sha256);
    const lines = bytes.toString().split('\n');
    for (const body of entry.bodies) {
      const selected = lines.slice(body.bodyOpeningLine - 1, body.lines[1]);
      selected[0] = selected[0].slice(selected[0].lastIndexOf('{'));
      selected[selected.length - 1] = selected.at(-1).slice(0, selected.at(-1).lastIndexOf('}') + 1);
      assert.equal(hash(Buffer.from(selected.join('\n'))), body.bodySha256, body.name);
      bodies.push({ group: group.id, path: entry.path, ...body });
    }
  }
}
assert.equal(bodies.length, 37);
const rpc = JSON.parse(read(`${proposal}RPC.json`));
const obligations = JSON.parse(read(`${proposal}root-selection-v1/OPEN-OBLIGATIONS.json`));
assert.equal(rpc.limits.globalHeaderBytes + rpc.limits.slots * (rpc.limits.slotHeaderBytes + rpc.limits.slotPayloadBytes), 197056);
assert.equal(obligations.obligations.length, 8);
assert.deepEqual(obligations.obligations.flatMap(entry => entry.mapsTo).sort(), Array.from({ length: 8 }, (_, index) => `WRQ0${index + 1}`));
for (const name of ['operationSequenceMax', 'framesAllDirectionsMax', 'eventEpochMax']) assert(rpc.limits[name] < 2 ** 31);
const excerpts = [];
const ranges = {
  'src/run.ts': [[162, 190], [370, 420], [477, 501]],
  'src/interp/host-bridge.ts': [[116, 158], [247, 267], [290, 309], [365, 400], [450, 521], [719, 746], [805, 885]],
  'src/interp/jobs.ts': [[1, 245]],
  'src/interp/cancel.ts': [[1, 175]],
  'src/interp/promise-tracker.ts': [[1, 140]],
};
for (const [path, sections] of Object.entries(ranges)) {
  const lines = files.get(path).toString().split('\n');
  for (const [first, last] of sections) excerpts.push({ path, first, text: lines.slice(first - 1, last).join('\n') });
}
const result = { role: 'DATA authentication/arithmetic only; zero engine/Worker executions', tool: { version: process.version, execPath: process.execPath, binaryHash: 'not reread; not runtime qualification' }, inventories, archive: manifest.archive, engineCommit: bindings.frozenEngine.commit, rootTree, treeShapes, verifiedMembers: files.size, bodies, obligations: obligations.obligations.map(entry => ({ id: entry.id, mapsTo: entry.mapsTo })), sharedBytes: 197056, sequenceArithmeticNotProtocolProof: true, processedBytes: processed, elapsedMs: performance.now() - start };
for (const [name, value] of [['RESULT-v1.json', result], ['source-excerpts.data', excerpts]]) {
  const text = JSON.stringify(value, null, 2) + '\n';
  assert(Buffer.byteLength(text) < 1024 * 1024);
  writeFileSync(`${own}${name}`, text, { flag: 'wx' });
}
console.log(JSON.stringify({ verifiedMembers: files.size, verifiedTrees: trees.size, verifiedBodies: bodies.length, obligations: 8, sharedBytes: 197056, processedBytes: processed, elapsedMs: performance.now() - start }));
