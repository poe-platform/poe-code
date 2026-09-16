import assert from "node:assert/strict";
import test from "node:test";
import oracle from "./fixtures/zip-count-infozip.json" with { type: "json" };
import { zip64Directory } from "../../src/commands/archive/zip/zip64.js";
import { settings } from "../../src/commands/archive/internal.js";
import { streamZipArchive, writeZipArchive, readZipArchive, type ZipEntry } from "../../src/commands/archive/zip-format.js";

for (const capture of oracle.cases) {
  test(`ZIP directory admits native ${capture.count}-member boundary records`, () => {
    const bytes = Buffer.alloc(capture.length);
    Buffer.from(capture.footer, "hex").copy(bytes, bytes.length - capture.footer.length / 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const directory = zip64Directory(view, bytes.length - 22, settings({ limits: { maxMembers: capture.count } }));
    assert.equal(directory.members, capture.count);
    assert.equal(directory.centralEnd, bytes.length - capture.footer.length / 2);
    assert.ok(directory.centralStart < directory.centralEnd);
    assert.throws(() => zip64Directory(view, bytes.length - 22, settings({ limits: { maxMembers: capture.count - 1 } })), /member limit/);
  });
}

test("ZIP serialization admits classic maximum member count before emitting data", async t => {
  // Scheduling is mocked so this count-admission case does not take 65,535
  // host event-loop turns. The actual entries and metadata remain unmocked.
  t.mock.method(globalThis, "setImmediate", (callback: () => void) => queueMicrotask(callback));
  const count = 65535;
  const entries: ZipEntry[] = Array.from({ length: count }, (_, index) => ({
    name: String(index), data: new Uint8Array(), size: 0, method: 0, crc32: 0,
    modified: new Date("2024-01-02T03:04:06Z"), mode: 0o100644, directory: false, symlink: false,
  }));
  const stream = streamZipArchive({ entries, comment: new Uint8Array() }, settings({ limits: { maxMembers: count } }), new AbortController().signal);
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const first = await iterator.next();
    assert.equal(first.done, false);
    assert.equal(Buffer.from(first.value!).readUInt32LE(0), 0x04034b50);
  } finally { await iterator.return?.(); }
});

test("classic maximum count in comment bytes does not masquerade as a ZIP64 end record", async () => {
  const limits = settings({});
  const signal = new AbortController().signal;
  const comment = Buffer.alloc(22);
  comment.writeUInt32LE(0x06054b50, 0);
  comment.writeUInt16LE(65535, 8);
  comment.writeUInt16LE(65535, 10);
  const bytes = await writeZipArchive({ entries: [], comment }, limits, signal);
  const archive = await readZipArchive(bytes, limits, signal);
  assert.equal(archive.entries.length, 0);
  assert.deepEqual(Buffer.from(archive.comment), comment);
});
