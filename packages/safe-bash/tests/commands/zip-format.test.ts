import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import zip64Oracle from "./fixtures/zip64-infozip.json" with { type: "json" };
import { collectBytes, isPathWithin, resolvePath } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { DEFAULT_ARCHIVE_LIMITS as limits } from "../../src/commands/archive/internal.js";
import { zip64Fields, stripZip64 } from "../../src/commands/archive/zip/zip64.js";
import { crc32, decodeZipEntry, makeZipEntry, readZipArchive, writeZipArchive, streamZipArchive, updateZipExtras } from "../../src/commands/archive/zip-format.js";

const signal = new AbortController().signal;
const text = new TextEncoder();
const modified = new Date("2026-09-10T01:02:04Z");
const attributes = { modified, mode: 0o100640, directory: false, symlink: false };
const collectOptions = { maxBytes: limits.maxEntryBytes };

for (const oracle of zip64Oracle.cases) {
  test(`ZIP64 reads native ${oracle.args.join(" ")} and preserves payload`, async () => {
    const bytes = Buffer.from(oracle.archive, "base64");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), oracle.sha256);
    if (oracle.unzipStatus !== 0) {
      assert.equal(oracle.unzipStatus, 2);
      await assert.rejects(readZipArchive(bytes, limits, signal));
      return;
    }
    const archive = await readZipArchive(bytes, limits, signal);
    const bodies = await Promise.all(archive.entries.map(entry => collectBytes(decodeZipEntry(entry, limits, signal), collectOptions)));
    assert.deepEqual(Buffer.concat(bodies), Buffer.from(oracle.unzipStdout, "base64"));
  });
}

function extra(identifier: number, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(4 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, identifier, true);
  view.setUint16(2, data.length, true);
  bytes.set(data, 4);
  return bytes;
}

function fixture(options: {
  name?: Uint8Array; data?: Uint8Array; compressed?: Uint8Array; method?: number;
  flags?: number; localExtra?: Uint8Array; centralExtra?: Uint8Array;
  descriptor?: "signed" | "unsigned" | undefined; mode?: number; comment?: Uint8Array;
} = {}): Uint8Array {
  const name = options.name ?? text.encode("file.txt");
  const data = options.data ?? text.encode("123456789");
  const method = options.method ?? 0;
  const compressed = options.compressed ?? (method === 8 ? deflateRawSync(data) : data);
  const localExtra = options.localExtra ?? new Uint8Array();
  const centralExtra = options.centralExtra ?? localExtra;
  const comment = options.comment ?? new Uint8Array();
  const descriptorSize = options.descriptor === "signed" ? 16 : options.descriptor ? 12 : 0;
  const central = 30 + name.length + localExtra.length + compressed.length + descriptorSize;
  const end = central + 46 + name.length + centralExtra.length;
  const bytes = new Uint8Array(end + 22 + comment.length);
  const view = new DataView(bytes.buffer);
  const flags = (options.flags ?? 0x800) | (options.descriptor ? 8 : 0);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, flags, true);
  view.setUint16(8, method, true);
  view.setUint16(12, 0x5d2a, true);
  if (!options.descriptor) {
    view.setUint32(14, 0xcbf43926, true);
    view.setUint32(18, compressed.length, true);
    view.setUint32(22, data.length, true);
  }
  view.setUint16(26, name.length, true);
  view.setUint16(28, localExtra.length, true);
  bytes.set(name, 30);
  bytes.set(localExtra, 30 + name.length);
  bytes.set(compressed, 30 + name.length + localExtra.length);
  if (options.descriptor) {
    let offset = central - descriptorSize;
    if (options.descriptor === "signed") { view.setUint32(offset, 0x08074b50, true); offset += 4; }
    view.setUint32(offset, 0xcbf43926, true);
    view.setUint32(offset + 4, compressed.length, true);
    view.setUint32(offset + 8, data.length, true);
  }
  view.setUint32(central, 0x02014b50, true);
  view.setUint16(central + 4, 0x31e, true);
  view.setUint16(central + 6, 20, true);
  view.setUint16(central + 8, flags, true);
  view.setUint16(central + 10, method, true);
  view.setUint16(central + 14, 0x5d2a, true);
  view.setUint32(central + 16, 0xcbf43926, true);
  view.setUint32(central + 20, compressed.length, true);
  view.setUint32(central + 24, data.length, true);
  view.setUint16(central + 28, name.length, true);
  view.setUint16(central + 30, centralExtra.length, true);
  view.setUint32(central + 38, (options.mode ?? 0o100640) * 65536, true);
  bytes.set(name, central + 46);
  bytes.set(centralExtra, central + 46 + name.length);
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end + 8, 1, true);
  view.setUint16(end + 10, 1, true);
  view.setUint32(end + 12, end - central, true);
  view.setUint32(end + 16, central, true);
  view.setUint16(end + 20, comment.length, true);
  bytes.set(comment, end + 22);
  return bytes;
}

function positions(bytes: Uint8Array): { view: DataView; central: number; end: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  return { view, central: view.getUint32(end + 16, true), end };
}

test("ZIP CRC32 uses the standard polynomial and supports incremental chunks", () => {
  assert.equal(crc32(text.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
  assert.equal(crc32(text.encode("56789"), crc32(text.encode("1234"))), 0xcbf43926);
});

test("ZIP reads stored and raw-deflated members with both descriptor forms", async () => {
  for (const method of [0, 8]) for (const descriptor of [undefined, "signed", "unsigned"] as const) {
    const archive = await readZipArchive(fixture({ method, descriptor }), limits, signal);
    assert.equal(archive.entries[0]!.name, "file.txt");
    assert.equal(archive.entries[0]!.mode, 0o100640);
    assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions), text.encode("123456789"));
  }
});

test("ZIP makes entries interoperable with native raw inflate and round-trips metadata", async () => {
  const payload = text.encode("abc".repeat(2048));
  const entry = await makeZipEntry("目录/é.txt", payload, attributes, limits, signal);
  assert.equal(entry.method, 8);
  assert.deepEqual(new Uint8Array(inflateRawSync(entry.data)), payload);
  const archive = await readZipArchive(await writeZipArchive({ entries: [entry], comment: text.encode("hello") }, limits, signal), limits, signal);
  assert.equal(archive.entries[0]!.name, entry.name);
  assert.equal(archive.entries[0]!.modified.getTime(), modified.getTime());
  assert.equal(archive.entries[0]!.mode, attributes.mode);
  assert.deepEqual(archive.comment, text.encode("hello"));
  assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions), payload);
});

test("ZIP preserves unselected compressed payloads and opaque extras without inflating", async () => {
  const bytes = fixture({ method: 8, compressed: Uint8Array.of(255), localExtra: extra(0xbeef, Uint8Array.of(1, 2)), comment: text.encode("kept") });
  const archive = await readZipArchive(bytes, limits, signal);
  bytes.fill(0);
  const reread = await readZipArchive(await writeZipArchive(archive, limits, signal), limits, signal);
  assert.deepEqual(reread.entries[0]!.data, Uint8Array.of(255));
  assert.deepEqual(reread.comment, text.encode("kept"));
  assert.deepEqual(reread.entries[0]!.localExtra, extra(0xbeef, Uint8Array.of(1, 2)));
});

test("ZIP rejects truncated headers, bodies, central records and EOCD", async () => {
  const bytes = fixture({ method: 8 });
  for (let length = 0; length < bytes.length; length++) {
    await assert.rejects(readZipArchive(bytes.subarray(0, length), limits, signal));
  }
});

test("ZIP rejects mismatched central/local metadata and unsupported structures", async () => {
  const mutations: Array<(view: DataView, central: number, end: number) => void> = [
    view => view.setUint16(4, 45, true),
    (view, central) => view.setUint16(central + 6, 45, true),
    view => view.setUint16(6, 0x801, true),
    (view, central) => view.setUint16(central + 8, 0x801, true),
    view => view.setUint16(8, 9, true),
    (view, central) => view.setUint16(central + 10, 9, true),
    view => view.setUint32(14, 123, true),
    view => view.setUint32(18, 8, true),
    view => view.setUint32(22, 8, true),
    view => view.setUint16(10, 1, true),
    view => view.setUint8(30, 65),
    (view, central) => view.setUint32(central + 20, 0xffffffff, true),
    (view, central) => view.setUint32(central + 24, 0xffffffff, true),
    (view, central) => view.setUint32(central + 42, 1, true),
    (view, central) => view.setUint16(central + 34, 1, true),
    (view, central, end) => view.setUint16(end + 4, 1, true),
    (view, central, end) => view.setUint16(end + 8, 2, true),
    (view, central, end) => view.setUint16(end + 10, 0xffff, true),
    (view, central, end) => view.setUint32(end + 12, 0xffffffff, true),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const bytes = fixture();
    const { view, central, end } = positions(bytes);
    mutate(view, central, end);
    await assert.rejects(readZipArchive(bytes, limits, signal), `mutation ${index}`);
  }
  for (const flags of [1, 16, 32, 64, 0x1000, 0x2000]) await assert.rejects(readZipArchive(fixture({ flags }), limits, signal));
  for (const identifier of [1, 0x9901, 0x0017]) await assert.rejects(readZipArchive(fixture({ localExtra: extra(identifier, new Uint8Array()) }), limits, signal));
  await assert.rejects(readZipArchive(fixture({ localExtra: Uint8Array.of(1) }), limits, signal));
});

test("ZIP validates descriptor CRC and sizes", async () => {
  for (const descriptor of ["signed", "unsigned"] as const) {
    const bytes = fixture({ descriptor });
    const { view, central } = positions(bytes);
    view.setUint32(central - 12, 0, true);
    await assert.rejects(readZipArchive(bytes, limits, signal));
  }
});

test("ZIP never normalizes unsafe names or invalid Unicode", async () => {
  for (const name of ["../x", "/x", "a/../x", "./x", "a//x", "x\0y", ""]) {
    await assert.rejects(readZipArchive(fixture({ name: text.encode(name) }), limits, signal), name);
    await assert.rejects(makeZipEntry(name, new Uint8Array(), attributes, limits, signal), name);
  }
  await assert.rejects(readZipArchive(fixture({ name: Uint8Array.of(255) }), limits, signal));
  await assert.rejects(makeZipEntry("\ud800", new Uint8Array(), attributes, limits, signal));
});

test("ZIP supports CP437 and CRC-bound Unicode path extras", async () => {
  assert.equal((await readZipArchive(fixture({ name: Uint8Array.of(0x82), flags: 0 }), limits, signal)).entries[0]!.name, "é");
  const name = text.encode("legacy");
  const unicode = text.encode("目录");
  const data = new Uint8Array(5 + unicode.length);
  data[0] = 1;
  new DataView(data.buffer).setUint32(1, crc32(name), true);
  data.set(unicode, 5);
  assert.equal((await readZipArchive(fixture({ name, flags: 0, localExtra: extra(0x7075, data) }), limits, signal)).entries[0]!.name, "目录");
  data[1] = data[1]! ^ 1;
  await assert.rejects(readZipArchive(fixture({ name, flags: 0, localExtra: extra(0x7075, data) }), limits, signal));
});

test("ZIP checks actual decoded length, CRC and compressed exhaustion", async () => {
  const entry = (await readZipArchive(fixture({ method: 8 }), limits, signal)).entries[0]!;
  for (const bad of [
    { ...entry, crc32: 0 }, { ...entry, size: 8 }, { ...entry, size: 10 },
    { ...entry, data: entry.data.subarray(0, entry.data.length - 1) },
    { ...entry, data: Uint8Array.from([...entry.data, 0]) },
    { ...entry, data: Uint8Array.from([...entry.data, ...entry.data]) },
  ]) await assert.rejects(collectBytes(decodeZipEntry(bad, limits, signal), collectOptions));
  const stored = (await readZipArchive(fixture(), limits, signal)).entries[0]!;
  await assert.rejects(collectBytes(decodeZipEntry({ ...stored, crc32: 0 }, limits, signal), collectOptions));
});

test("ZIP enforces archive, entry, total, member, path and depth caps", async () => {
  const bytes = fixture();
  for (const patch of [{ maxArchiveBytes: bytes.length - 1 }, { maxEntryBytes: 8 }, { maxTotalBytes: 8 }, { maxMembers: 0 }, { maxPathBytes: 7 }]) {
    await assert.rejects(readZipArchive(bytes, { ...limits, ...patch }, signal));
  }
  await assert.rejects(readZipArchive(fixture({ name: text.encode("a/b/c") }), { ...limits, maxDepth: 2 }, signal));
  await assert.rejects(makeZipEntry("x", new Uint8Array(10), attributes, { ...limits, maxEntryBytes: 9 }, signal));
  const entry = await makeZipEntry("x", new Uint8Array(10), attributes, limits, signal);
  await assert.rejects(writeZipArchive({ entries: [entry], comment: new Uint8Array() }, { ...limits, maxArchiveBytes: 20 }, signal));
  await assert.rejects(writeZipArchive({ entries: [entry, { ...entry, name: "y" }], comment: new Uint8Array() }, { ...limits, maxTotalBytes: 19 }, signal));
});

test("ZIP decoder yields owned bounded chunks and cooperatively observes cancellation", async () => {
  const payload = new Uint8Array(256 * 1024).fill(65);
  const entry = await makeZipEntry("x", payload, attributes, limits, signal);
  const chunks: Uint8Array[] = [];
  for await (const chunk of decodeZipEntry(entry, { ...limits, chunkSize: 512 }, signal)) {
    assert.ok(chunk.length <= 512);
    chunks.push(chunk);
  }
  assert.equal(chunks.reduce((total, chunk) => total + chunk.length, 0), payload.length);
  assert.ok(chunks.every(chunk => chunk.every(byte => byte === 65)));
  const controller = new AbortController();
  const reason = new Error("stop ZIP");
  setImmediate(() => controller.abort(reason));
  await assert.rejects(collectBytes(decodeZipEntry(entry, limits, controller.signal), collectOptions), error => error === reason);
  await assert.rejects(readZipArchive(fixture(), limits, controller.signal), error => error === reason);
  await assert.rejects(makeZipEntry("x", payload, attributes, limits, controller.signal), error => error === reason);
  await assert.rejects(writeZipArchive({ entries: [], comment: new Uint8Array() }, limits, controller.signal), error => error === reason);
});

test("ZIP round-trips empty archives, directory and symbolic-link metadata", async () => {
  const empty = await writeZipArchive({ entries: [], comment: text.encode("empty") }, limits, signal);
  assert.equal((await readZipArchive(empty, limits, signal)).entries.length, 0);
  const directory = await makeZipEntry("dir/", new Uint8Array(), { ...attributes, mode: 0o40750, directory: true }, limits, signal);
  const symlink = await makeZipEntry("link", text.encode("dir/file"), { ...attributes, mode: 0o120777, symlink: true }, limits, signal);
  const archive = await readZipArchive(await writeZipArchive({ entries: [directory, symlink], comment: new Uint8Array() }, limits, signal), limits, signal);
  assert.equal(archive.entries[0]!.directory, true);
  assert.equal(archive.entries[1]!.symlink, true);
  assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[1]!, limits, signal), collectOptions), text.encode("dir/file"));
});

test("ZIP decoder exposes actual bytes before terminal CRC and size failures", async () => {
  for (const method of [0, 8]) {
    const entry = (await readZipArchive(fixture({ method }), limits, signal)).entries[0]!;
    for (const invalid of [{ ...entry, size: 8 }, { ...entry, crc32: 0 }]) {
      let received = 0;
      await assert.rejects(async () => {
        for await (const chunk of decodeZipEntry(invalid, limits, signal)) received += chunk.length;
      }, /size mismatch|CRC32 mismatch/);
      assert.equal(received, 9);
    }
  }
});

test("ZIP rejects overlapping and duplicated local spans", async () => {
  const original = fixture();
  const { central, end } = positions(original);
  const centralSize = end - central;
  const bytes = new Uint8Array(original.length + centralSize);
  bytes.set(original.subarray(0, end));
  bytes.set(original.subarray(central, end), end);
  bytes.set(original.subarray(end), end + centralSize);
  const view = new DataView(bytes.buffer);
  view.setUint16(end + centralSize + 8, 2, true);
  view.setUint16(end + centralSize + 10, 2, true);
  view.setUint32(end + centralSize + 12, centralSize * 2, true);
  await assert.rejects(readZipArchive(bytes, limits, signal), /overlapping/);
});

test("ZIP validates both raw and effective Unicode names without silent overrides", async () => {
  const unicodeExtra = (raw: Uint8Array, name: string): Uint8Array => {
    const encoded = text.encode(name);
    const data = new Uint8Array(5 + encoded.length);
    data[0] = 1;
    new DataView(data.buffer).setUint32(1, crc32(raw), true);
    data.set(encoded, 5);
    return extra(0x7075, data);
  };
  const raw = text.encode("legacy");
  for (const name of ["../x", "/x", "x\0", "a//b"]) {
    await assert.rejects(readZipArchive(fixture({ name: raw, flags: 0, localExtra: unicodeExtra(raw, name) }), limits, signal));
  }
  const unsafe = text.encode("../x");
  await assert.rejects(readZipArchive(fixture({ name: unsafe, flags: 0, localExtra: unicodeExtra(unsafe, "safe") }), limits, signal));
  await assert.rejects(readZipArchive(fixture({ name: raw, localExtra: unicodeExtra(raw, "different") }), limits, signal), /conflicting/);
  await assert.rejects(readZipArchive(fixture({ name: raw, flags: 0, localExtra: unicodeExtra(raw, "one"), centralExtra: unicodeExtra(raw, "two") }), limits, signal), /Unicode name mismatch/);
  const archive = await readZipArchive(fixture({ name: raw, flags: 0, localExtra: new Uint8Array(), centralExtra: unicodeExtra(raw, "目录") }), limits, signal);
  assert.deepEqual(archive.entries[0]!.rawName, raw);
  assert.deepEqual(archive.entries[0]!.localName, raw);
  assert.equal((await readZipArchive(await writeZipArchive(archive, limits, signal), limits, signal)).entries[0]!.name, "目录");
});

test("ZIP rejects duplicate extras, malformed timestamps, comments and trailing bytes", async () => {
  const timestamp = extra(0x5455, Uint8Array.of(1, 0, 0, 0, 0));
  for (const localExtra of [Uint8Array.from([...timestamp, ...timestamp]), extra(0x5455, Uint8Array.of(1)), extra(0x5455, Uint8Array.of(128))]) {
    await assert.rejects(readZipArchive(fixture({ localExtra }), limits, signal));
  }
  await assert.rejects(readZipArchive(Uint8Array.from([...fixture(), 0]), limits, signal));
  await assert.rejects(readZipArchive(fixture({ comment: new Uint8Array(10) }), { ...limits, maxTextBytes: 9 }, signal));
});

test("ZIP writer rejects truncating or contradictory retained metadata", async () => {
  const entry = (await readZipArchive(fixture(), limits, signal)).entries[0]!;
  for (const invalid of [
    { ...entry, flags: 0x100000800 },
    { ...entry, mode: 0o120777, symlink: true },
    { ...entry, modified: new Date("2026-09-11T00:00:00Z") },
    { ...entry, name: "renamed" },
  ]) await assert.rejects(writeZipArchive({ entries: [invalid], comment: new Uint8Array() }, limits, signal));
});

test("ZIP accepts deflated empty directories and pipe payloads but rejects device/socket modes", async () => {
  const directory = await makeZipEntry("dir/", new Uint8Array(), { ...attributes, directory: true, mode: 0o40755 }, limits, signal);
  const entry = { ...directory, method: 8, data: new Uint8Array(deflateRawSync(new Uint8Array())) };
  const archive = await readZipArchive(await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal), limits, signal);
  assert.equal((await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions)).length, 0);
  const pipe = await readZipArchive(fixture({ mode: 0o010644 }), limits, signal);
  assert.equal(pipe.entries[0]!.mode, 0o010644);
  for (const mode of [0o020644, 0o060644, 0o140644]) await assert.rejects(readZipArchive(fixture({ mode }), limits, signal));
});

test("ZIP ignores structurally impossible end signatures inside archive comments", async () => {
  const comment = new Uint8Array(22);
  new DataView(comment.buffer).setUint32(0, 0x06054b50, true);
  const archive = await readZipArchive(fixture({ comment }), limits, signal);
  assert.deepEqual(archive.comment, comment);
  assert.deepEqual((await readZipArchive(await writeZipArchive(archive, limits, signal), limits, signal)).comment, comment);
});

test("ZIP rejects internal verification attributes rather than treating checksums as Unix modes", async () => {
  const bytes = fixture();
  const { view, central } = positions(bytes);
  view.setUint16(central + 36, 4, true);
  await assert.rejects(readZipArchive(bytes, limits, signal), /internal attributes/);
});

test("ZIP size limits catch dishonest deflate declarations before unbounded expansion", async () => {
  const entry = await makeZipEntry("x", new Uint8Array(4096), attributes, limits, signal);
  const source = decodeZipEntry({ ...entry, size: 1 }, { ...limits, maxEntryBytes: 1024, chunkSize: 512 }, signal);
  let received = 0;
  await assert.rejects(async () => { for await (const chunk of source) received += chunk.length; }, /decoded byte/);
  assert.equal(received, 1024);
});

test("ZIP central UT flags may advertise access time while containing only mtime", async () => {
  const local = new Uint8Array(9);
  const view = new DataView(local.buffer);
  local[0] = 3;
  view.setInt32(1, 1_789_000_000, true);
  view.setInt32(5, 1_789_000_123, true);
  const archive = await readZipArchive(fixture({ localExtra: extra(0x5455, local), centralExtra: extra(0x5455, local.subarray(0, 5)) }), limits, signal);
  assert.equal(archive.entries[0]!.modified.getTime(), 1_789_000_000_000);
  const reread = await readZipArchive(await writeZipArchive(archive, limits, signal), limits, signal);
  assert.equal(reread.entries[0]!.modified.getTime(), 1_789_000_000_000);
});

test("ZIP DOS rounding carries through local midnight and year boundaries without rounding UT", async () => {
  const previous = process.env.TZ;
  try {
    for (const [timezone, instant] of [["UTC", "2024-12-31T23:59:59Z"], ["Etc/GMT+5", "2025-01-01T04:59:59Z"]]) {
      process.env.TZ = timezone;
      const modified = new Date(instant!);
      const entry = await makeZipEntry("x", new Uint8Array(), { ...attributes, modified }, limits, signal);
      const bytes = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal);
      const { view, central } = positions(bytes);
      assert.equal(view.getUint16(10, true), 0);
      assert.equal(view.getUint16(12, true), (45 << 9) | (1 << 5) | 1);
      assert.equal(view.getUint16(central + 12, true), 0);
      assert.equal(view.getUint16(central + 14, true), (45 << 9) | (1 << 5) | 1);
      const parsed = await readZipArchive(bytes, limits, signal);
      assert.equal(parsed.entries[0]!.modified.getTime(), modified.getTime());
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("ZIP preserves literal POSIX colon and backslash names within the VFS root", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/target");
  await fs.writeFile("/outside", text.encode("sentinel"));
  for (const name of ["a:b", "a\\b", "C:x", "a\\..\\outside"]) {
    const archive = await readZipArchive(fixture({ name: text.encode(name) }), limits, signal);
    assert.equal(archive.entries[0]!.name, name);
    const destination = resolvePath("/target", archive.entries[0]!.name);
    assert.ok(isPathWithin("/target", destination));
    const payload = await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions);
    await fs.writeFile(destination, payload);
    assert.deepEqual(await fs.readFile(`/target/${name}`), text.encode("123456789"));
    const made = await makeZipEntry(name, payload, attributes, limits, signal);
    const reread = await readZipArchive(await writeZipArchive({ entries: [made], comment: new Uint8Array() }, limits, signal), limits, signal);
    assert.equal(reread.entries[0]!.name, name);
  }
  assert.deepEqual(await fs.readFile("/outside"), text.encode("sentinel"));
});

for (const oracle of zip64Oracle.cases.filter(item => item.unzipStatus === 0)) {
  const original = Buffer.from(oracle.archive, "base64");
  const end = original.length - 22;
  const record = Number(original.readBigUInt64LE(end - 12));
  const central = Number(original.readBigUInt64LE(record + 48));
  let localExtra = 30 + original.readUInt16LE(26);
  while (original.readUInt16LE(localExtra) !== 1) localExtra += 4 + original.readUInt16LE(localExtra + 2);
  const mutations: Array<[string, (bytes: Buffer) => void]> = [
    ["classic disk", bytes => bytes.writeUInt16LE(1, end + 4)],
    ["classic start disk", bytes => bytes.writeUInt16LE(1, end + 6)],
    ["locator disk", bytes => bytes.writeUInt32LE(1, end - 16)],
    ["locator total disks", bytes => bytes.writeUInt32LE(2, end - 4)],
    ["locator unsafe offset", bytes => bytes.writeBigUInt64LE(2n ** 63n, end - 12)],
    ["locator out of bounds", bytes => bytes.writeBigUInt64LE(BigInt(bytes.length), end - 12)],
    ["end signature", bytes => bytes.writeUInt32LE(0, record)],
    ["short end record", bytes => bytes.writeBigUInt64LE(43n, record + 4)],
    ["long end record", bytes => bytes.writeBigUInt64LE(45n, record + 4)],
    ["unsafe end length", bytes => bytes.writeBigUInt64LE(2n ** 63n, record + 4)],
    ["end version", bytes => bytes.writeUInt16LE(46, record + 14)],
    ["end disk", bytes => bytes.writeUInt32LE(1, record + 16)],
    ["end central disk", bytes => bytes.writeUInt32LE(1, record + 20)],
    ["disk member count", bytes => bytes.writeBigUInt64LE(2n, record + 24)],
    ["total member count", bytes => bytes.writeBigUInt64LE(2n, record + 32)],
    ["unsafe member count", bytes => bytes.writeBigUInt64LE(2n ** 63n, record + 32)],
    ["directory size", bytes => bytes.writeBigUInt64LE(1n, record + 40)],
    ["directory offset", bytes => bytes.writeBigUInt64LE(1n, record + 48)],
    ["classic member count", bytes => bytes.writeUInt16LE(2, end + 10)],
    ["classic disk count", bytes => bytes.writeUInt16LE(2, end + 8)],
    ["classic directory size", bytes => bytes.writeUInt32LE(1, end + 12)],
    ["member disk", bytes => bytes.writeUInt16LE(1, central + 34)],
    ["missing local size tag", bytes => bytes.writeUInt16LE(2, localExtra)],
    ["truncated local size tag", bytes => bytes.writeUInt16LE(8, localExtra + 2)],
    ["unsafe local size", bytes => bytes.writeBigUInt64LE(2n ** 63n, localExtra + 4)],
    ["wrong local size", bytes => bytes.writeBigUInt64LE(99n, localExtra + 4)],
    ["wrong local compressed size", bytes => bytes.writeBigUInt64LE(99n, localExtra + 12)],
    ["missing central offset field", bytes => bytes.writeUInt32LE(0xffffffff, central + 42)],
  ];
  for (const [name, mutate] of mutations) {
    test(`ZIP64 rejects ${name}: ${oracle.args.join(" ")}`, async () => {
      const bytes = Buffer.from(original);
      mutate(bytes);
      await assert.rejects(readZipArchive(bytes, limits, signal), error => {
        assert.equal(error instanceof RangeError, false);
        return true;
      });
    });
  }
  test(`ZIP64 rejects every truncated prefix: ${oracle.args.join(" ")}`, async () => {
    for (let length = 0; length < original.length; length++) {
      await assert.rejects(readZipArchive(original.subarray(0, length), limits, signal));
    }
  });
  test(`ZIP64 transcodes native archive into classic ZIP: ${oracle.args.join(" ")}`, async () => {
    const archive = await readZipArchive(original, limits, signal);
    const bytes = await writeZipArchive(archive, limits, signal);
    const restored = await readZipArchive(bytes, limits, signal);
    assert.deepEqual(restored.entries.map(entry => entry.data), archive.entries.map(entry => entry.data));
    const bodies = await Promise.all(restored.entries.map(entry => collectBytes(decodeZipEntry(entry, limits, signal), collectOptions)));
    assert.deepEqual(Buffer.concat(bodies), Buffer.from(oracle.unzipStdout, "base64"));
    assert.equal(new DataView(bytes.buffer).getUint16(4, true), archive.entries[0]!.method === 8 ? 20 : 10);
  });
}

// Inspired by CPython test_zipfile.test_core's generated ZIP64 field combinations
// and extra-field stripping order cases; this implementation also checks disk fields.
for (let mask = 0; mask < 16; mask++) {
  test(`ZIP64 resolves ordered sentinel field combination ${mask}`, () => {
    const expected = [123, 45, 67, 0];
    const values = expected.map((value, index) => mask & 1 << index ? 0xffffffff : value);
    const bytes = new Uint8Array(28);
    const view = new DataView(bytes.buffer);
    let length = 0;
    for (let index = 0; index < 4; index++) {
      if (!(mask & 1 << index)) continue;
      if (index === 3) view.setUint32(length, expected[index]!, true);
      else view.setBigUint64(length, BigInt(expected[index]!), true);
      length += index === 3 ? 4 : 8;
    }
    assert.deepEqual(zip64Fields(bytes.subarray(0, length), values), expected);
    if (length) {
      assert.throws(() => zip64Fields(undefined, values));
      for (let shorter = 0; shorter < length; shorter++) {
        assert.throws(() => zip64Fields(bytes.subarray(0, shorter), values));
      }
    }
  });
}
for (const position of [0, 1, 2]) {
  test(`ZIP64 stripping preserves opaque extra order with size tag at ${position}`, () => {
    const fields = [extra(0xcafe, new Uint8Array([1, 2])), extra(0xbeef, new Uint8Array([3]))];
    const expected = Buffer.concat(fields);
    fields.splice(position, 0, extra(1, new Uint8Array(16)));
    assert.deepEqual(Buffer.from(stripZip64(Buffer.concat(fields))), expected);
  });
}
test("ZIP64 accepts bounded extensible end data and enforces its metadata limit", async () => {
  const original = Buffer.from(zip64Oracle.cases[0]!.archive, "base64");
  const end = original.length - 22;
  const record = Number(original.readBigUInt64LE(end - 12));
  const extension = Buffer.from([0xca, 0xfe, 4, 0, 0, 0, 100, 97, 116, 97]);
  const bytes = Buffer.concat([original.subarray(0, end - 20), extension, original.subarray(end - 20)]);
  bytes.writeBigUInt64LE(44n + BigInt(extension.length), record + 4);
  const archive = await readZipArchive(bytes, limits, signal);
  assert.equal(archive.entries.length, 1);
  await assert.rejects(readZipArchive(bytes, { ...limits, maxPaxBytes: extension.length - 1 }, signal));
});

for (const signed of [false, true]) {
  test(`ZIP64 reads and validates ${signed ? "signed" : "unsigned"} wide descriptors`, async () => {
    const original = Buffer.from(zip64Oracle.cases[0]!.archive, "base64");
    const oldEnd = original.length - 22;
    const oldRecord = Number(original.readBigUInt64LE(oldEnd - 12));
    const central = Number(original.readBigUInt64LE(oldRecord + 48));
    const descriptor = Buffer.alloc(signed ? 24 : 20);
    const base = signed ? 4 : 0;
    if (signed) descriptor.writeUInt32LE(0x08074b50);
    descriptor.writeUInt32LE(original.readUInt32LE(14), base);
    descriptor.writeBigUInt64LE(BigInt(original.readUInt32LE(central + 20)), base + 4);
    descriptor.writeBigUInt64LE(BigInt(original.readUInt32LE(central + 24)), base + 12);
    const bytes = Buffer.concat([original.subarray(0, central), descriptor, original.subarray(central)]);
    const end = oldEnd + descriptor.length;
    const record = oldRecord + descriptor.length;
    const newCentral = central + descriptor.length;
    bytes.writeUInt16LE(bytes.readUInt16LE(6) | 8, 6);
    bytes.writeUInt16LE(bytes.readUInt16LE(newCentral + 8) | 8, newCentral + 8);
    bytes.writeUInt32LE(0, 14);
    const tag = 30 + bytes.readUInt16LE(26);
    bytes.writeBigUInt64LE(0n, tag + 4);
    bytes.writeBigUInt64LE(0n, tag + 12);
    bytes.writeBigUInt64LE(BigInt(newCentral), record + 48);
    bytes.writeBigUInt64LE(BigInt(record), end - 12);
    bytes.writeUInt32LE(newCentral, end + 16);
    const archive = await readZipArchive(bytes, limits, signal);
    const body = await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions);
    assert.deepEqual(Buffer.from(body), Buffer.from(zip64Oracle.cases[0]!.unzipStdout, "base64"));
    for (const position of [base, base + 4, base + 12]) {
      const invalid = Buffer.from(bytes);
      invalid[central + position] ^= 1;
      await assert.rejects(readZipArchive(invalid, limits, signal));
    }
  });
}

for (const descriptors of [false, true]) {
  for (const force of [false, true]) {
    for (const body of [new Uint8Array(), text.encode("a"), text.encode("compressible".repeat(500))]) {
      test(`ZIP64 output round-trip descriptors=${descriptors} force=${force} size=${body.length}`, async () => {
        const entry = await makeZipEntry("日本語.txt", body, attributes, limits, signal);
        entry.zip64 = !force;
        const bytes = await writeZipArchive({ entries: [entry], comment: text.encode("comment") }, limits, signal, descriptors, force);
        const archive = await readZipArchive(bytes, limits, signal);
        assert.deepEqual(archive.comment, text.encode("comment"));
        assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions), body);
        assert.equal(new DataView(bytes.buffer).getUint16(4, true), 45);
        await assert.rejects(writeZipArchive({ entries: [entry], comment: text.encode("comment") }, { ...limits, maxArchiveBytes: bytes.length - 1 }, signal, descriptors, force));
      });
    }
  }
}
test("ZIP64 output supports forced empty archives and mixed classic/ZIP64 entries", async () => {
  const empty = await writeZipArchive({ entries: [], comment: new Uint8Array() }, limits, signal, false, true);
  assert.equal(empty.length, 98);
  assert.equal((await readZipArchive(empty, limits, signal)).entries.length, 0);
  const entries = await Promise.all(["classic", "wide"].map(name => makeZipEntry(name, text.encode(name), attributes, limits, signal)));
  entries[1]!.zip64 = true;
  for (const descriptors of [false, true]) {
    const bytes = await writeZipArchive({ entries, comment: new Uint8Array() }, limits, signal, descriptors);
    const restored = await readZipArchive(bytes, limits, signal);
    assert.deepEqual(restored.entries.map(entry => entry.name), ["classic", "wide"]);
    assert.deepEqual(restored.entries.map(entry => entry.data), entries.map(entry => entry.data));
  }
});
test("ZIP64 writer rejects extra metadata overflow before emission", async () => {
  const entry = await makeZipEntry("wide", text.encode("payload"), attributes, limits, signal);
  entry.localExtra = extra(0xcafe, new Uint8Array(65520));
  await assert.rejects(writeZipArchive({ entries: [entry], comment: new Uint8Array() }, { ...limits, maxPaxBytes: 65535 }, signal, false, true), /extra field limit/);
});


test("ZIP stream emits bounded records and payload slices in wire order", async () => {
  const body = Uint8Array.from({ length: 4096 }, (_, index) => index % 251);
  const entry = await makeZipEntry("large", body, attributes, limits, signal, 0);
  for (const wide of [false, true]) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of streamZipArchive({ entries: [entry], comment: new Uint8Array() }, { ...limits, chunkSize: 512 }, signal, true, wide)) {
      assert.ok(chunk.length <= 512);
      chunks.push(chunk);
    }
    assert.ok(chunks.length > 8);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal, true, wide)));
    const restored = await readZipArchive(Buffer.concat(chunks), limits, signal);
    assert.deepEqual(await collectBytes(decodeZipEntry(restored.entries[0]!, limits, signal), collectOptions), body);
  }
});
test("ZIP stream checks complete metadata before yielding any archive bytes", async () => {
  const valid = await makeZipEntry("valid", text.encode("body"), attributes, limits, signal);
  const invalid = { ...valid, name: "../escape" };
  const iterator = streamZipArchive({ entries: [valid, invalid], comment: new Uint8Array() }, limits, signal)[Symbol.asyncIterator]();
  await assert.rejects(iterator.next(), /unsafe/);
});
test("ZIP stream cancellation between chunks stops serialization", async () => {
  const entry = await makeZipEntry("file", new Uint8Array(2048), attributes, limits, signal, 0);
  const controller = new AbortController();
  const iterator = streamZipArchive({ entries: [entry], comment: new Uint8Array() }, { ...limits, chunkSize: 512 }, controller.signal)[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).done, false);
  const reason = new Error("stop serialization");
  controller.abort(reason);
  await assert.rejects(iterator.next(), error => error === reason);
});

test("ZIP stream bounds large metadata and comment chunks without corrupting extras", async () => {
  const entry = await makeZipEntry("metadata", text.encode("data"), attributes, limits, signal);
  entry.localExtra = extra(0xcafe, new Uint8Array(2000));
  entry.centralExtra = extra(0xbeef, new Uint8Array(3000));
  // Preserve mtime with DOS-only metadata at exact even-second resolution.
  const comment = text.encode("c".repeat(4000));
  const chunks: Uint8Array[] = [];
  for await (const chunk of streamZipArchive({ entries: [entry], comment }, { ...limits, chunkSize: 512 }, signal, true, true)) {
    assert.ok(chunk.length <= 512);
    chunks.push(chunk);
  }
  const archive = await readZipArchive(Buffer.concat(chunks), limits, signal);
  assert.deepEqual(archive.comment, comment);
  assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions), text.encode("data"));
});


for (const position of [0, 1, 2]) {
  test(`ZIP all-extra update preserves opaque order and rebuilds timestamp at position ${position}`, async () => {
    const previous = await makeZipEntry("old", text.encode("old"), attributes, limits, signal);
    const fields = [extra(0xcafe, new Uint8Array([1])), extra(0xbeef, new Uint8Array([2]))];
    const stamp = new Uint8Array(5);
    stamp[0] = 1;
    new DataView(stamp.buffer).setInt32(1, Math.floor(modified.getTime() / 1000), true);
    fields.splice(position, 0, extra(0x5455, stamp));
    previous.localExtra = Buffer.concat(fields);
    previous.centralExtra = previous.localExtra;
    const entry = await makeZipEntry("old", text.encode("new"), { ...attributes, modified: new Date("2024-01-02T03:04:06Z") }, limits, signal);
    const updated = updateZipExtras(entry, previous, "all", limits);
    const bytes = await writeZipArchive({ entries: [updated], comment: new Uint8Array() }, limits, signal);
    const restored = await readZipArchive(bytes, limits, signal);
    assert.equal(restored.entries[0]!.modified.getTime(), entry.modified.getTime());
    assert.deepEqual(Array.from(updated.localExtra!.subarray(0, 10)), [0xfe, 0xca, 1, 0, 1, 0xef, 0xbe, 1, 0, 2]);
    assert.equal(updated.localExtra!.length, 19);
    await assert.rejects(Promise.resolve().then(() => updateZipExtras(entry, previous, "all", { ...limits, maxPaxBytes: 18 })), /extra field/);
  });
}
test("ZIP stripped-extra update rounds DOS time without retaining a stale UT timestamp", async () => {
  const entry = await makeZipEntry("file", text.encode("body"), { ...attributes, modified: new Date("2024-01-02T03:04:05.123Z") }, limits, signal);
  const stripped = updateZipExtras(entry, undefined, "strip", limits);
  const bytes = await writeZipArchive({ entries: [stripped], comment: new Uint8Array() }, limits, signal);
  const restored = await readZipArchive(bytes, limits, signal);
  assert.equal(restored.entries[0]!.modified.getTime(), new Date("2024-01-02T03:04:06Z").getTime());
  assert.equal(restored.entries[0]!.localExtra!.length, 0);
});
