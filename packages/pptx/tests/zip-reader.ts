import assert from "node:assert/strict";
import { crc32, inflateRawSync } from "node:zlib";

/** Independent classic-ZIP assertion reader for bounded, original test archives. */
export function inspectZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 4, true), 0);
  assert.equal(view.getUint16(end + 6, true), 0);
  assert.equal(view.getUint16(end + 20, true), 0);
  const count = view.getUint16(end + 10, true);
  assert.equal(view.getUint16(end + 8, true), count);
  let central = view.getUint32(end + 16, true);
  const centralStart = central;
  assert.equal(central + view.getUint32(end + 12, true), end);
  let nextLocal = 0;
  const entries = [];
  for (let index = 0; index < count; index++) {
    assert.equal(view.getUint32(central, true), 0x02014b50);
    const flags = view.getUint16(central + 8, true);
    const method = view.getUint16(central + 10, true);
    const checksum = view.getUint32(central + 16, true);
    const compressedSize = view.getUint32(central + 20, true);
    const size = view.getUint32(central + 24, true);
    const nameSize = view.getUint16(central + 28, true);
    const extraSize = view.getUint16(central + 30, true);
    const commentSize = view.getUint16(central + 32, true);
    const local = view.getUint32(central + 42, true);
    assert.equal(local, nextLocal);
    assert.equal(view.getUint32(local, true), 0x04034b50);
    assert.equal(view.getUint16(local + 6, true), flags);
    assert.equal(flags & 9, 0);
    assert.equal(view.getUint16(local + 8, true), method);
    assert.equal(view.getUint16(local + 4, true), method === 8 ? 20 : 10);
    assert.equal(view.getUint16(central + 6, true), view.getUint16(local + 4, true));
    assert.equal(view.getUint32(central + 12, true), view.getUint32(local + 10, true));
    assert.equal(view.getUint16(central + 34, true), 0);
    assert.equal(view.getUint32(local + 14, true), checksum);
    assert.equal(view.getUint32(local + 18, true), compressedSize);
    assert.equal(view.getUint32(local + 22, true), size);
    assert.equal(view.getUint16(local + 26, true), nameSize);
    const rawName = bytes.slice(central + 46, central + 46 + nameSize);
    assert.deepEqual(bytes.slice(local + 30, local + 30 + nameSize), rawName);
    const name = Buffer.from(rawName).toString("utf8");
    assert.deepEqual(Buffer.from(name), Buffer.from(rawName));
    const start = local + 30 + nameSize + view.getUint16(local + 28, true);
    const compressed = bytes.slice(start, start + compressedSize);
    assert(method === 0 || method === 8);
    const payload = method === 8 ? new Uint8Array(inflateRawSync(compressed)) : compressed;
    assert.equal(payload.length, size);
    assert.equal(crc32(payload), checksum);
    entries.push({ name, payload, compressed, method, flags, checksum });
    nextLocal = start + compressedSize;
    central += 46 + nameSize + extraSize + commentSize;
  }
  assert.equal(nextLocal, centralStart);
  assert.equal(central, end);
  return entries;
}
