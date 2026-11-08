import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
export const errorRecord = error => ({ name: error?.name, message: String(error?.message ?? error), code: error?.code ?? null });
export const within = (root, filename) => {
  const suffix = relative(root, filename);
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
};
export function contained(root, filename) {
  assert.equal(typeof filename, 'string');
  assert.ok(!filename.includes('\0') && !filename.split(/[\\/]/u).includes('..'), 'unsafe path');
  const approved = realpathSync(root);
  const rootSpelling = resolve(root);
  const requested = resolve(rootSpelling, filename);
  const declared = within(rootSpelling, requested) ? resolve(approved, relative(rootSpelling, requested)) : requested;
  assert.ok(within(approved, declared), 'path outside selected root');
  let current = approved;
  for (const component of relative(approved, declared).split(sep).filter(Boolean)) {
    current = resolve(current, component);
    assert.ok(!lstatSync(current).isSymbolicLink(), 'symlink component forbidden');
  }
  assert.equal(realpathSync(declared), declared, 'path resolution changed');
  return declared;
}
export function readBound(root, filename, expected, cap = 256 * 1024 * 1024, collect = true) {
  const resolved = contained(root, filename);
  const descriptor = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor);
    assert.ok(before.isFile() && before.size <= cap, 'regular file/byte cap');
    if (expected?.bytes !== undefined) assert.equal(before.size, expected.bytes, 'bound length changed');
    const digest = createHash('sha256'), chunks = [], buffer = Buffer.alloc(65536);
    let bytes = 0;
    while (true) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, cap - bytes + 1), null);
      if (!count) break;
      bytes += count;
      assert.ok(bytes <= cap, 'read cap');
      digest.update(buffer.subarray(0, count));
      if (collect) chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fstatSync(descriptor), named = lstatSync(resolved);
    assert.ok(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && bytes === before.size && named.ino === after.ino && named.dev === after.dev && named.isFile(), 'file mutated during read');
    assert.equal(contained(root, filename), resolved);
    const sha256 = digest.digest('hex');
    if (expected?.sha256) assert.equal(sha256, expected.sha256, 'bound hash changed');
    return { path: resolved, bytes, sha256, ...(collect ? { data: Buffer.concat(chunks) } : {}) };
  } finally { closeSync(descriptor); }
}
export const jsonBytes = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
export async function writeFrame(stream, value, cap = 64 * 1024 * 1024) {
  const bytes = Buffer.from(JSON.stringify(value));
  assert.ok(bytes.length <= cap, 'frame write cap');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  for (const chunk of [header, bytes]) await new Promise((resolveWrite, rejectWrite) => stream.write(chunk, error => error ? rejectWrite(error) : resolveWrite()));
}
export async function readFrames(stream, consume, { bytes: cap = 64 * 1024 * 1024, events: eventCap = 4096, onChunk = () => {} } = {}) {
  let total = 0, header = Buffer.alloc(4), headerBytes = 0, body, bodyBytes = 0, events = 0;
  for await (const chunk of stream) {
    onChunk(chunk);
    total += chunk.length;
    assert.ok(total <= cap, 'transport byte cap');
    let offset = 0;
    while (offset < chunk.length) {
      if (!body) {
        const count = Math.min(4 - headerBytes, chunk.length - offset);
        chunk.copy(header, headerBytes, offset, offset + count);
        headerBytes += count; offset += count;
        if (headerBytes !== 4) continue;
        const length = header.readUInt32BE();
        assert.ok(length > 0 && length <= cap - (total - chunk.length + offset), `declared frame length cap: header=${header.toString('hex')}, length=${length}, cap=${cap}`);
        assert.ok(++events <= eventCap, 'event count cap');
        body = Buffer.alloc(length); bodyBytes = 0;
      }
      const count = Math.min(body.length - bodyBytes, chunk.length - offset);
      chunk.copy(body, bodyBytes, offset, offset + count);
      bodyBytes += count; offset += count;
      if (bodyBytes === body.length) {
        const message = jsonBytes(body);
        body = undefined; headerBytes = 0;
        await consume(message);
      }
    }
  }
  assert.ok(!body && headerBytes === 0, `partial frame at EOF: header=${header.subarray(0, headerBytes).toString('hex')}, bodyBytes=${bodyBytes}`);
  return { bytes: total, events };
}
