import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import zip64Oracle from "./fixtures/zip64-infozip.json" with { type: "json" };
import { collectBytes, isPathWithin, resolvePath } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { DEFAULT_ARCHIVE_LIMITS as limits } from "../../src/commands/archive/internal.js";
import { zip64Fields, stripZip64, zip64Extra, writeZip64End, zip64Member, zipEnd, zipDescriptor } from "../../src/commands/archive/zip/zip64.js";
import { crc32, decodeZipEntry, makeZipEntry, readZipArchive, writeZipArchive, streamZipArchive, updateZipExtras, setZipEntryComment } from "../../src/commands/archive/zip-format.js";
import { execute, fixture as commandFixture } from "./zip-standard-flags.helpers.js";

const signal = new AbortController().signal;
const text = new TextEncoder();
const modified = new Date("2026-09-10T01:02:04Z");
const attributes = { modified, mode: 0o100640, directory: false, symlink: false };
const collectOptions = { maxBytes: limits.maxEntryBytes };

test("ZIP empty archive admits end records before emission at exact archive boundaries", async () => {
  for (const wide of [false, true]) for (const comment of [new Uint8Array(), text.encode("comment")]) {
    const archive = { entries: [], comment };
    const size = 22 + comment.length + (wide ? 76 : 0);
    const exact = await collectBytes(streamZipArchive(archive, { ...limits, maxArchiveBytes: size }, signal, false, wide), { maxBytes: size });
    assert.equal(exact.length, size);
    const iterator = streamZipArchive(archive, { ...limits, maxArchiveBytes: size - 1 }, signal, false, wide)[Symbol.asyncIterator]();
    await assert.rejects(iterator.next(), /archive byte limit/);
    const controller = new AbortController();
    const reason = new Error("empty archive cancelled");
    const cancelled = streamZipArchive(archive, { ...limits, maxArchiveBytes: size }, controller.signal, false, wide)[Symbol.asyncIterator]();
    assert.equal((await cancelled.next()).done, false);
    controller.abort(reason);
    await assert.rejects(cancelled.next(), error => error === reason);
    await assert.rejects(streamZipArchive(archive, limits, controller.signal, false, wide)[Symbol.asyncIterator]().next(), error => error === reason);
  }
});

test("ZIP consumes a live source incrementally after emitting its header", async () => {
  let pulls = 0;
  let eof = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const source = (async function* () {
    pulls++;
    yield text.encode("first");
    await gate;
    pulls++;
    yield text.encode("last");
    eof = true;
  })();
  const entry = { ...await makeZipEntry("live", new Uint8Array(), attributes, limits, signal, 0), source, level: 0 };
  const stream = streamZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal);
  const iterator = stream[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  try {
    const header = await iterator.next();
    assert.equal(header.done, false);
    chunks.push(header.value!);
    assert.equal(pulls, 0, "header must precede source acquisition");
    const payload = await iterator.next();
    assert.equal(payload.done, false);
    assert.equal(pulls, 1, "must consume source rather than buffered data");
    assert.equal(eof, false);
    chunks.push(payload.value!);
  } finally { release(); }
  for await (const chunk of stream) chunks.push(chunk);
  const archive = await readZipArchive(Buffer.concat(chunks), limits, signal);
  assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions), text.encode("firstlast"));
});

for (const method of [0, 8, 12]) for (const length of [0, 1, 511, 512, 513, 65535, 65536, 65537]) {
  test(`ZIP live method ${method} owns reused producer bytes at ${length}`, async () => {
    const body = Uint8Array.from({ length }, (_, index) => (index * 37 + (index >>> 8)) % 251);
    const slab = Buffer.alloc(777);
    let closed = false;
    const source = (async function* () {
      try {
        for (let offset = 0; offset < body.length; offset += slab.length) {
          const size = Math.min(slab.length, body.length - offset);
          slab.set(body.subarray(offset, offset + size));
          yield slab.subarray(0, size);
          slab.fill(255);
        }
      } finally { closed = true; slab.fill(255); }
    })();
    const entry = { ...await makeZipEntry("live", new Uint8Array(), attributes, limits, signal, 0), source, method, level: 6 };
    let peakPayload = 0;
    let peakMetadata = 0;
    const bytes = await collectBytes(streamZipArchive({ entries: [entry], comment: new Uint8Array(), onRetention(counters) {
      peakPayload = Math.max(peakPayload, counters.payloadBytes);
      peakMetadata = Math.max(peakMetadata, counters.metadataBytes);
    } }, { ...limits, chunkSize: 512 }, signal), { maxBytes: limits.maxArchiveBytes });
    assert.equal(closed, true);
    assert.ok(peakPayload <= 1024);
    assert.equal(peakMetadata, 102);
    const archive = await readZipArchive(bytes, limits, signal);
    assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions), body);
    assert.equal(archive.entries[0]!.flags! & 8, 8);
  });
}

test("ZIP live sources preserve buffered neighbors and ZIP64 offsets", async () => {
  for (const wide of [false, true]) {
    const entries = await Promise.all(["before", "live", "after"].map(name => makeZipEntry(name, text.encode(name), attributes, limits, signal, 0)));
    entries[1] = { ...entries[1]!, data: new Uint8Array(), size: 0, source: (async function* () { yield text.encode("live"); })(), method: 8 };
    const bytes = await writeZipArchive({ entries, comment: text.encode("comment") }, limits, signal, false, wide);
    const archive = await readZipArchive(bytes, limits, signal);
    for (const entry of archive.entries) assert.deepEqual(await collectBytes(decodeZipEntry(entry, limits, signal), collectOptions), text.encode(entry.name));
    assert.deepEqual(archive.comment, text.encode("comment"));
  }
});

for (const bound of ["maxEntryBytes", "maxTotalBytes", "maxArchiveBytes", "maxPatternSteps"] as const) {
  test(`ZIP live ${bound} failure closes its producer`, async () => {
    let closed = false;
    const source = (async function* () { try { for (let index = 0; index < 8; index++) yield new Uint8Array(512); } finally { closed = true; } })();
    const entry = { ...await makeZipEntry("live", new Uint8Array(), attributes, limits, signal, 0), source };
    const maximum = bound === "maxArchiveBytes" ? 1200 : bound === "maxPatternSteps" ? 4 : 600;
    await assert.rejects(writeZipArchive({ entries: [entry], comment: new Uint8Array() }, { ...limits, chunkSize: 512, [bound]: maximum }, signal), /limit/);
    assert.equal(closed, true);
  });
}

test("ZIP live empty chunks consume work budget and close their producer", async () => {
  for (const method of [0, 8, 12]) {
    let pulls = 0;
    let closed = false;
    const entry = { ...await makeZipEntry("live", new Uint8Array(), attributes, limits, signal, 0), method,
      source: (async function* () { try { for (let index = 0; index < 8; index++) { pulls++; yield new Uint8Array(); } } finally { closed = true; } })() };
    await assert.rejects(writeZipArchive({ entries: [entry], comment: new Uint8Array() }, { ...limits, maxPatternSteps: 4 }, signal), /work limit/);
    assert.equal(pulls, 4, "empty input must stop at work admission rather than drain the source");
    assert.equal(closed, true);
  }
  const entry = { ...await makeZipEntry("live", new Uint8Array(), attributes, limits, signal, 0),
    source: (async function* () { for (let index = 0; index < 3; index++) yield new Uint8Array(); })() };
  const bytes = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, { ...limits, maxPatternSteps: 4 }, signal);
  const archive = await readZipArchive(bytes, limits, signal);
  assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions), new Uint8Array());
  for (const method of [0, 8, 12]) {
    const controller = new AbortController();
    const reason = new Error("empty input cancelled");
    let closed = false;
    let pulls = 0;
    const cancelled = { ...entry, method, source: (async function* () {
      try {
        pulls++;
        yield new Uint8Array();
        controller.abort(reason);
        pulls++;
        yield new Uint8Array();
        pulls++;
      } finally { closed = true; }
    })() };
    await assert.rejects(writeZipArchive({ entries: [cancelled], comment: new Uint8Array() }, limits, controller.signal), error => error === reason);
    assert.equal(pulls, 2);
    assert.equal(closed, true);
  }
});

test("ZIP live STORE admits archive bytes before retaining an input slab", async () => {
  for (const wide of [false, true]) {
    let closed = false;
    let peakPayload = 0;
    const entry = { ...await makeZipEntry("live", new Uint8Array(), attributes, limits, signal, 0),
      source: (async function* () { try { yield new Uint8Array(512); } finally { closed = true; } })() };
    const overhead = 140 + (wide ? 132 : 0);
    await assert.rejects(writeZipArchive({ entries: [entry], comment: new Uint8Array(), onRetention(counters) {
      peakPayload = Math.max(peakPayload, counters.payloadBytes);
    } }, { ...limits, maxArchiveBytes: overhead + 511 }, signal, false, wide), /archive byte limit/);
    assert.equal(peakPayload, 0, "over-budget STORE bytes must fail before owned slab admission");
    assert.equal(closed, true);
    const exactEntry = { ...entry, source: (async function* () { yield new Uint8Array(512); })() };
    const bytes = await writeZipArchive({ entries: [exactEntry], comment: new Uint8Array() },
      { ...limits, maxArchiveBytes: overhead + 512 }, signal, false, wide);
    assert.equal(bytes.length, overhead + 512);
    const archive = await readZipArchive(bytes, limits, signal);
    assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions), new Uint8Array(512));
  }
});

test("ZIP live input and archive budgets admit exact boundaries", async () => {
  const create = async () => ({ ...await makeZipEntry("live", new Uint8Array(), attributes, limits, signal, 0),
    source: (async function* () { yield new Uint8Array(512); })(), expectedSize: 512 });
  const bytes = await writeZipArchive({ entries: [await create()], comment: new Uint8Array() }, { ...limits, maxEntryBytes: 512, maxTotalBytes: 512 }, signal);
  assert.deepEqual(await writeZipArchive({ entries: [await create()], comment: new Uint8Array() }, { ...limits, maxArchiveBytes: bytes.length }, signal), bytes);
  await assert.rejects(writeZipArchive({ entries: [await create()], comment: new Uint8Array() }, { ...limits, maxArchiveBytes: bytes.length - 1 }, signal), /limit/);
  const entry = await create();
  entry.expectedSize = 513;
  await assert.rejects(writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal), /changed/);
});

test("ZIP live profiles reject invalid expected sizes and work budgets before pulling", async () => {
  for (const value of [NaN, -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    let pulls = 0;
    const entry = { ...await makeZipEntry("live", new Uint8Array(), attributes, limits, signal, 0),
      source: (async function* () { pulls++; yield new Uint8Array(512); })(), expectedSize: value };
    await assert.rejects(writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal), /invalid value/);
    assert.equal(pulls, 0);
    await assert.rejects(writeZipArchive({ entries: [], comment: new Uint8Array() }, { ...limits, maxPatternSteps: value }, signal), /invalid value/);
  }
});

for (const phase of ["header", "payload", "descriptor", "central", "end"] as const) {
  test(`ZIP live abort at ${phase} retires its source`, async () => {
    const controller = new AbortController();
    const reason = new Error(`abort ${phase}`);
    let closed = false;
    const source = (async function* () { try { yield new Uint8Array(512); yield new Uint8Array(512); } finally { closed = true; } })();
    const entry = { ...await makeZipEntry("live", new Uint8Array(), attributes, limits, signal, 0), source };
    const iterator = streamZipArchive({ entries: [entry], comment: new Uint8Array() }, { ...limits, chunkSize: 512 }, controller.signal)[Symbol.asyncIterator]();
    const index = { header: 0, payload: 1, descriptor: 3, central: 4, end: 5 }[phase];
    for (let step = 0; step <= index; step++) assert.equal((await iterator.next()).done, false);
    controller.abort(reason);
    await assert.rejects(iterator.next(), error => error === reason);
    if (phase === "header") await source.return();
    else assert.equal(closed, true);
  });
}

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
  descriptor?: "signed" | "unsigned" | undefined; mode?: number; comment?: Uint8Array; entryComment?: Uint8Array;
} = {}): Uint8Array {
  const name = options.name ?? text.encode("file.txt");
  const data = options.data ?? text.encode("123456789");
  const method = options.method ?? 0;
  const compressed = options.compressed ?? (method === 8 ? deflateRawSync(data) : data);
  const localExtra = options.localExtra ?? new Uint8Array();
  const centralExtra = options.centralExtra ?? localExtra;
  const comment = options.comment ?? new Uint8Array();
  const entryComment = options.entryComment ?? new Uint8Array();
  const descriptorSize = options.descriptor === "signed" ? 16 : options.descriptor ? 12 : 0;
  const central = 30 + name.length + localExtra.length + compressed.length + descriptorSize;
  const end = central + 46 + name.length + centralExtra.length + entryComment.length;
  const bytes = new Uint8Array(end + 22 + comment.length);
  const view = new DataView(bytes.buffer);
  const flags = (options.flags ?? 0x800) | (options.descriptor ? 8 : 0);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, flags, true);
  view.setUint16(8, method, true);
  view.setUint16(12, 0x5d2a, true);
  if (!options.descriptor) {
    view.setUint32(14, crc32(data), true);
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
  view.setUint32(central + 16, crc32(data), true);
  view.setUint32(central + 20, compressed.length, true);
  view.setUint32(central + 24, data.length, true);
  view.setUint16(central + 28, name.length, true);
  view.setUint16(central + 30, centralExtra.length, true);
  view.setUint16(central + 32, entryComment.length, true);
  view.setUint32(central + 38, (options.mode ?? 0o100640) * 65536, true);
  bytes.set(name, central + 46);
  bytes.set(centralExtra, central + 46 + name.length);
  bytes.set(entryComment, end - entryComment.length);
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

for (const directory of [false, true]) for (const readonly of [false, true]) {
  test(`ZIP DOS attributes restore directory=${directory} readonly=${readonly} without trusting Unix upper bits`, async () => {
    const bytes = fixture({ name: text.encode(directory ? "dir/" : "file"), ...(directory ? { data: new Uint8Array() } : {}) });
    const { view, central } = positions(bytes);
    view.setUint16(central + 4, 20, true); // FAT creator, not Unix.
    view.setUint32(central + 38, (0o120777 * 65536 + (directory ? 16 : 0) + (readonly ? 1 : 0)) >>> 0, true);
    const expected = directory ? readonly ? 0o040555 : 0o040755 : readonly ? 0o100444 : 0o100644;
    const archive = await readZipArchive(bytes, limits, signal);
    assert.equal(archive.entries[0]!.mode, expected);
    assert.equal(archive.entries[0]!.symlink, false);
    const rewritten = await readZipArchive(await writeZipArchive(archive, limits, signal), limits, signal);
    assert.equal(rewritten.entries[0]!.externalAttributes, view.getUint32(central + 38, true));
    assert.equal(rewritten.entries[0]!.mode, expected);
    const fs = await commandFixture(bytes);
    const result = await execute("unzip", fs, ["-o", "sample.zip"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.lstat(directory ? "/work/dir" : "/work/file")).mode & 0o777, expected & 0o777);
  });
}

test("ZIP DOS read-only retained metadata must agree with the supplied mode before output", async () => {
  const entry = await makeZipEntry("readonly", text.encode("data"), { ...attributes, mode: 0o100444 }, limits, signal, 0);
  entry.versionMadeBy = 20;
  entry.externalAttributes = 1;
  const bytes = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal);
  assert.equal((await readZipArchive(bytes, limits, signal)).entries[0]!.mode, 0o100444);
  const iterator = streamZipArchive({ entries: [{ ...entry, mode: 0o100644 }], comment: new Uint8Array() }, limits, signal)[Symbol.asyncIterator]();
  await assert.rejects(iterator.next(), /file attributes mismatch/);
});

test("ZIP explicit Unix modes take precedence over DOS read-only hints", async () => {
  for (const host of [3, 19]) for (const mode of [0o100000, 0o100640, 0o120777]) {
    const bytes = fixture();
    const { view, central } = positions(bytes);
    view.setUint16(central + 4, host * 256 + 30, true);
    view.setUint32(central + 38, (mode * 65536 + 1) >>> 0, true);
    const archive = await readZipArchive(bytes, limits, signal);
    assert.equal(archive.entries[0]!.mode, mode);
    assert.equal(archive.entries[0]!.symlink, mode === 0o120777);
    assert.equal((await readZipArchive(await writeZipArchive(archive, limits, signal), limits, signal)).entries[0]!.mode, mode);
  }
});

// Independent memory adaptations of the pinned Go TestWriterComment/Time/Copy
// and CPython Unicode-extra/NUL cases; source revisions are in the evidence doc.
for (const length of [0, 1, 65534, 65535, 65536]) {
  test(`ZIP archive and entry comment field boundary ${length}`, async () => {
    const comment = new Uint8Array(length).fill(65);
    const entry = await makeZipEntry("file", text.encode("data"), attributes, limits, signal, 0);
    for (const member of [false, true]) {
      const archive = { entries: [{ ...entry, ...(member ? { comment } : {}) }], comment: member ? new Uint8Array() : comment };
      if (length > 65535) {
        await assert.rejects(streamZipArchive(archive, limits, signal)[Symbol.asyncIterator]().next(), /comment.*limit/);
      } else {
        const bytes = await writeZipArchive(archive, limits, signal);
        const restored = await readZipArchive(bytes, limits, signal);
        assert.deepEqual(member ? restored.entries[0]!.comment : restored.comment, comment);
        if (length) await assert.rejects(readZipArchive(bytes, { ...limits, maxTextBytes: length - 1 }, signal), /comment.*limit/);
      }
    }
  });
}

function unicodeField(identifier: number, original: Uint8Array, unicode: Uint8Array): Uint8Array {
  const payload = new Uint8Array(5 + unicode.length);
  payload[0] = 1;
  new DataView(payload.buffer).setUint32(1, crc32(original), true);
  payload.set(unicode, 5);
  return extra(identifier, payload);
}

test("ZIP Unicode comments retain raw legacy bytes and opaque extras across copy and replacement", async () => {
  const raw = Uint8Array.of(0x82);
  const fields = Buffer.concat([unicodeField(0x6375, raw, text.encode("é")), extra(0xbeef, Uint8Array.of(0, 255))]);
  const bytes = fixture({ flags: 0, entryComment: raw, centralExtra: fields });
  const archive = await readZipArchive(bytes, limits, signal);
  const copied = await readZipArchive(await writeZipArchive(archive, limits, signal), limits, signal);
  assert.deepEqual(copied.entries[0]!.comment, raw);
  assert.deepEqual(Buffer.from(copied.entries[0]!.centralExtra!), fields);
  assert.deepEqual(copied.entries[0]!.data, archive.entries[0]!.data);
  const replaced = setZipEntryComment(copied.entries[0]!, text.encode("new"), limits);
  assert.deepEqual(Buffer.from(replaced.centralExtra!), Buffer.from(extra(0xbeef, Uint8Array.of(0, 255))));
  assert.deepEqual((await readZipArchive(await writeZipArchive({ entries: [replaced], comment: new Uint8Array() }, limits, signal), limits, signal)).entries[0]!.comment, text.encode("new"));
  for (const unicode of [Uint8Array.of(255), Uint8Array.of(0xc0, 0x80), Uint8Array.of(0xed, 0xa0, 0x80)]) {
    await assert.rejects(readZipArchive(fixture({ flags: 0, entryComment: raw, centralExtra: unicodeField(0x6375, raw, unicode) }), limits, signal), /UTF-8/);
  }
  const invalid = new Uint8Array(fields);
  invalid[5] = invalid[5]! ^ 1;
  await assert.rejects(readZipArchive(fixture({ flags: 0, entryComment: raw, centralExtra: invalid }), limits, signal), /CRC mismatch/);
  await assert.rejects(readZipArchive(fixture({ entryComment: raw }), limits, signal), /UTF-8/);
});

test("ZIP Unicode extra field length admits its exact TLV limit and refuses the next byte", async () => {
  for (const length of [65525, 65526, 65527]) {
    const field = unicodeField(0x6375, new Uint8Array(), new Uint8Array(length).fill(65));
    const bytes = fixture({ centralExtra: field });
    if (field.length > 65535) {
      const entry = await makeZipEntry("file", text.encode("data"), attributes, limits, signal, 0);
      entry.centralExtra = field;
      await assert.rejects(streamZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal)[Symbol.asyncIterator]().next(), /extra field.*limit/);
    }
    else {
      const archive = await readZipArchive(bytes, limits, signal);
      assert.deepEqual(archive.entries[0]!.centralExtra, field);
      await assert.rejects(readZipArchive(bytes, { ...limits, maxPaxBytes: field.length - 1 }, signal), /extra field.*limit/);
    }
  }
});

test("ZIP UTF-8 path flag and Unicode extras agree without stripping a leading BOM", async () => {
  for (const name of ["이름.txt", "\ufefffile", "é", "🐯"]) {
    const raw = text.encode(name);
    const field = unicodeField(0x7075, raw, raw);
    const archive = await readZipArchive(fixture({ name: raw, centralExtra: field }), limits, signal);
    assert.equal(archive.entries[0]!.name, name);
    assert.deepEqual(archive.entries[0]!.rawName, raw);
    await assert.rejects(readZipArchive(fixture({ name: raw, centralExtra: unicodeField(0x7075, raw, text.encode("other")) }), limits, signal), /conflicting/);
  }
  for (const name of ["file\0suffix", "\0file", "file\0"]) {
    await assert.rejects(readZipArchive(fixture({ name: text.encode(name), flags: 0 }), limits, signal), /unsafe path/);
  }
});

test("ZIP DOS calendar field endpoints and invalid clocks remain strict", async () => {
  for (const [date, time, valid] of [[33, 0, true], [65535, 0, false], [65439, 49021, true], [33, 31, false], [33, 24 << 11, false], [33, 60 << 5, false], [0, 0, true]] as const) {
    const bytes = fixture();
    const { view, central } = positions(bytes);
    view.setUint16(12, date, true); view.setUint16(central + 14, date, true);
    view.setUint16(10, time, true); view.setUint16(central + 12, time, true);
    if (valid) assert.equal((await readZipArchive(bytes, limits, signal)).entries.length, 1);
    else await assert.rejects(readZipArchive(bytes, limits, signal), /DOS timestamp/);
  }
});

test("ZIP extended timestamps preserve odd seconds at signed field endpoints and DST transitions", async () => {
  for (const milliseconds of [-0x80000000 * 1000, 0x7fffffff * 1000, Date.parse("2024-03-10T07:59:59Z"), Date.parse("2024-03-10T08:00:01Z"), Date.parse("2024-11-03T06:59:59Z"), Date.parse("2024-11-03T07:00:01Z")]) {
    const entry = await makeZipEntry("file", text.encode("data"), { ...attributes, modified: new Date(milliseconds) }, limits, signal, 0);
    const archive = await readZipArchive(await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal), limits, signal);
    assert.equal(archive.entries[0]!.modified.getTime(), milliseconds);
    assert.equal(new DataView(archive.entries[0]!.centralExtra!.buffer).getInt32(5, true), milliseconds / 1000);
  }
});

test("ZIP DOS leap centuries remain strict even when UT supplies the instant", async () => {
  for (const [year, day, valid] of [[2000, 29, true], [2100, 28, true], [2100, 29, false], [2001, 29, false]] as const) {
    const timestamp = new Uint8Array(5);
    timestamp[0] = 1;
    new DataView(timestamp.buffer).setInt32(1, 1700000001, true);
    const bytes = fixture({ localExtra: extra(0x5455, timestamp) });
    const { view, central } = positions(bytes);
    const date = ((year - 1980) << 9) | (2 << 5) | day;
    view.setUint16(12, date, true);
    view.setUint16(central + 14, date, true);
    if (!valid) {
      await assert.rejects(readZipArchive(bytes, limits, signal), /DOS timestamp/);
      continue;
    }
    const archive = await readZipArchive(bytes, limits, signal);
    assert.equal(archive.entries[0]!.modified.getTime(), 1700000001000);
    const rewritten = await readZipArchive(await writeZipArchive(archive, limits, signal), limits, signal);
    assert.equal(rewritten.entries[0]!.dosDate, date);
    assert.equal(rewritten.entries[0]!.modified.getTime(), 1700000001000);
    assert.deepEqual(rewritten.entries[0]!.localExtra, archive.entries[0]!.localExtra);
    assert.deepEqual(rewritten.entries[0]!.centralExtra, archive.entries[0]!.centralExtra);
    assert.deepEqual(await collectBytes(decodeZipEntry(rewritten.entries[0]!, limits, signal), collectOptions), text.encode("123456789"));
    const controller = new AbortController();
    const reason = new Error("abort leap-century metadata");
    controller.abort(reason);
    await assert.rejects(readZipArchive(bytes, limits, controller.signal), error => error === reason);
    await assert.rejects(writeZipArchive(archive, limits, controller.signal), error => error === reason);
  }
});

test("ZIP stripped DOS timestamps accept both occurrences of a repeated local hour", async () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/Chicago";
    for (const instant of ["2024-11-03T06:30:01Z", "2024-11-03T07:30:01Z"]) {
      const entry = await makeZipEntry("fold", text.encode("fold"), { ...attributes, modified: new Date(instant) }, limits, signal, 0);
      const stripped = updateZipExtras(entry, undefined, "strip", limits);
      const bytes = await writeZipArchive({ entries: [stripped], comment: new Uint8Array() }, limits, signal);
      const { view, central } = positions(bytes);
      assert.equal(view.getUint16(10, true), (1 << 11) | (30 << 5) | 1);
      assert.equal(view.getUint16(central + 12, true), view.getUint16(10, true));
      const restored = await readZipArchive(bytes, limits, signal);
      assert.equal(restored.entries[0]!.modified.getHours(), 1);
      assert.equal(restored.entries[0]!.modified.getMinutes(), 30);
      assert.equal(restored.entries[0]!.modified.getSeconds(), 2);
      assert.equal(restored.entries[0]!.centralExtra!.length, 0);
      assert.deepEqual(await writeZipArchive(restored, limits, signal), bytes);
      assert.deepEqual(await collectBytes(decodeZipEntry(restored.entries[0]!, limits, signal), collectOptions), text.encode("fold"));
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("ZIP repeated-hour timestamp boundaries retain strict metadata and cancellation checks", async () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/Chicago";
    for (const instant of ["2024-11-03T06:59:59Z", "2024-11-03T07:00:00Z", "2024-11-03T07:59:59Z", "2024-11-03T08:00:00Z"]) {
      const entry = await makeZipEntry("fold", text.encode("fold"), { ...attributes, modified: new Date(instant) }, limits, signal, 0);
      const stripped = updateZipExtras(entry, undefined, "strip", limits);
      const archive = { entries: [stripped], comment: new Uint8Array() };
      const bytes = await writeZipArchive(archive, limits, signal);
      const rounded = new Date(Math.ceil(entry.modified.getTime() / 2000) * 2000);
      const restored = (await readZipArchive(bytes, limits, signal)).entries[0]!;
      assert.equal(restored.modified.getHours(), rounded.getHours());
      assert.equal(restored.modified.getMinutes(), rounded.getMinutes());
      assert.equal(restored.modified.getSeconds(), rounded.getSeconds());
      for (const invalid of [{ ...stripped, dosTime: 0 }, { ...stripped, dosDate: 33 }, { ...entry, modified: new Date(entry.modified.getTime() + 2000), localExtra: restored.localExtra!, centralExtra: restored.centralExtra!, dosTime: restored.dosTime!, dosDate: restored.dosDate! }]) {
        await assert.rejects(streamZipArchive({ ...archive, entries: [invalid] }, limits, signal)[Symbol.asyncIterator]().next(), /timestamp metadata mismatch/);
      }
      const controller = new AbortController();
      const reason = new Error("cancel repeated-hour archive");
      const iterator = streamZipArchive(archive, limits, controller.signal)[Symbol.asyncIterator]();
      assert.equal((await iterator.next()).done, false);
      controller.abort(reason);
      await assert.rejects(iterator.next(), error => error === reason);
      await assert.rejects(readZipArchive(bytes, limits, controller.signal), error => error === reason);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("ZIP -X and -X- repeated-hour updates preserve untouched members and absolute UT time", async () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/Chicago";
    for (const option of ["-X", "-X-"]) {
      const original = fixture({ centralExtra: extra(0xbeef, Uint8Array.of(42)) });
      const fs = await commandFixture(original);
      const instant = Date.parse("2024-11-03T07:30:01Z");
      await fs.writeFile("/work/fold", text.encode("fold"));
      await fs.utimes!("/work/fold", instant, instant);
      const result = await execute("zip", fs, ["-q", option, "sample.zip", "fold"]);
      assert.equal(result.exitCode, 0, result.stderr);
      const restored = await readZipArchive(await fs.readFile("/work/sample.zip"), limits, signal);
      const untouched = (await readZipArchive(original, limits, signal)).entries[0]!;
      assert.deepEqual(restored.entries[0], untouched);
      const updated = restored.entries[1]!;
      assert.equal(updated.centralExtra!.length, option === "-X" ? 0 : 9);
      assert.equal(updated.modified.getTime(), option === "-X" ? Date.parse("2024-11-03T06:30:02Z") : instant);
      assert.deepEqual(await collectBytes(decodeZipEntry(updated, limits, signal), collectOptions), text.encode("fold"));
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("ZIP DOS permission cancellation preserves an existing member and archive", async () => {
  const bytes = fixture();
  const { view, central } = positions(bytes);
  view.setUint16(central + 4, 20, true); view.setUint32(central + 38, 1, true);
  const fs = await commandFixture(bytes);
  await fs.writeFile("/work/file.txt", text.encode("keep"));
  const controller = new AbortController();
  const reason = new Error("cancel DOS metadata staging");
  const create = fs.createStagedFile!.bind(fs);
  let attempts = 0;
  fs.createStagedFile = async (...args) => { attempts++; controller.abort(reason); return create(...args); };
  await assert.rejects(execute("unzip", fs, ["-o", "sample.zip"], {}, { signal: controller.signal }), error => error === reason);
  assert.equal(attempts, 1);
  assert.deepEqual(await fs.readFile("/work/file.txt"), text.encode("keep"));
  assert.deepEqual(await fs.readFile("/work/sample.zip"), bytes);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["binary", "file.txt", "folder", "sample.zip"]);
  await assert.rejects(readZipArchive(bytes, limits, controller.signal), error => error === reason);
  await assert.rejects(writeZipArchive({ entries: [], comment: new Uint8Array() }, limits, controller.signal), error => error === reason);
});

test("ZIP duplicate names retain member order and independent payloads", async () => {
  const entries = await Promise.all(["first", "last"].map(body => makeZipEntry("same", text.encode(body), attributes, limits, signal, 0)));
  const bytes = await writeZipArchive({ entries, comment: new Uint8Array() }, limits, signal);
  const archive = await readZipArchive(bytes, limits, signal);
  assert.deepEqual(archive.entries.map(entry => entry.name), ["same", "same"]);
  assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions), text.encode("first"));
  assert.deepEqual(await collectBytes(decodeZipEntry(archive.entries[1]!, limits, signal), collectOptions), text.encode("last"));
  const fs = await commandFixture(bytes);
  assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "same"])).stdout.toString(), "firstlast");
  const result = await execute("unzip", fs, ["-o", "sample.zip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.readFile("/work/same"), text.encode("last"));
});

test("ZIP duplicate directory names restore the first member metadata after extracting children", async () => {
  const first = await makeZipEntry("same/", new Uint8Array(), { ...attributes, directory: true, mode: 0o040700 }, limits, signal, 0);
  const lastTime = new Date(modified.getTime() + 4000);
  const last = await makeZipEntry("same/", new Uint8Array(), { ...attributes, modified: lastTime, directory: true, mode: 0o040750 }, limits, signal, 0);
  const child = await makeZipEntry("same/child", text.encode("child"), attributes, limits, signal, 0);
  const bytes = await writeZipArchive({ entries: [first, last, child], comment: new Uint8Array() }, limits, signal);
  const fs = await commandFixture(bytes);
  const result = await execute("unzip", fs, ["-o", "sample.zip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const stat = await fs.stat("/work/same");
  assert.equal(stat.mode & 0o777, 0o700);
  assert.equal(stat.mtimeMs, modified.getTime());
  assert.deepEqual(await fs.readFile("/work/same/child"), text.encode("child"));
  assert.deepEqual(await fs.readFile("/work/sample.zip"), bytes);
});

for (const action of ["cancel", "replace", "unsupported"] as const) {
  test(`ZIP duplicate directory metadata ${action} retains archive and refuses unsafe restoration`, async () => {
    const directory = await makeZipEntry("same/", new Uint8Array(), { ...attributes, directory: true, mode: 0o040700 }, limits, signal, 0);
    const bytes = await writeZipArchive({ entries: [directory, directory], comment: new Uint8Array() }, limits, signal);
    const fs = await commandFixture(bytes);
    await fs.mkdir("/work/same");
    const controller = new AbortController();
    const reason = new Error("cancel duplicate directory metadata");
    const prepare = fs.prepareDirectory!.bind(fs);
    let attempts = 0;
    fs.prepareDirectory = async (...args) => {
      attempts++;
      if (action === "cancel") controller.abort(reason);
      if (action === "replace") {
        await fs.rmdir!("/work/same");
        await fs.mkdir("/work/same");
        await fs.writeFile("/work/same/foreign", text.encode("keep"));
      }
      return prepare(...args);
    };
    const view = action === "unsupported" ? new Proxy(fs, { get(target, key) {
      if (key === "prepareDirectory") return undefined;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } }) : fs;
    const execution = execute("unzip", view, ["-o", "sample.zip"], {}, { signal: controller.signal });
    if (action === "cancel") await assert.rejects(execution, error => error === reason);
    else {
      const result = await execution;
      assert.equal(result.exitCode, 2);
      assert.match(result.stderr, action === "replace" ? /EAGAIN: resource temporarily unavailable/ : /atomic entry conditions/);
    }
    assert.equal(attempts, action === "unsupported" ? 0 : 1);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), bytes);
    if (action === "replace") assert.deepEqual(await fs.readFile("/work/same/foreign"), text.encode("keep"));
    assert.equal((await fs.readdir("/work")).some(entry => entry.name.startsWith(".unzip-")), false);
  });
}

test("ZIP unknown archive/destination identity refuses overwrite while byte inspection remains available", async () => {
  const bytes = fixture();
  const fs = await commandFixture(bytes);
  await fs.writeFile("/work/file.txt", text.encode("keep"));
  const unknown = new Proxy(fs, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === "stat" || key === "lstat") return async (...args: Parameters<typeof fs.stat>) => {
      const stat = await target[key](...args);
      const { identityScope: ignoredScope, dev: ignoredDevice, ino: ignoredInode, ...rest } = stat;
      return rest;
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await execute("unzip", unknown, ["-o", "sample.zip"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /unknown input-archive backing identity/);
  assert.deepEqual(await fs.readFile("/work/file.txt"), text.encode("keep"));
  assert.deepEqual(await fs.readFile("/work/sample.zip"), bytes);
  const pipe = await execute("unzip", unknown, ["-p", "sample.zip"]);
  assert.equal(pipe.exitCode, 0, pipe.stderr);
  assert.equal(pipe.stdout.toString(), "123456789");
});

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
    ["end version", bytes => bytes.writeUInt16LE(47, record + 14)],
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
test("ZIP64 end extraction versions admit supported features and reject unsupported neighbors", async () => {
  const original = Buffer.from(zip64Oracle.cases[0]!.archive, "base64");
  const record = Number(original.readBigUInt64LE(original.length - 34));
  for (const version of [44, 45, 46, 47, 65535]) {
    const bytes = Buffer.from(original);
    bytes.writeUInt16LE(version, record + 14);
    if (version === 45 || version === 46) {
      const archive = await readZipArchive(bytes, limits, signal);
      const body = await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), collectOptions);
      assert.deepEqual(Buffer.from(body), Buffer.from(zip64Oracle.cases[0]!.unzipStdout, "base64"));
      await assert.rejects(readZipArchive(bytes, { ...limits, maxArchiveBytes: bytes.length - 1 }, signal), /limit/);
    } else await assert.rejects(readZipArchive(bytes, limits, signal), /extraction version/);
    const controller = new AbortController();
    const reason = new Error("cancel ZIP64 end version admission");
    controller.abort(reason);
    await assert.rejects(readZipArchive(bytes, limits, controller.signal), error => error === reason);
  }
});

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
      invalid[central + position] = invalid[central + position]! ^ 1;
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


test("ZIP64 numeric encoders reject unsafe counters before mutating records", () => {
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    assert.throws(() => zip64Extra([value], new Uint8Array()), /invalid|unsafe/);
    for (let index = 0; index < 4; index++) {
      const bytes = new Uint8Array(76).fill(0xa5);
      const counters = [1, 2, 3, 4];
      counters[index] = value;
      assert.throws(() => writeZip64End(new DataView(bytes.buffer), 0, counters[0]!, counters[1]!, counters[2]!, counters[3]!), /invalid|unsafe/);
      assert.ok(bytes.every(byte => byte === 0xa5));
    }
  }
});

test("ZIP64 live expected size accepts the exact classic sentinel without payload allocation", async () => {
  const wideLimits = { ...limits, maxEntryBytes: 0x100000000, maxTotalBytes: 0x100000000, maxArchiveBytes: 0x100010000 };
  for (const size of [0xfffffffe, 0xffffffff, 0x100000000]) {
    const entry = { ...await makeZipEntry("virtual", new Uint8Array(), attributes, limits, signal, 0), expectedSize: size, source: (async function* () { yield new Uint8Array(); })() };
    const iterator = streamZipArchive({ entries: [entry], comment: new Uint8Array() }, wideLimits, signal)[Symbol.asyncIterator]();
    try {
      const header = (await iterator.next()).value!;
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      assert.equal(view.getUint32(22, true), size >= 0xffffffff ? 0xffffffff : 0);
    } finally { await iterator.return?.(); }
  }
});


test("ZIP64 member promotion is independent at sentinel neighbors and safe maximum", () => {
  for (const value of [0xfffffffe, 0xffffffff, 0x100000000, Number.MAX_SAFE_INTEGER]) for (let index = 0; index < 3; index++) {
    const counters = [7, 11, 13];
    counters[index] = value;
    const member = zip64Member(counters[0]!, counters[1]!, counters[2]!);
    const expected = counters.map(item => item >= 0xffffffff ? 0xffffffff : item);
    assert.deepEqual([member.size, member.compressed, member.offset], expected);
    assert.deepEqual(member.values, value >= 0xffffffff ? [value] : []);
    const extra = member.values.length ? zip64Extra(member.values, new Uint8Array()) : undefined;
    assert.deepEqual(zip64Fields(extra?.subarray(4), expected), counters);
    if (value >= 0xffffffff) assert.throws(() => zip64Member(counters[0]!, counters[1]!, counters[2]!, false, false), /disabled/);
  }
  assert.deepEqual(zip64Member(7, 11, 13, true).values, [7, 11, 13]);
  assert.deepEqual(zip64Member(7, 11, 13, false, true, true).values, [7, 11]);
});

test("ZIP64 end records promote counts and directory fields independently with correct locator", () => {
  for (const count of [65534, 65535, 65536]) for (const size of [0xfffffffe, 0xffffffff, 0x100000000]) for (const start of [0xfffffffe, 0xffffffff, 0x100000000]) {
    const bytes = zipEnd(count, size, start, text.encode("end"));
    const view = new DataView(bytes.buffer);
    const wide = count >= 65535 || size >= 0xffffffff || start >= 0xffffffff;
    const end = wide ? 76 : 0;
    assert.equal(bytes.length, end + 25);
    assert.equal(view.getUint16(end + 10, true), Math.min(count, 65535));
    assert.equal(view.getUint32(end + 12, true), Math.min(size, 0xffffffff));
    assert.equal(view.getUint32(end + 16, true), Math.min(start, 0xffffffff));
    if (wide) {
      assert.equal(view.getBigUint64(32, true), BigInt(count));
      assert.equal(view.getBigUint64(40, true), BigInt(size));
      assert.equal(view.getBigUint64(48, true), BigInt(start));
      assert.equal(view.getBigUint64(64, true), BigInt(start + size));
      assert.throws(() => zipEnd(count, size, start, new Uint8Array(), false, false), /disabled/);
    }
  }
  assert.throws(() => zipEnd(1, Number.MAX_SAFE_INTEGER, 1, new Uint8Array()), /unsafe/);
  assert.throws(() => zipEnd(1, 0, Number.MAX_SAFE_INTEGER, new Uint8Array()), /unsafe/);
});

for (const wide of [false, true]) for (const signed of [false, true]) {
  test(`ZIP descriptor encoder virtual boundary counters wide=${wide} signed=${signed}`, () => {
    for (const value of wide ? [0xfffffffe, 0xffffffff, 0x100000000, Number.MAX_SAFE_INTEGER] : [0, 1, 0xfffffffe]) {
      const bytes = zipDescriptor(0xffffffff, value, value, wide, signed);
      const view = new DataView(bytes.buffer);
      const base = signed ? 4 : 0;
      assert.equal(bytes.length, base + (wide ? 20 : 12));
      if (signed) assert.equal(view.getUint32(0, true), 0x08074b50);
      assert.equal(view.getUint32(base, true), 0xffffffff);
      assert.equal(wide ? view.getBigUint64(base + 4, true) : BigInt(view.getUint32(base + 4, true)), BigInt(value));
      assert.equal(wide ? view.getBigUint64(base + 12, true) : BigInt(view.getUint32(base + 8, true)), BigInt(value));
    }
    for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => zipDescriptor(1, invalid, 1, wide, signed), /invalid|unsafe/);
    if (!wide) assert.throws(() => zipDescriptor(1, 0xffffffff, 1, false, signed), /required/);
  });
}

test("ZIP64 automatic live widths and disabled policy preserve admission, cleanup and cancellation", async () => {
  const highLimits = { ...limits, maxEntryBytes: 0x100000000, maxTotalBytes: 0x100000000, maxArchiveBytes: 0x100010000 };
  let pulls = 0;
  let closes = 0;
  const body = text.encode("stream");
  const entry = { ...await makeZipEntry("live", new Uint8Array(), attributes, limits, signal, 0), source: (async function* () { try { pulls++; yield body; } finally { closes++; } })() };
  const bytes = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, highLimits, signal);
  assert.equal(new DataView(bytes.buffer).getUint16(4, true), 45);
  assert.equal(pulls, 1);
  assert.equal(closes, 1);
  const decoded = await readZipArchive(bytes, highLimits, signal);
  assert.deepEqual(await collectBytes(decodeZipEntry(decoded.entries[0]!, highLimits, signal), collectOptions), body);
  const central = bytes.findIndex((_, index) => index + 4 <= bytes.length && new DataView(bytes.buffer).getUint32(index, true) === 0x02014b50);
  assert.equal(new DataView(bytes.buffer).getUint32(central + 42, true), 0, "automatic size widths retain classic offset");
  const forbidden = { ...entry, size: 0, expectedSize: 0xffffffff, source: (async function* () { pulls++; yield body; })() };
  await assert.rejects(streamZipArchive({ entries: [forbidden], comment: new Uint8Array() }, highLimits, signal, false, false, false)[Symbol.asyncIterator]().next(), /disabled/);
  assert.equal(pulls, 1);
  const controller = new AbortController();
  const reason = new Error("ZIP64 boundary cancelled");
  const cancelled = streamZipArchive({ entries: [{ ...forbidden, source: (async function* () { pulls++; yield body; })() }], comment: new Uint8Array() }, highLimits, controller.signal)[Symbol.asyncIterator]();
  await cancelled.next();
  controller.abort(reason);
  await assert.rejects(cancelled.next(), error => error === reason);
  assert.equal(pulls, 1);
});


test("ZIP64 end encoder overwrites disk fields in a reused destination", () => {
  const bytes = new Uint8Array(76).fill(0xa5);
  const view = new DataView(bytes.buffer);
  writeZip64End(view, 0, 1, 2, 3, 5);
  for (const offset of [16, 20, 60]) assert.equal(view.getUint32(offset, true), 0);
});

test("ZIP64 member admission requires extraction version 45 for sentinel fields", async () => {
  const entry = await makeZipEntry("version", text.encode("a"), attributes, limits, signal, 0);
  const original = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal, false, true);
  const originalView = new DataView(original.buffer);
  const central = 30 + originalView.getUint16(26, true) + originalView.getUint16(28, true) + entry.data.length;
  for (const field of [20, 24, 42, 18, 22]) for (const version of [10, 20, 45]) {
    const bytes = new Uint8Array(original);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, version, true);
    view.setUint16(central + 6, version, true);
    for (const offset of [18, 22, central + 20, central + 24]) view.setUint32(offset, 1, true);
    view.setUint32(central + 42, 0, true);
    view.setUint32(field === 18 || field === 22 ? field : central + field, 0xffffffff, true);
    const centralExtra = central + 46 + view.getUint16(central + 28, true);
    view.setBigUint64(centralExtra + 4, field === 42 ? 0n : 1n, true);
    if (version < 45) await assert.rejects(readZipArchive(bytes, limits, signal), /ZIP64.*version/);
    else assert.equal((await readZipArchive(bytes, limits, signal)).entries.length, 1);
  }
  const controller = new AbortController();
  const reason = new Error("cancel ZIP64 version admission");
  controller.abort(reason);
  await assert.rejects(readZipArchive(original, limits, controller.signal), error => error === reason);
});

test("ZIP64 buffered record encoding promotes only expanded size at the sentinel", async () => {
  for (const size of [0xfffffffe, 0xffffffff, 0x100000000]) {
    const entry = { ...await makeZipEntry("virtual", text.encode("a"), attributes, limits, signal, 6, true), size };
    const highLimits = { ...limits, maxEntryBytes: 0x100000000, maxTotalBytes: 0x100000000 };
    const bytes = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, highLimits, signal);
    const view = new DataView(bytes.buffer);
    const localExtraLength = view.getUint16(28, true);
    const central = 30 + view.getUint16(26, true) + localExtraLength + entry.data.length;
    assert.equal(view.getUint32(18, true), entry.data.length);
    assert.equal(view.getUint32(22, true), Math.min(size, 0xffffffff));
    assert.equal(view.getUint32(central + 20, true), entry.data.length);
    assert.equal(view.getUint32(central + 24, true), Math.min(size, 0xffffffff));
    assert.equal(view.getUint32(central + 42, true), 0);
    const decoded = await readZipArchive(bytes, highLimits, signal);
    assert.equal(decoded.entries[0]!.size, size);
    if (size >= 0xffffffff) await assert.rejects(writeZipArchive({ entries: [entry], comment: new Uint8Array() }, highLimits, signal, false, false, false), /disabled/);
  }
});
