import { describe, expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createZipCodec, crc32, type ZipSource } from "@poe-code/office-package/zip";
import { storedArchive } from "../tests/fixtures/archive.js";
import { openPackageArchive } from "./retained-package.js";
import { resourceContext } from "./resource-limits.js";

const encode = (value: string) => new TextEncoder().encode(value);
const context = resourceContext({ archiveLimits: { chunkSize: 16384 } });
const zip = createZipCodec(undefined, { zip64: true, rejectDuplicateNames: true, utcDates: true });

function working() {
  const fs = createMemoryFileSystem();
  const open = fs.open!.bind(fs);
  const metrics = { opened: 0, closed: 0, written: 0, read: 0, maximum: 0, outstanding: 0, peakOutstanding: 0 };
  fs.readFile = async () => { throw new Error("whole-file read forbidden"); };
  fs.writeFile = async () => { throw new Error("whole-file write forbidden"); };
  fs.open = async (...args) => {
    metrics.opened++;
    const descriptor = await open(...args);
    const overrides: Pick<typeof descriptor, "read" | "write" | "close"> = {
      async read(bytes, position, options) {
        metrics.read += bytes.length;
        metrics.maximum = Math.max(metrics.maximum, bytes.length);
        metrics.outstanding += bytes.length;
        metrics.peakOutstanding = Math.max(metrics.peakOutstanding, metrics.outstanding);
        try { return await descriptor.read(bytes, position, options); }
        finally { metrics.outstanding -= bytes.length; }
      },
      async write(bytes, position, options) {
        metrics.written += bytes.length;
        metrics.maximum = Math.max(metrics.maximum, bytes.length);
        metrics.outstanding += bytes.length;
        metrics.peakOutstanding = Math.max(metrics.peakOutstanding, metrics.outstanding);
        try { return await descriptor.write(bytes, position, options); }
        finally { metrics.outstanding -= bytes.length; }
      },
      async close(options) { metrics.closed++; return descriptor.close(options); }
    };
    return new Proxy(descriptor, { get(target, key) {
      if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  return { fs, metrics, directory: "/", cacheBytes: 16384 };
}

function borrowed(bytes: Uint8Array): ZipSource {
  const response = new Uint8Array(16384);
  return { size: bytes.length, async read(position, maximum) {
    expect(maximum).toBeLessThanOrEqual(response.length);
    const size = Math.min(maximum, bytes.length - position);
    response.set(bytes.subarray(position, position + size));
    return response.subarray(0, size);
  } };
}

/** Only ZIP headers and one reused payload chunk are resident, regardless of size. */
function generated(size: number): ZipSource {
  const empty = storedArchive([{ name: "large.bin", bytes: new Uint8Array() }]);
  const headerLength = 30 + encode("large.bin").length;
  const header = empty.slice(0, headerLength), tail = empty.slice(headerLength);
  const chunk = new Uint8Array(16384).fill(42);
  let checksum = 0;
  for (let offset = 0; offset < size; offset += chunk.length) checksum = crc32(chunk.subarray(0, Math.min(chunk.length, size - offset)), checksum);
  const local = new DataView(header.buffer), central = new DataView(tail.buffer);
  local.setUint16(4, 10, true); central.setUint16(6, 10, true);
  local.setUint32(14, checksum, true); local.setUint32(18, size, true); local.setUint32(22, size, true);
  central.setUint32(16, checksum, true); central.setUint32(20, size, true); central.setUint32(24, size, true);
  central.setUint32(tail.length - 6, headerLength + size, true);
  return { size: empty.length + size, async read(position, maximum) {
    expect(maximum).toBeLessThanOrEqual(chunk.length);
    const count = Math.min(maximum, empty.length + size - position);
    chunk.fill(42);
    for (let offset = 0; offset < count; offset++) {
      const index = position + offset;
      if (index < headerLength) chunk[offset] = header[index]!;
      else if (index >= headerLength + size) chunk[offset] = tail[index - headerLength - size]!;
    }
    return chunk.subarray(0, count);
  } };
}

describe("caller-backed package archive", () => {
  it("indexes names in caller storage and streams members with case-insensitive lookup", async () => {
    const backing = working();
    const members = Array.from({ length: 300 }, (_, index) => ({ name: `ppt/part-${index}.xml`, bytes: encode(`<p n="${index}"/>`) }));
    const archive = await openPackageArchive(borrowed(storedArchive(members)), { ...context, workingStorage: backing });
    try {
      expect(archive.entryCount).toBe(300);
      let index = 0;
      for await (const part of archive.parts()) expect(part).toBe("/" + members[index++]!.name);
      expect(index).toBe(300);
      expect(await archive.has("/PPT/PART-1.XML")).toBe(true);
      expect(await archive.has("/absent")).toBe(false);
      const chunks = [];
      for await (const bytes of archive.read("/PPT/PART-1.XML")) chunks.push(...bytes);
      expect(new Uint8Array(chunks)).toEqual(members[1]!.bytes);
      expect(await archive.byteLength("/ppt/part-1.xml")).toBe(members[1]!.bytes.length);
      expect(backing.metrics.written).toBeGreaterThan(backing.cacheBytes);
      expect(backing.metrics.maximum).toBeLessThanOrEqual(16384);
    } finally { await archive.close(); }
    expect(backing.metrics.closed).toBe(backing.metrics.opened);
    expect(await backing.fs.readdir("/")).toEqual([]);
    await expect(archive.has("/ppt/part-1.xml")).rejects.toMatchObject({ code: "invalid-handle" });
  });

  it.each([65537, 2 * 1024 * 1024 + 1])("streams a generated %i-byte member without retaining its body", async size => {
    const backing = working();
    const archive = await openPackageArchive(generated(size), { ...context, workingStorage: backing });
    try {
      let length = 0;
      for await (const chunk of archive.read("/large.bin")) {
        expect(chunk.length).toBeLessThanOrEqual(16384);
        expect(chunk.every(byte => byte === 42)).toBe(true);
        length += chunk.length;
        await Promise.resolve(); // The next pull waits for this consumer.
      }
      expect(length).toBe(size);
      expect(backing.metrics.written).toBeLessThan(65536); // Metadata only: no hidden payload spool.
    } finally { await archive.close(); }
  });

  it.each([
    ["a", "A"], ["a", "a/b"], ["a/b", "a"], ["a/", "a"], ["../escape"]
  ].map(names => ({ names })))("rejects unsafe or colliding parts $names", async ({ names }) => {
    const backing = working();
    await expect(openPackageArchive(borrowed(storedArchive(names.map(name => ({ name, bytes: name.endsWith("/") ? new Uint8Array() : encode("x"), mode: name.endsWith("/") ? 0o40755 : 0o100644 })))), {
      ...context, workingStorage: backing
    })).rejects.toMatchObject({ code: names[0] === "../escape" ? "invalid-archive" : "invalid-opc" });
    expect(backing.metrics.closed).toBe(backing.metrics.opened);
  });

  it("retains byte ownership across simultaneous member streams", async () => {
    const backing = working();
    const bytes = storedArchive([1, 2].map(n => ({ name: `part-${n}`, bytes: new Uint8Array(32769).fill(n) })));
    const archive = await openPackageArchive(borrowed(bytes), { ...context, workingStorage: backing });
    try {
      await Promise.all([1, 2].map(async n => {
        let length = 0;
        for await (const chunk of archive.read(`/part-${n}`)) {
          await Promise.resolve();
          expect(chunk.every(byte => byte === n)).toBe(true);
          length += chunk.length;
        }
        expect(length).toBe(32769);
      }));
    } finally { await archive.close(); }
  });

  it("streams a rewritten archive through caller storage to a slow sink", async () => {
    const backing = working();
    const bytes = storedArchive([{ name: "keep.bin", bytes: encode("original") }, { name: "replace.xml", bytes: encode("<old/>") }]);
    const archive = await openPackageArchive(borrowed(bytes), { ...context, workingStorage: backing });
    const output: number[] = [];
    let writes = 0, active = 0;
    try {
      await archive.rewrite({ async write(chunk) {
        expect(++active).toBe(1);
        expect(chunk.length).toBeLessThanOrEqual(16384);
        const before = chunk.slice();
        await Promise.resolve();
        expect(chunk).toEqual(before);
        output.push(...chunk); writes++; active--;
      } }, { async replace(part) {
        if (part === "/replace.xml") return (async function* () { yield encode("<new/>"); })();
        return undefined;
      }, compression: "store" });
      const parsed = await zip.readZipArchive(new Uint8Array(output), context.archiveLimits, new AbortController().signal);
      expect(parsed.entries.map(entry => entry.name)).toEqual(["keep.bin", "replace.xml"]);
      expect(parsed.entries[0]!.data).toEqual(encode("original"));
      expect(parsed.entries[1]!.data).toEqual(encode("<new/>"));
      expect(writes).toBeGreaterThan(0);
    } finally { await archive.close(); }
  });

  it("closes spill descriptors after a failed scan and preserves cancellation", async () => {
    const backing = working();
    const controller = new AbortController();
    const failure = new Error("cancel archive");
    const bytes = storedArchive(Array.from({ length: 200 }, (_, n) => ({ name: `p${n}`, bytes: encode("payload") })));
    const source = borrowed(bytes);
    let reads = 0;
    await expect(openPackageArchive({ size: source.size, async read(...args) {
      if (backing.metrics.opened && ++reads === 10) controller.abort(failure);
      return source.read(...args);
    } }, { ...context, signal: controller.signal, workingStorage: backing })).rejects.toMatchObject({ code: "cancelled" });
    expect(backing.metrics.opened).toBeGreaterThan(0);
    expect(backing.metrics.closed).toBe(backing.metrics.opened);
    expect(await backing.fs.readdir("/")).toEqual([]);
  });
});

it("stages a generated archive externally before its first output and preserves every byte", async () => {
  const backing = working();
  const source = generated(2 * 1024 * 1024 + 17);
  const archive = await openPackageArchive(source, { ...context, workingStorage: backing });
  let emitted = 0, active = 0;
  let sinkFailure: unknown;
  try {
    await archive.rewrite({ async write(chunk) {
      try {
      expect(++active).toBe(1);
      expect(backing.metrics.written).toBeGreaterThan(2 * 1024 * 1024);
      expect(chunk.length).toBeLessThanOrEqual(16384);
      const expected = await source.read(emitted, chunk.length, { signal: new AbortController().signal });
      expect(chunk.length).toBe(expected.length);
      expect(chunk.every((byte, index) => byte === expected[index])).toBe(true);
      await Promise.resolve();
      emitted += chunk.length; active--;
      } catch (error) { sinkFailure = error; throw error; }
    } }).catch(error => { throw sinkFailure ?? error; });
    expect(emitted).toBe(source.size);
    expect(backing.metrics.opened).toBe(1);
    expect(backing.metrics.maximum).toBeLessThanOrEqual(16384);
    expect(backing.metrics.peakOutstanding).toBeLessThanOrEqual(16384);
    expect(backing.metrics.outstanding).toBe(0);
  } finally { await archive.close(); }
  expect(backing.metrics.closed).toBe(1);
});

it("removes and adds members without buffering and rejects directory aliases before output", async () => {
  const backing = working();
  const archive = await openPackageArchive(borrowed(storedArchive([
    { name: "dir/", mode: 0o40755, bytes: new Uint8Array() },
    { name: "remove", bytes: encode("old") },
    { name: "keep", bytes: encode("kept") }
  ])), { ...context, workingStorage: backing });
  const output: number[] = [];
  try {
    await archive.rewrite({ async write(chunk) { output.push(...chunk); } }, {
      async replace(part) { return part === "/remove" ? null : undefined; },
      additions: (async function* () { yield { part: "/added", source: (async function* () { yield encode("new"); })() }; })(),
      compression: "store"
    });
    const parsed = await zip.readZipArchive(new Uint8Array(output), context.archiveLimits, new AbortController().signal);
    expect(parsed.entries.map(entry => entry.name)).toEqual(["dir/", "keep", "added"]);
    let written = false;
    await expect(archive.rewrite({ async write() { written = true; } }, {
      additions: (async function* () { yield { part: "/DIR", source: (async function* () { yield encode("bad"); })() }; })()
    })).rejects.toMatchObject({ code: "invalid-opc" });
    expect(written).toBe(false);
  } finally { await archive.close(); }
});

it.each(["read", "write", "sink", "cancel"] as const)("retires spilled storage after injected %s failure", async mode => {
  const backing = working();
  const controller = new AbortController();
  const source = generated(128 * 1024 + 1);
  let failingRead = false;
  const archive = await openPackageArchive({ size: source.size, async read(...args) {
    if (failingRead) throw new Error("private backend error");
    return source.read(...args);
  } }, { ...context, signal: controller.signal, workingStorage: backing });
  if (mode === "write") {
    const open = backing.fs.open!.bind(backing.fs);
    backing.fs.open = async (...args) => {
      const descriptor = await open(...args);
      return new Proxy(descriptor, { get(target, key) {
        if (key === "write") return async () => { throw new Error("private storage failure"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    };
  }
  failingRead = mode === "read";
  let written = 0;
  try {
    await expect(archive.rewrite({ async write(chunk) {
      written += chunk.length;
      if (mode === "cancel") controller.abort(new Error("stop output"));
      if (mode === "sink") throw new Error("private sink failure");
    } })).rejects.toMatchObject({ code: mode === "cancel" ? "cancelled" : "io-failure" });
    if (mode === "read" || mode === "write") expect(written).toBe(0);
  } finally { await archive.close(); }
  expect(backing.metrics.closed).toBe(backing.metrics.opened);
  expect(await backing.fs.readdir("/")).toEqual([]);
});

it("matches the buffered codec for deflated members and retained archive metadata", async () => {
  const backing = working();
  const signal = new AbortController().signal;
  const entry = await zip.makeZipEntry("ppt/slide.xml", encode("<a>" + "hello".repeat(1000) + "</a>"), {
    modified: new Date("2020-01-02T03:04:06Z"), mode: 0o100640, directory: false, symlink: false, compression: "deflate"
  }, context.archiveLimits, signal);
  entry.comment = encode("member comment");
  const original = await zip.writeZipArchive({ entries: [entry], comment: encode("archive comment") }, context.archiveLimits, signal);
  const archive = await openPackageArchive(borrowed(original), { ...context, workingStorage: backing });
  const output: number[] = [];
  try {
    await archive.rewrite({ async write(chunk) { output.push(...chunk); } });
    expect(new Uint8Array(output)).toEqual(original);
  } finally { await archive.close(); }
});
