import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const objectId = (kind, bytes) => crypto.createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export function pathname(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 1048576, 'pathname domain');
  assert.ok(!bytes.includes(0), 'pathname NUL');
  const text = decoder.decode(bytes);
  assert.ok(Buffer.from(text).equals(bytes), 'UTF8 roundtrip');
  assert.ok(text.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'relative canonical components');
  return text;
}
export function parseTree(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 16 * 1024 * 1024, 'tree capture limit');
  const entries = [], names = new Set();
  let offset = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf(0, offset);
    assert.ok(end >= offset, 'truncated record');
    const tab = bytes.indexOf(9, offset);
    assert.ok(tab > offset && tab < end, 'missing header delimiter');
    const header = bytes.subarray(offset, tab);
    assert.ok(header.every(byte => byte < 128), 'ASCII header');
    const match = /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40})$/.exec(header.toString('ascii'));
    assert.ok(match && (match[1] === '160000' ? match[2] === 'commit' : match[2] === 'blob'), 'header domain');
    const pathBytes = Buffer.from(bytes.subarray(tab + 1, end));
    const name = pathname(pathBytes), key = pathBytes.toString('hex');
    assert.ok(!names.has(key), 'duplicate path'); names.add(key);
    entries.push({ mode: match[1], type: match[2], blob: match[3], path: name, pathBytes });
    assert.ok(entries.length <= 100000, 'record ceiling'); offset = end + 1;
  }
  return entries;
}
export function entryBytes(entry) {
  const bytes = entry.pathBytes ? Buffer.from(entry.pathBytes) : Buffer.from(entry.path);
  assert.equal(pathname(bytes), entry.path);
  return bytes;
}
export function treeHash(entries) {
  const root = new Map();
  for (const entry of entries) {
    const bytes = entryBytes(entry), components = [];
    let start = 0;
    for (let offset = 0; offset <= bytes.length; offset++) if (offset === bytes.length || bytes[offset] === 47) { components.push(Buffer.from(bytes.subarray(start, offset))); start = offset + 1; }
    let directory = root;
    for (const name of components.slice(0, -1)) {
      const key = name.toString('hex');
      if (!directory.has(key)) directory.set(key, { name, children: new Map() });
      assert.ok(directory.get(key).children, 'file/directory conflict'); directory = directory.get(key).children;
    }
    const name = components.at(-1), key = name.toString('hex');
    assert.ok(!directory.has(key), 'duplicate or directory/file conflict');
    assert.match(entry.mode, /^(100644|100755|120000|160000)$/); assert.match(entry.blob, /^[0-9a-f]{40}$/);
    directory.set(key, { name, mode: entry.mode, blob: entry.blob });
  }
  function visit(directory) {
    const children = [...directory.values()].map(entry => entry.children ? { name: entry.name, mode: '40000', blob: visit(entry.children), directory: true } : entry);
    children.sort((left, right) => Buffer.compare(Buffer.concat([left.name, left.directory ? Buffer.from('/') : Buffer.alloc(0)]), Buffer.concat([right.name, right.directory ? Buffer.from('/') : Buffer.alloc(0)])));
    return objectId('tree', Buffer.concat(children.map(entry => Buffer.concat([Buffer.from(entry.mode + ' '), entry.name, Buffer.from([0]), Buffer.from(entry.blob, 'hex')]))));
  }
  return visit(root);
}
export function verifyProjection(inputs, baseEntries, candidateEntries, metadata) {
  const selected = new Set();
  for (const entry of inputs) {
    const bytes = entryBytes(entry), key = bytes.toString('hex');
    assert.ok(!selected.has(key), 'duplicate selected path'); selected.add(key);
    assert.ok(!entry.path.split('/').includes('AGENTS.md'), 'instructions are metadata only');
    assert.equal(entry.mode, '100644'); assert.match(entry.blob, /^[0-9a-f]{40}$/);
    const census = entry.revision === metadata.candidate ? candidateEntries : baseEntries;
    if (entry.revision === metadata.candidate || entry.revision === metadata.baseManifest.base) {
      const found = census.find(item => entryBytes(item).equals(bytes));
      assert.ok(found, 'selected path absent'); assert.equal(found.mode, entry.mode); assert.equal(found.blob, entry.blob);
    } else assert.ok(metadata.baseManifest.inputs.some(item => item.path === entry.path && item.blob === entry.blob && item.revision === entry.revision), 'unbound override');
  }
  return inputs;
}
export function batchObjects(buffer, requests) {
  assert.ok(Buffer.isBuffer(buffer) && buffer.length <= 16 * 1024 * 1024);
  assert.equal(new Set(requests).size, requests.length, 'duplicate object request');
  let offset = 0; const result = new Map();
  for (const request of requests) {
    assert.match(request, /^[0-9a-f]{40}$/);
    const newline = buffer.indexOf(10, offset); assert.ok(newline >= offset, 'truncated object header');
    const header = buffer.subarray(offset, newline); assert.ok(header.every(byte => byte < 128));
    const match = /^([0-9a-f]{40}) (blob|tree|commit) (0|[1-9][0-9]*)$/.exec(header.toString('ascii')); assert.ok(match, 'object header domain');
    const size = Number(match[3]); assert.ok(Number.isSafeInteger(size) && size <= buffer.length - newline - 2, 'truncated object payload');
    const payload = Buffer.from(buffer.subarray(newline + 1, newline + 1 + size));
    assert.equal(match[1], request); assert.equal(objectId(match[2], payload), request); assert.equal(buffer[newline + 1 + size], 10);
    result.set(request, { objectId: request, kind: match[2], payload }); offset = newline + 2 + size;
  }
  assert.equal(offset, buffer.length, 'extra object bytes'); return result;
}
