import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { sha, readJson, checkPacket, composition, repository, directory, packet } from './admission.mjs';

export const objectHash = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');

export function authenticateArchive() {
  const { bindings } = checkPacket();
  const encoded = fs.readFileSync(path.join(repository, bindings.archive.path));
  assert.equal(encoded.length, bindings.archive.bytes); assert.equal(sha(encoded), bindings.archive.sha256);
  const gzip = Buffer.from(encoded.toString(), 'base64'); assert.equal(sha(gzip), bindings.archive.gzipSha256);
  const raw = JSON.parse(gunzipSync(gzip, { maxOutputLength: bindings.archive.decodeBound }));
  assert.equal(sha(JSON.stringify(raw.source.inputs)), bindings.selected.selectedInputTableSha256);
  assert.equal(raw.source.inputs.length, 268);
  const packageBytes = Buffer.from(raw.pack.base64, 'base64');
  assert.equal(packageBytes.length, bindings.package.bytes); assert.equal(sha(packageBytes), bindings.package.sha256);
  assert.equal(sha(JSON.stringify(raw.fullInstalledBefore)), bindings.package.installedManifestSha256);
  assert.equal(Object.values(raw.fullInstalledBefore).filter(row => row.kind === 'file').length, 858);
  const selected = new Map();
  for (const row of raw.source.inputs) {
    assert.ok(row.path.startsWith('src/') || ['README.md', 'package.json', 'tsconfig.json', 'tsconfig.build.json'].includes(row.path));
    assert.ok(!row.path.split('/').some(part => ['..', '.', '', 'AGENTS.md', 'xan', 'yq'].includes(part)), 'FORBIDDEN_SELECTED_PATH');
    const bytes = Buffer.from(raw.source.selectedBytes[row.path], 'base64');
    assert.equal(objectHash('blob', bytes), row.blob); assert.equal(sha(bytes), row.sha256); assert.equal(bytes.length, row.bytes); assert.equal(row.mode, '100644');
    assert.equal(selected.has(row.path), false); selected.set(row.path, bytes);
  }
  assert.deepEqual(Object.keys(raw.source.selectedBytes).sort(), [...selected.keys()].sort());
  for (const row of raw.source.commits) {
    const bytes = Buffer.from(row.base64, 'base64'); assert.equal(objectHash('commit', bytes), row.revision);
    assert.equal(/^tree ([a-f0-9]{40})$/mu.exec(bytes.toString())?.[1], row.tree);
  }
  const trees = new Map();
  function parseTree(row) {
    const bytes = Buffer.from(row.base64, 'base64'); assert.equal(objectHash('tree', bytes), row.oid);
    const entries = []; let offset = 0;
    while (offset < bytes.length) {
      const space = bytes.indexOf(32, offset), zero = bytes.indexOf(0, space);
      assert.ok(space > offset && zero > space && zero + 21 <= bytes.length);
      entries.push({ mode: bytes.subarray(offset, space).toString(), name: bytes.subarray(space + 1, zero).toString(), oid: bytes.subarray(zero + 1, zero + 21).toString('hex') }); offset = zero + 21;
    }
    const sorted = [...entries].sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === '40000' ? '/' : '')), Buffer.from(right.name + (right.mode === '40000' ? '/' : ''))));
    assert.deepEqual(entries, sorted, 'CANONICAL_TREE_ORDER');
    trees.set(row.oid, entries);
  }
  for (const row of [...raw.source.reachableTrees, ...raw.source.reconstructedTrees]) parseTree(row);
  const author = bindings.receipts.find(row => row.path.endsWith('coherent78-shell-author-20260828/MANIFEST.json'));
  const authorBytes = fs.readFileSync(path.join(repository, author.path)); assert.equal(sha(authorBytes), author.sha256);
  const manifest = JSON.parse(authorBytes);
  assert.deepEqual(manifest.inputs, raw.source.inputs);
  const overrides = new Map(raw.source.componentTable.map(row => [row.path, row.blob]));
  assert.equal(overrides.size, 5);
  function overlay(tree, prefix = '') {
    assert.ok(trees.has(tree), 'TREE_WITNESS_MISSING');
    const entries = trees.get(tree).map(entry => {
      const name = prefix + entry.name;
      if (overrides.has(name)) return { ...entry, oid: overrides.get(name) };
      if (entry.mode === '40000' && [...overrides.keys()].some(key => key.startsWith(name + '/'))) return { ...entry, oid: overlay(entry.oid, name + '/') };
      return entry;
    });
    return objectHash('tree', Buffer.concat(entries.map(entry => Buffer.concat([Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(entry.oid, 'hex')]))));
  }
  assert.equal(overlay(manifest.baseTree), composition);
  assert.equal(manifest.composedTree, composition);
  return { raw, selected, packageBytes, bindings };
}

export function storedRequests(raw, bindings) {
  return [
    ...['CASES.json', 'FIXTURES.json', 'SCHEMA.json', 'BINDINGS.json', 'MANIFEST.json', 'EXECUTION-RECIPE.md', 'READY.md', 'verify.mjs'].map(name => ({ expression: `${packet}:tests/integration/priority-command-workflows-20260828/npm-pin-rebinding-v2/p16-trace-repair-v4/${name}`, kind: 'blob', sha256: sha(fs.readFileSync(path.join(directory, name))) })),
    ...bindings.receipts.map(row => ({ expression: `${row.commit}:${row.path}`, kind: 'blob', sha256: row.sha256 })),
    { expression: `${bindings.authoritativePriority.commit}:${bindings.authoritativePriority.path}`, kind: 'blob', sha256: bindings.authoritativePriority.sha256 },
    { expression: `${bindings.archive.commit}:${bindings.archive.path}`, kind: 'blob', sha256: bindings.archive.sha256 },
    ...raw.source.inputs.map(row => ({ expression: `${row.revision}:${row.path}`, kind: 'blob', oid: row.blob, sha256: row.sha256 })),
    ...raw.source.commits.map(row => ({ expression: row.revision, kind: 'commit', oid: row.revision, sha256: sha(Buffer.from(row.base64, 'base64')) })),
    ...raw.source.reachableTrees.map(row => ({ expression: row.oid, kind: 'tree', oid: row.oid, sha256: sha(Buffer.from(row.base64, 'base64')) })),
  ];
}

export function verifyStoredBatch(requests, bytes) {
  let offset = 0;
  const rows = [];
  for (const request of requests) {
    const end = bytes.indexOf(10, offset); assert.ok(end >= 0);
    const header = bytes.subarray(offset, end).toString();
    const match = /^([a-f0-9]{40}) (blob|tree|commit) ([0-9]+)$/u.exec(header); assert.ok(match, header);
    const length = Number(match[3]), content = bytes.subarray(end + 1, end + 1 + length);
    assert.equal(content.length, length); assert.equal(bytes[end + 1 + length], 10); offset = end + 2 + length;
    assert.equal(match[2], request.kind); assert.equal(objectHash(request.kind, content), match[1]);
    if (request.oid) assert.equal(match[1], request.oid);
    assert.equal(sha(content), request.sha256);
    rows.push({ ...request, oid: match[1], bytes: length, verified: true });
  }
  assert.equal(offset, bytes.length);
  return rows;
}
