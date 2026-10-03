import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes } from "safe-bash-contracts";
import { settings } from "safe-bash-io-engine/commands/archive/internal";
import { decodeZipEntry, makeZipEntry, readZipIndexedArchive, writeZipArchive, type ZipMetadataSpool } from "./zip-format.js";

function backing() {
  const active = new Set<ZipMetadataSpool>();
  let peak = 0, maximum = 0;
  return {
    active,
    get peak() { return peak; },
    get maximum() { return maximum; },
    async create(): Promise<ZipMetadataSpool> {
      let bytes = new Uint8Array(), sealed = false;
      const spool: ZipMetadataSpool = {
        async append(chunk) {
          assert.equal(sealed, false);
          maximum = Math.max(maximum, chunk.length);
          const next = new Uint8Array(bytes.length + chunk.length);
          next.set(bytes); next.set(chunk, bytes.length); bytes = next;
        },
        async finish() {
          assert.equal(sealed, false); sealed = true;
          return { size: bytes.length, async read(offset, length) {
            assert.ok(active.has(spool));
            maximum = Math.max(maximum, length);
            return bytes.slice(offset, offset + length);
          } };
        },
        async close() { active.delete(spool); bytes = new Uint8Array(); },
      };
      active.add(spool); peak = Math.max(peak, active.size);
      return spool;
    },
  };
}

const signal = new AbortController().signal;
const limits = settings({ limits: { chunkSize: 512 } });
async function fixture(count: number, same = false) {
  const entries = [];
  for (let i = 0; i < count; i++) entries.push(await makeZipEntry(same ? "member" : `file-${i}`, Uint8Array.of(same ? 7 : i % 251), {
    modified: new Date(2026, 0, 1), mode: 0o100644, directory: false, symlink: false,
  }, limits, signal, 0));
  const bytes = await writeZipArchive({ entries, comment: new Uint8Array() }, limits, signal);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const central = view.getUint32(bytes.length - 6, true);
  const records: Uint8Array[] = [];
  for (let offset = central; offset < bytes.length - 22;) {
    const next = offset + 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    records.push(bytes.slice(offset, next)); offset = next;
  }
  let offset = central;
  for (const record of records.reverse()) { bytes.set(record, offset); offset += record.length; }
  return bytes;
}

test("indexed ZIP metadata uses bounded backing passes and lazy entries in central order", async () => {
  const bytes = await fixture(100), storage = backing();
  const archive = await readZipIndexedArchive({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) }, limits, signal, storage.create);
  try {
    assert.equal(Array.isArray(archive.entries), false);
    assert.equal(archive.entries.length, 100);
    assert.equal(storage.active.size, 1);
    assert.ok(storage.peak <= 3, `active backing files ${storage.peak}`);
    assert.ok(storage.maximum <= 512, `largest metadata operation ${storage.maximum}`);
    const entry = await archive.entries.get(7);
    assert.equal(entry.name, "file-92");
    assert.equal(typeof entry.compressedOffset, "number");
    assert.deepEqual(await collectBytes(decodeZipEntry(entry, limits, signal), { signal }), Uint8Array.of(92));
    const parallel = await Promise.all([0, 99, 45, 4, 83].map(index => archive.entries.get(index)));
    assert.deepEqual(parallel.map(entry => entry.name), ["file-99", "file-0", "file-54", "file-95", "file-16"]);
    let count = 0;
    for await (const current of archive.entries) assert.equal(current.name, `file-${99 - count++}`);
    assert.equal(count, 100);
    await assert.rejects(archive.entries.get(100), /index/);
  } finally { await archive.close(); }
  assert.equal(storage.active.size, 0);
  await assert.rejects(archive.entries.get(0), /closed/);
});

test("indexed ZIP metadata closes every owned backing on validation failure", async () => {
  const bytes = await fixture(50), storage = backing();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const central = view.getUint32(bytes.length - 6, true);
  view.setUint32(central + 42, 0xffffffff, true);
  await assert.rejects(readZipIndexedArchive({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) }, limits, signal, storage.create));
  assert.equal(storage.active.size, 0);
});


test("indexed ZIP external span sorting rejects overlapping aliases and retires runs", async () => {
  const bytes = await fixture(50, true), storage = backing();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const central = view.getUint32(bytes.length - 6, true);
  const second = central + 46 + view.getUint16(central + 28, true) + view.getUint16(central + 30, true) + view.getUint16(central + 32, true);
  view.setUint32(second + 42, view.getUint32(central + 42, true), true);
  await assert.rejects(readZipIndexedArchive({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) }, limits, signal, storage.create), /overlapping spans/);
  assert.equal(storage.active.size, 0);
  assert.ok(storage.peak <= 3);
});

test("indexed ZIP cancellation while sorting retires every backing and preserves reason", async () => {
  const bytes = await fixture(100), storage = backing(), controller = new AbortController();
  let appends = 0;
  const create = async () => {
    const spool = await storage.create();
    return { ...spool, async append(bytes: Uint8Array) {
      await spool.append(bytes);
      if (++appends === 102) controller.abort(false);
    } };
  };
  await assert.rejects(readZipIndexedArchive({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) }, limits, controller.signal, create), reason => reason === false);
  assert.equal(storage.active.size, 0);
});
