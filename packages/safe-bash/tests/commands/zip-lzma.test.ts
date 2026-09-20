import assert from "node:assert/strict";
import test from "node:test";
import { execute, fixture } from "./zip-standard-flags.helpers.js";
import vectors from "./fixtures/zip-lzma-independent.json" with { type: "json" };
import { toByteSource } from "../../src/contracts/index.js";
import { settings } from "../../src/commands/archive/internal.js";
import { decodeZipEntry, readZipArchive, makeZipEntry, writeZipArchive } from "../../src/commands/archive/zip-format.js";
import { zipLzma } from "../../src/commands/archive/zip/lzma.js";
import { CodecReader } from "../../src/commands/bytes/compression/codec.js";
import { createCodec } from "../../src/commands/bytes/compression/codec-loader.js";
import { boundedCodec, type BoundedCodecOptions, type CodecFactory } from "../../src/commands/bytes/compression/bounded-codec.js";
import type { RawCodecModule } from "../../src/commands/bytes/compression/native/types.js";
import xz from "../../src/commands/bytes/compression/native/generated/xz.mjs";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { archiveCommands } from "../../src/commands/archive/index.js";

// Python zipfile.ZIP_LZMA: independent ZIP framing and raw LZMA1 with EOS.
const oracle = Buffer.from("UEsDBD8AAgAOAIMYIliDFtyMFAAAAAEAAAABAAAAeAkEBQBdAACAAAA8Qfv////gAAAAUEsBAj8DPwACAA4AgxgiWIMW3IwUAAAAAQAAAAEAAAAAAAAAAAAAAIABAAAAAHhQSwUGAAAAAAEAAQAvAAAAMwAAAAAA", "base64");

test("unzip decodes independent ZIP LZMA1 EOS archive", async () => {
  const result = await execute("unzip", await fixture(oracle), ["-p", "sample.zip", "x"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.from("x"));
});

const limits = settings({});
const attributes = { modified: new Date("2024-01-02T03:04:06Z"), mode: 0o100644, directory: false, symlink: false };
const signal = () => new AbortController().signal;
async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) {
    assert.ok(chunk.length <= 65536);
    chunks.push(new Uint8Array(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

for (const vector of vectors.vectors) {
  test(`independent LZMA vector ${vector.name}`, async () => {
    const abort = signal();
    const expected = vector.repeat ? Buffer.alloc(vector.repeat, 65) : Buffer.from(vector.payload, "base64");
    const entry = vector.archive
      ? (await readZipArchive(Buffer.from(vector.archive, "base64"), limits, abort)).entries[0]!
      : { ...attributes, name: "x", data: Buffer.from(vector.stream!, "base64"), method: 14, size: expected.length, crc32: 0, flags: 0x800 };
    if (!vector.archive) {
      const stored = await makeZipEntry("x", expected, attributes, limits, abort, 0);
      entry.crc32 = stored.crc32;
    }
    assert.deepEqual(Buffer.from(await collect(decodeZipEntry(entry, limits, abort))), expected);
  });
}

const random = Uint8Array.from({ length: 4096 }, (_, i) => {
  let value = Math.imul(i + 1, 0x45d9f3b); value ^= value >>> 16; value = Math.imul(value, 0x45d9f3b);
  return (value ^ value >>> 16) & 255;
});
for (const [name, body] of [["empty", new Uint8Array()], ["small", Uint8Array.of(0, 255, 10)], ["incompressible", random], ["compressible", Buffer.alloc(10000, 65)]] as const) {
  for (const level of [1, 6, 9]) {
    test(`LZMA encode/decode ${name}, level ${level}, EOS and no EOS`, async () => {
      for (const eos of [true, false]) {
        const abort = signal();
        const reader = new CodecReader(toByteSource(body), abort);
        const encoded = await collect(zipLzma(reader, abort, { decode: false, level, eos, size: body.length }));
        await reader.close();
        const decodeReader = new CodecReader(toByteSource(encoded), abort);
        try {
          const decoded = await collect(zipLzma(decodeReader, abort, { decode: true, level: 1, eos, size: body.length }));
          assert.deepEqual(decoded, new Uint8Array(body));
          assert.equal(await decodeReader.chunk(), undefined);
        } finally { await decodeReader.close(); }
      }
    });
  }
}

for (const flags of [["-Zlzma"], ["--compression-method=lzma"], ["-Zl"], ["-Zlzma", "-fz"], ["-Zlzma", "-fd", "-T"], ["-Zlzma", "-P", "password"], ["-Zlzma", "-k"], ["-Zlzma", "-k", "-fd"]]) {
  test(`LZMA command flags, extraction version, and roundtrip ${flags}`, async () => {
    const fs = await fixture();
    const made = await execute("zip", fs, ["-q", ...flags, "out.zip", "folder/data"], { zipHost: { entropy: n => new Uint8Array(n) } });
    assert.equal(made.exitCode, 0, made.stderr);
    const bytes = await fs.readFile("/work/out.zip");
    const entry = (await readZipArchive(bytes, limits, signal())).entries[0]!;
    assert.equal(entry.method, 14);
    assert.equal(entry.flags! & 6, 2);
    assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint16(4, true), 63);
    const decoded = await execute("unzip", fs, ["-p", ...(flags.includes("-P") ? ["-P", "password"] : []), "out.zip", entry.name]);
    assert.equal(decoded.exitCode, 0, decoded.stderr);
    assert.deepEqual(decoded.stdout, Buffer.from(await fs.readFile("/work/folder/data")));
  });
}

test("LZMA SDK creation default and CLI override use actual Shell", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data", Buffer.alloc(4096, 65));
  const shell = new Shell({ fs }).use(archiveCommands({ zip: { compression: "lzma" } }));
  try {
    const result = await shell.exec("zip -q a.zip data; unzip -p a.zip");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "A".repeat(4096));
    assert.equal((await readZipArchive(await fs.readFile("/a.zip"), limits, signal())).entries[0]!.method, 14);
    assert.equal((await shell.exec("zip -q -Zstore b.zip data")).exitCode, 0);
    assert.equal((await readZipArchive(await fs.readFile("/b.zip"), limits, signal())).entries[0]!.method, 0);
  } finally { await shell.dispose(); }
});

const rawOptions: BoundedCodecOptions = { format: "xz", decompress: true, level: 1, singleMember: true,
  lzma: { dictionary: 8 * 1024 * 1024, properties: 93, eos: true, size: 200000 } };

test("LZMA pre-aborted and excessive model admission never acquire a codec", async () => {
  let creates = 0;
  const factory = () => { creates++; throw new Error("must not acquire"); };
  const controller = new AbortController();
  const reason = { stopped: "before acquisition" };
  controller.abort(reason);
  await assert.rejects(createCodec(rawOptions, controller.signal, factory), error => error === reason);
  await assert.rejects(createCodec({ ...rawOptions, lzma: { ...rawOptions.lzma!, dictionary: 8388609 } }, signal(), factory), /dictionary limit/u);
  await assert.rejects(createCodec({ ...rawOptions, lzma: { ...rawOptions.lzma!, properties: 44 } }, signal(), factory), /properties/u);
  assert.equal(creates, 0);
});

for (const phase of ["acquisition", "step", "input", "output", "retirement", "work"] as const) {
  test(`LZMA ${phase} cancellation/retirement releases actual native allocation`, async () => {
    const controller = new AbortController();
    const reason = { stopped: phase };
    const modules: RawCodecModule[] = [];
    const create: CodecFactory = (options, abort) => createCodec(options, abort, wasi => {
      const module = xz(wasi);
      modules.push(module);
      if (phase === "acquisition") {
        const initialize = module.bridge_create_lzma!.bind(module);
        module.bridge_create_lzma = (...args) => { const result = initialize(...args); controller.abort(reason); return result; };
      }
      if (phase === "step") {
        const step = module.bridge_step.bind(module);
        module.bridge_step = (...args) => { const result = step(...args); controller.abort(reason); return result; };
      }
      return module;
    });
    const bomb = vectors.vectors.find(v => v.name === "bomb")!;
    const entry = (await readZipArchive(Buffer.from(bomb.archive!, "base64"), limits, signal())).entries[0]!;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const reader = phase === "input" ? {
      chunk() { entered(); return new Promise<Uint8Array | undefined>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })); },
      restore() {},
    } : new CodecReader(toByteSource(phase === "work" ? Buffer.alloc(300000, 65) : entry.data.subarray(9)), controller.signal);
    const output = boundedCodec(reader, phase === "work" ? { ...rawOptions, decompress: false } : rawOptions, controller.signal, create);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (phase === "input") {
        const result = collect(output);
        await waiting;
        controller.abort(reason);
        await assert.rejects(result, error => error === reason);
      } else if (phase === "output" || phase === "retirement") {
        assert.equal((await output.next()).done, false);
        if (phase === "output") {
          controller.abort(reason);
          await assert.rejects(output.next(), error => error === reason);
        } else await output.return(undefined);
      } else {
        if (phase === "work") timer = setTimeout(() => controller.abort(reason), 0);
        await assert.rejects(collect(output), error => error === reason);
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      await output.return(undefined);
      if (reader instanceof CodecReader) await reader.close();
    }
    assert.equal(modules.length, 1);
    assert.equal(modules[0]!.bridge_used(), 0);
    assert.ok(modules[0]!.bridge_peak() <= 64 * 1024 * 1024);
  });
}

test("LZMA live ZIP source cancellation preserves reason, closes source, and does not publish a file", async () => {
  const fs = await fixture();
  const controller = new AbortController();
  const reason = { source: "cancelled" };
  let returned = false;
  const source = (async function* () {
    try { yield Buffer.alloc(131072, 65); controller.abort(reason); controller.signal.throwIfAborted(); }
    finally { returned = true; }
  })();
  await assert.rejects(execute("zip", fs, ["-qZlzma", "out.zip", "-"], {}, { stdin: source, signal: controller.signal }), error => error === reason);
  assert.equal(returned, true);
  await assert.rejects(fs.stat("/work/out.zip"));
});

test("LZMA no-EOS vectors reject every prefix, altered size, and trailing data", async () => {
  for (const vector of vectors.vectors.filter(v => v.stream)) {
    const body = Buffer.from(vector.payload, "base64");
    const wire = Buffer.from(vector.stream!, "base64");
    const abort = signal();
    const stored = await makeZipEntry("x", body, attributes, limits, abort, 0);
    const entry = { ...stored, method: 14, flags: 0x800, data: wire };
    for (let length = 0; length < wire.length; length++) await assert.rejects(collect(decodeZipEntry({ ...entry, data: wire.subarray(0, length) }, limits, abort)));
    for (const size of [body.length + 1, ...(body.length ? [body.length - 1] : [])]) await assert.rejects(collect(decodeZipEntry({ ...entry, size }, limits, abort)));
    await assert.rejects(collect(decodeZipEntry({ ...entry, data: Uint8Array.of(...wire, 0) }, limits, abort)), /trailing/u);
  }
});

test("LZMA property framing survives producer reuse and every byte partition", async () => {
  const abort = signal();
  const entry = (await readZipArchive(oracle, limits, abort)).entries[0]!;
  const slab = new Uint8Array(1);
  let closed = false;
  const reader = new CodecReader((async function* () {
    try { for (const byte of entry.data) { slab[0] = byte; yield slab; } }
    finally { slab.fill(0); closed = true; }
  })(), abort);
  try {
    assert.deepEqual(Buffer.from(await collect(zipLzma(reader, abort, { decode: true, level: 1, eos: true, size: 1 }))), Buffer.from("x"));
    assert.equal(await reader.chunk(), undefined);
  } finally { await reader.close(); }
  assert.equal(closed, true);
});

test("LZMA property framing does not duplicate a large producer slab before admission", async () => {
  const slab = new Uint8Array(2 * 1024 * 1024);
  slab.set([9, 4, 5, 0, 255, 0, 0, 16, 0]);
  let retained: Uint8Array | undefined;
  const reader = { async chunk() { return slab; }, restore(bytes: Uint8Array) { retained = bytes; } };
  await assert.rejects(collect(zipLzma(reader, signal(), { decode: true, level: 1, eos: true, size: 1 })), /properties/u);
  assert.ok(!retained || retained.buffer === slab.buffer, "no producer advancement requires an archive-sized owned copy");
});

for (const flags of [undefined, 0, 0x800, 2, 0x802]) {
  test(`LZMA fresh live format source advertises actual EOS for flags ${flags}`, async () => {
    const abort = signal();
    const body = Buffer.alloc(4096, 65);
    const stored = await makeZipEntry("x", body, attributes, limits, abort, 0);
    const entry = { ...stored, method: 14, data: new Uint8Array(), source: toByteSource(body), expectedSize: body.length, ...(flags === undefined ? {} : { flags }) };
    const archive = await readZipArchive(await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, abort), limits, abort);
    assert.equal(archive.entries[0]!.flags! & 2, 2);
    assert.deepEqual(Buffer.from(await collect(decodeZipEntry(archive.entries[0]!, limits, abort))), body);
  });
}

test("LZMA copy retains raw properties and EOS while mixed codecs remain readable", async () => {
  const abort = signal();
  const archive = await readZipArchive(oracle, limits, abort);
  const neighbors = await Promise.all((["deflate", "bzip2"] as const).map(method => makeZipEntry(method, Buffer.alloc(2000, 65), attributes, limits, abort, 6, true, method)));
  const stored = await makeZipEntry("stored", random, attributes, limits, abort, 0);
  const copy = await readZipArchive(await writeZipArchive({ entries: [...archive.entries, ...neighbors, stored], comment: new Uint8Array() }, limits, abort), limits, abort);
  assert.deepEqual(copy.entries.map(entry => entry.method), [14, 8, 12, 0]);
  assert.deepEqual(copy.entries[0]!.data, archive.entries[0]!.data);
  for (const entry of copy.entries) assert.equal((await collect(decodeZipEntry(entry, limits, abort))).length, entry.size);
});

test("LZMA buffered descriptor header retains known compressed span for streaming readers", async () => {
  const abort = signal();
  const entry = await makeZipEntry("x", Buffer.alloc(4096, 65), attributes, limits, abort, 6, true, "lzma");
  const bytes = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, abort, true);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  assert.equal(view.getUint16(6, true) & 10, 10);
  assert.equal(view.getUint32(18, true), entry.data.length);
  assert.equal(view.getUint32(22, true), entry.size);
});

for (const body of [new Uint8Array(), Uint8Array.of(0, 255), random]) {
  test(`LZMA stdout live stdin retains ${body.length} bytes and EOS`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, ["-qZlzma", "-", "-"], {}, { stdin: toByteSource(body) });
    assert.equal(result.exitCode, 0, result.stderr);
    const abort = signal();
    const entry = (await readZipArchive(result.stdout, limits, abort)).entries[0]!;
    assert.equal(entry.method, 14);
    assert.equal(entry.flags! & 10, 10);
    assert.deepEqual(await collect(decodeZipEntry(entry, limits, abort)), new Uint8Array(body));
  });
  test(`LZMA buffered ${body.length} bytes retains STORE fallback`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/data", body);
    const result = await execute("zip", fs, ["-qZlzma", "out.zip", "data"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await readZipArchive(await fs.readFile("/work/out.zip"), limits, signal())).entries[0]!.method, 0);
  });
}

for (const [offset, value] of [[0, 0], [1, 255], [2, 4], [2, 6], [3, 1], [4, 225], [4, 255], [4, 44], [8, 255]] as const) {
  test(`LZMA refuses malformed/excessive properties ${offset}:${value}`, async () => {
    const abort = signal();
    const entry = (await readZipArchive(oracle, limits, abort)).entries[0]!;
    entry.data[offset] = value;
    await assert.rejects(collect(decodeZipEntry(entry, limits, abort)), /LZMA.*(?:version|properties|dictionary)/u);
  });
}

for (const size of [0, 1, 4095, 4096, 8 * 1024 * 1024, 8 * 1024 * 1024 + 1]) {
  test(`LZMA dictionary admission boundary ${size}`, async () => {
    const abort = signal();
    const entry = (await readZipArchive(oracle, limits, abort)).entries[0]!;
    new DataView(entry.data.buffer, entry.data.byteOffset).setUint32(5, size, true);
    if (size > 8 * 1024 * 1024) await assert.rejects(collect(decodeZipEntry(entry, limits, abort)), /dictionary limit/u);
    else assert.deepEqual(Buffer.from(await collect(decodeZipEntry(entry, limits, abort))), Buffer.from("x"));
  });
}

test("LZMA rejects every strict payload prefix, including EOS truncation", async () => {
  const abort = signal();
  const entry = (await readZipArchive(oracle, limits, abort)).entries[0]!;
  for (let length = 0; length < entry.data.length; length++) {
    await assert.rejects(collect(decodeZipEntry({ ...entry, data: entry.data.subarray(0, length) }, limits, abort)), `prefix ${length}`);
  }
});

test("LZMA refuses EOS with clear flag, missing EOS with set flag, and trailing bytes", async () => {
  const abort = signal();
  const entry = (await readZipArchive(oracle, limits, abort)).entries[0]!;
  await assert.rejects(collect(decodeZipEntry({ ...entry, flags: 0x800 }, limits, abort)));
  const noEos = vectors.vectors.find(v => v.name === "native-no-eos-1")!;
  await assert.rejects(collect(decodeZipEntry({ ...entry, data: Buffer.from(noEos.stream!, "base64") }, limits, abort)));
  await assert.rejects(collect(decodeZipEntry({ ...entry, data: Uint8Array.of(...entry.data, 0) }, limits, abort)), /trailing compressed data/u);
});

for (const [kind, value] of [["version", 20], ["version", 46], ["version", 62], ["version", 64], ["flags", 4], ["flags", 6], ["flags", 16], ["flags", 64]] as const) {
  test(`LZMA rejects ${kind} ${value}`, async () => {
    const bytes = new Uint8Array(oracle);
    const view = new DataView(bytes.buffer);
    const central = oracle.indexOf(Buffer.from([0x50, 0x4b, 1, 2]));
    view.setUint16(kind === "version" ? 4 : 6, value, true);
    view.setUint16(central + (kind === "version" ? 6 : 8), value, true);
    await assert.rejects(readZipArchive(bytes, limits, signal()), /flags|version|encryption/u);
  });
}

test("LZMA actual output bomb cannot publish beyond declared size or byte budgets", async () => {
  const abort = signal();
  const bomb = vectors.vectors.find(v => v.name === "bomb")!;
  const entry = (await readZipArchive(Buffer.from(bomb.archive!, "base64"), limits, abort)).entries[0]!;
  for (const changed of [{ ...entry, size: 1 }, entry]) {
    let published = 0;
    await assert.rejects(async () => {
      for await (const chunk of decodeZipEntry(changed, { ...limits, maxEntryBytes: changed.size === 1 ? limits.maxEntryBytes : 1024 }, abort)) published += chunk.length;
    }, /byte limit/u);
    assert.equal(published, 0);
  }
});

test("LZMA malformed archive extraction preserves an existing destination", async () => {
  const abort = signal();
  const archive = await readZipArchive(oracle, limits, abort);
  archive.entries[0]!.data[4] = 255;
  const fs = await fixture(await writeZipArchive(archive, limits, abort));
  await fs.writeFile("/work/x", Buffer.from("retained"));
  const result = await execute("unzip", fs, ["-o", "sample.zip"]);
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(Buffer.from(await fs.readFile("/work/x")), Buffer.from("retained"));
});

for (const offset of [0, 1, 4, 8, 9]) {
  test(`LZMA cancellation after ${offset} property bytes closes reused source`, async () => {
    const controller = new AbortController();
    const reason = { propertyOffset: offset };
    const entry = (await readZipArchive(oracle, limits, signal())).entries[0]!;
    let closed = false;
    const slab = new Uint8Array(1);
    const reader = new CodecReader((async function* () {
      try {
        for (let i = 0; i < entry.data.length; i++) {
          if (i === offset) { controller.abort(reason); controller.signal.throwIfAborted(); }
          slab[0] = entry.data[i]!;
          yield slab;
        }
      } finally { slab.fill(0); closed = true; }
    })(), controller.signal);
    try {
      await assert.rejects(collect(zipLzma(reader, controller.signal, { decode: true, level: 1, eos: true, size: 1 })), error => error === reason);
    } finally { await reader.close(); }
    assert.equal(closed, true);
  });
}

test("LZMA EOS rejects wrong declared size and CRC with an independent valid control", async () => {
  const entry = (await readZipArchive(oracle, limits, signal())).entries[0]!;
  assert.deepEqual(Buffer.from(await collect(decodeZipEntry(entry, limits, signal()))), Buffer.from("x"));
  for (const size of [0, 2]) await assert.rejects(collect(decodeZipEntry({ ...entry, size }, limits, signal())), /byte limit|size mismatch/u);
  await assert.rejects(collect(decodeZipEntry({ ...entry, crc32: (entry.crc32 ^ 1) >>> 0 }, limits, signal())), /CRC32 mismatch/u);
});

test("LZMA archive update, copy, test, and deletion preserve neighboring codecs", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/neighbor", random);
  for (const args of [["-qZlzma", "out.zip", "folder/data"], ["-qZstore", "out.zip", "neighbor"], ["-T", "out.zip"]]) {
    const result = await execute("zip", fs, args);
    assert.equal(result.exitCode, 0, result.stderr);
  }
  const before = await readZipArchive(await fs.readFile("/work/out.zip"), limits, signal());
  assert.deepEqual(before.entries.map(entry => entry.method), [14, 0]);
  const copied = await execute("zip", fs, ["-q", "out.zip", "--out", "copy.zip"]);
  assert.equal(copied.exitCode, 0, copied.stderr);
  const copy = await readZipArchive(await fs.readFile("/work/copy.zip"), limits, signal());
  assert.deepEqual(copy.entries.map(entry => entry.data), before.entries.map(entry => entry.data));
  await fs.writeFile("/work/folder/data", Buffer.alloc(3000, 66));
  const updated = await execute("zip", fs, ["-qZlzma", "out.zip", "folder/data"]);
  assert.equal(updated.exitCode, 0, updated.stderr);
  const decoded = await execute("unzip", fs, ["-p", "out.zip", "folder/data"]);
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.deepEqual(decoded.stdout, Buffer.alloc(3000, 66));
  const deleted = await execute("zip", fs, ["-qd", "out.zip", "folder/data"]);
  assert.equal(deleted.exitCode, 0, deleted.stderr);
  const neighbor = await execute("unzip", fs, ["-p", "out.zip", "neighbor"]);
  assert.equal(neighbor.exitCode, 0, neighbor.stderr);
  assert.deepEqual(neighbor.stdout, Buffer.from(random));
});
