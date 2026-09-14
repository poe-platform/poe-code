import { describe, expect, it } from "vitest";
import { createCompressionCodec } from "./compression.js";
import { createZipCodec, type ZipEntry } from "./zip.js";

const limits = {
  maxArchiveBytes: 65536,
  maxEntryBytes: 4096,
  maxTotalBytes: 8192,
  maxMembers: 10,
  maxPathBytes: 256,
  maxDepth: 16,
  maxPaxBytes: 1024,
  maxTextBytes: 1024,
  chunkSize: 512
};
const signal = new AbortController().signal;

// A literal raw DEFLATE block and independently known CRC for nine ASCII digits.
const content = new TextEncoder().encode("123456789");
const compressed = Uint8Array.of(0x33, 0x34, 0x32, 0x36, 0x31, 0x35, 0x33, 0xb7, 0xb0, 0x04, 0x00);

function archive(method: number, descriptor: number, extended = false, opaque = false): Uint8Array {
  const payload = method ? compressed : content;
  const extraLength = (extended ? 20 : 0) + (opaque ? 5 : 0);
  const centralExtraLength = (extended ? 28 : 0) + (opaque ? 5 : 0);
  const descriptorLength = descriptor ? (extended ? 20 : 12) + (descriptor === 2 ? 4 : 0) : 0;
  const central = 31 + extraLength + payload.length + descriptorLength;
  const tail = central + 47 + centralExtraLength;
  const end = tail + (extended ? 76 : 0);
  const bytes = new Uint8Array(end + 22);
  const view = new DataView(bytes.buffer);
  const u16 = (at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (at: number, value: number) => view.setUint32(at, value, true);
  const u64 = (at: number, value: number) => view.setBigUint64(at, BigInt(value), true);
  u32(0, 0x04034b50);
  u16(4, extended ? 45 : 20);
  u16(6, descriptor ? 8 : 0);
  u16(8, method);
  u32(14, descriptor ? 0 : 0xcbf43926);
  u32(18, extended ? 0xffffffff : descriptor ? 0 : payload.length);
  u32(22, extended ? 0xffffffff : descriptor ? 0 : 9);
  u16(26, 1);
  u16(28, extraLength);
  bytes[30] = 120;
  if (extended) {
    u16(31, 1);
    u16(33, 16);
    u64(35, 9);
    u64(43, payload.length);
  }
  if (opaque) {
    const at = 31 + (extended ? 20 : 0);
    u16(at, 0xbeef);
    u16(at + 2, 1);
    bytes[at + 4] = 79;
  }
  bytes.set(payload, 31 + extraLength);
  if (descriptor) {
    let at = central - descriptorLength;
    if (descriptor === 2) {
      u32(at, 0x08074b50);
      at += 4;
    }
    u32(at, 0xcbf43926);
    if (extended) {
      u64(at + 4, payload.length);
      u64(at + 12, 9);
    } else {
      u32(at + 4, payload.length);
      u32(at + 8, 9);
    }
  }
  u32(central, 0x02014b50);
  u16(central + 4, 45);
  u16(central + 6, extended ? 45 : 20);
  u16(central + 8, descriptor ? 8 : 0);
  u16(central + 10, method);
  u32(central + 16, 0xcbf43926);
  u32(central + 20, extended ? 0xffffffff : payload.length);
  u32(central + 24, extended ? 0xffffffff : 9);
  u16(central + 28, 1);
  u16(central + 30, centralExtraLength);
  u32(central + 42, extended ? 0xffffffff : 0);
  bytes[central + 46] = 120;
  if (extended) {
    u16(central + 47, 1);
    u16(central + 49, 24);
    u64(central + 51, 9);
    u64(central + 59, payload.length);
    u64(central + 67, 0);
    u32(tail, 0x06064b50);
    u64(tail + 4, 44);
    u16(tail + 12, 45);
    u16(tail + 14, 45);
    u64(tail + 24, 1);
    u64(tail + 32, 1);
    u64(tail + 40, tail - central);
    u64(tail + 48, central);
    u32(tail + 56, 0x07064b50);
    u64(tail + 64, tail);
    u32(tail + 72, 1);
  }
  if (opaque) {
    const at = central + 47 + (extended ? 28 : 0);
    u16(at, 0xbeef);
    u16(at + 2, 1);
    bytes[at + 4] = 79;
  }
  u32(end, 0x06054b50);
  u16(end + 8, extended ? 65535 : 1);
  u16(end + 10, extended ? 65535 : 1);
  u32(end + 12, extended ? 0xffffffff : tail - central);
  u32(end + 16, extended ? 0xffffffff : central);
  return bytes;
}

async function decoded(bytes: Uint8Array, extended = false): Promise<Uint8Array> {
  const zip = createZipCodec(undefined, { zip64: extended, rejectDuplicateNames: true });
  const parsed = await zip.readZipArchive(bytes, limits, signal);
  const result: number[] = [];
  for await (const chunk of zip.decodeZipEntry(parsed.entries[0]!, limits, signal))
    result.push(...chunk);
  return Uint8Array.from(result);
}

describe("bounded package archive", () => {
  it("preserves a leading byte order mark as literal filename content", async () => {
    const zip = createZipCodec();
    const entry = await zip.makeZipEntry(
      "\uFEFFx",
      content,
      {
        modified: new Date("2020-01-01T00:00:00Z"),
        mode: 0o100644,
        directory: false,
        symlink: false
      },
      limits,
      signal
    );
    const bytes = await zip.writeZipArchive(
      { entries: [entry], comment: new Uint8Array() },
      limits,
      signal
    );
    expect(bytes.subarray(30, 34)).toEqual(Uint8Array.of(0xef, 0xbb, 0xbf, 0x78));
    expect((await zip.readZipArchive(bytes, limits, signal)).entries[0]!.name).toBe("\uFEFFx");
  });
  for (const method of [0, 8])
    for (const descriptor of [0, 1, 2])
      for (const extended of [false, true]) {
        it(`decodes method ${method}, descriptor ${descriptor}, extended fields ${extended}`, async () => {
          expect(await decoded(archive(method, descriptor, extended), extended)).toEqual(content);
        });
      }
  it("rejects extended records in the classic profile", async () => {
    await expect(decoded(archive(0, 0, true))).rejects.toThrow();
  });
  it("reads extended entry sizes under an ordinary end record", async () => {
    const original = archive(0, 0, true);
    const bytes = new Uint8Array(157);
    bytes.set(original.subarray(0, 135));
    bytes.set(original.subarray(211), 135);
    const view = new DataView(bytes.buffer);
    view.setUint16(143, 1, true);
    view.setUint16(145, 1, true);
    view.setUint32(147, 75, true);
    view.setUint32(151, 60, true);
    expect(await decoded(bytes, true)).toEqual(content);
  });
  it("accepts independently populated classic counts beside extended counts", async () => {
    for (const at of [219, 221]) {
      const bytes = archive(0, 0, true);
      new DataView(bytes.buffer).setUint16(at, 1, true);
      expect(await decoded(bytes, true)).toEqual(content);
    }
  });
  it("requires the extended extraction version when entry fields use extended widths", async () => {
    const bytes = archive(0, 0, true);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, 20, true);
    view.setUint16(66, 20, true);
    await expect(decoded(bytes, true)).rejects.toThrow("version");
  });

  it("rejects every truncated prefix, wrong checksums and local disagreements", async () => {
    for (const extended of [false, true]) {
      const original = archive(0, 0, extended);
      for (let length = 0; length < original.length; length++)
        await expect(decoded(original.subarray(0, length), extended)).rejects.toThrow();
      const central = extended ? 60 : 40;
      for (const at of [4, 6, 8, 10, 14, 18, 22, 30]) {
        const bytes = original.slice();
        bytes[at] = bytes[at]! ^ 1;
        await expect(decoded(bytes, extended)).rejects.toThrow();
      }
      const badCrc = original.slice();
      new DataView(badCrc.buffer).setUint32(14, 0, true);
      new DataView(badCrc.buffer).setUint32(central + 16, 0, true);
      await expect(decoded(badCrc, extended)).rejects.toThrow("CRC32");
    }
  });

  it("rejects encryption and multi-disk records", async () => {
    const original = archive(0, 0);
    for (const flag of [1, 64, 0x2000]) {
      const bytes = original.slice();
      const view = new DataView(bytes.buffer);
      view.setUint16(6, flag, true);
      view.setUint16(48, flag, true);
      await expect(decoded(bytes)).rejects.toThrow("encryption");
    }
    for (const at of [74, 91, 93]) {
      const bytes = original.slice();
      bytes[at] = 1;
      await expect(decoded(bytes)).rejects.toThrow();
    }
  });

  it("rejects expansion that is shorter or longer than both header declarations", async () => {
    for (const size of [8, 10]) {
      const bytes = archive(8, 0);
      const view = new DataView(bytes.buffer);
      view.setUint32(22, size, true);
      view.setUint32(42 + 24, size, true);
      await expect(decoded(bytes)).rejects.toThrow("uncompressed size mismatch");
    }
  });

  it("rejects duplicate names with distinct local spans", async () => {
    const original = archive(0, 0);
    const bytes = new Uint8Array(196);
    const view = new DataView(bytes.buffer);
    bytes.set(original.subarray(0, 40), 0);
    bytes.set(original.subarray(0, 40), 40);
    bytes.set(original.subarray(40, 87), 80);
    bytes.set(original.subarray(40, 87), 127);
    view.setUint32(127 + 42, 40, true);
    bytes.set(original.subarray(87), 174);
    view.setUint16(182, 2, true);
    view.setUint16(184, 2, true);
    view.setUint32(186, 94, true);
    view.setUint32(190, 80, true);
    await expect(decoded(bytes)).rejects.toThrow("duplicate");
    expect((await createZipCodec().readZipArchive(bytes, limits, signal)).entries).toHaveLength(2);
  });

  it("rejects unsafe extended values, missing locators and descriptor disagreements", async () => {
    const original = archive(0, 0, true);
    for (const at of [35, 43, 111, 119, 127, 159, 167, 175, 183, 199]) {
      const bytes = original.slice();
      new DataView(bytes.buffer).setBigUint64(at, 1n << 63n, true);
      await expect(decoded(bytes, true)).rejects.toThrow();
    }
    for (const at of [33, 109, 135, 149, 151, 155, 191, 195, 207]) {
      const bytes = original.slice();
      bytes[at] = bytes[at]! ^ 1;
      await expect(decoded(bytes, true)).rejects.toThrow();
    }
    for (const signed of [1, 2]) {
      const bytes = archive(0, signed, true);
      bytes[60 + (signed === 2 ? 4 : 0)] = 0;
      await expect(decoded(bytes, true)).rejects.toThrow("descriptor");
    }
  });

  it("removes consumed extended fields while retaining unknown extra bytes", async () => {
    const zip = createZipCodec(undefined, { zip64: true });
    const parsed = await zip.readZipArchive(archive(0, 0, true, true), limits, signal);
    expect(parsed.entries[0]!.localExtra).toEqual(Uint8Array.of(0xef, 0xbe, 1, 0, 79));
    expect(parsed.entries[0]!.centralExtra).toEqual(Uint8Array.of(0xef, 0xbe, 1, 0, 79));
    expect(await decoded(await zip.writeZipArchive(parsed, limits, signal))).toEqual(content);
  });

  it("owns input before the first asynchronous read checkpoint", async () => {
    const zip = createZipCodec();
    const bytes = archive(0, 0);
    const pending = zip.readZipArchive(bytes, limits, signal);
    bytes.fill(0);
    const parsed = await pending;
    expect(parsed.entries[0]!.data).toEqual(content);
  });

  it("owns creation bytes before calculating CRC across checkpoints", async () => {
    const zip = createZipCodec();
    const bytes = content.slice();
    const pending = zip.makeZipEntry(
      "x",
      bytes,
      { modified: new Date("2020-01-01Z"), mode: 0o100644, directory: false, symlink: false },
      limits,
      signal
    );
    bytes.fill(0);
    const entry = await pending;
    expect(entry.data).toEqual(content);
    expect(entry.crc32).toBe(0xcbf43926);
  });

  it("enforces duplicate policy during writing", async () => {
    const zip = createZipCodec(undefined, { rejectDuplicateNames: true });
    const entry = (await zip.readZipArchive(archive(0, 0), limits, signal)).entries[0]!;
    await expect(
      zip.writeZipArchive({ entries: [entry, entry], comment: new Uint8Array() }, limits, signal)
    ).rejects.toThrow("duplicate");
  });

  it("writes UTC DOS fields independently of the host timezone", async () => {
    const previous = process.env.TZ;
    process.env.TZ = "Etc/GMT+5";
    try {
      const zip = createZipCodec(undefined, { utcDates: true });
      const entry: ZipEntry = {
        name: "x",
        data: content,
        size: 9,
        method: 0,
        crc32: 0xcbf43926,
        modified: new Date("2040-01-02T03:04:06Z"),
        mode: 0o100644,
        directory: false,
        symlink: false
      };
      const bytes = await zip.writeZipArchive(
        { entries: [entry], comment: new Uint8Array() },
        limits,
        signal
      );
      expect(new DataView(bytes.buffer).getUint16(10, true)).toBe((3 << 11) | (4 << 5) | 3);
      expect(
        (await zip.readZipArchive(bytes, limits, signal)).entries[0]!.modified.toISOString()
      ).toBe("2040-01-02T03:04:06.000Z");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});

describe("checked package writing", () => {
  const attributes = {
    modified: new Date("2020-01-01Z"),
    mode: 0o100644,
    directory: false,
    symlink: false
  };
  const zip = createZipCodec(undefined, { zip64: true, validatePayloads: true });

  it.each(["store", "deflate"] as const)(
    "honors explicit %s for empty and binary parts",
    async (compression) => {
      for (const payload of [
        new Uint8Array(),
        Uint8Array.of(0, 255, 128, 1),
        new Uint8Array(1024)
      ]) {
        const entry = await zip.makeZipEntry(
          "part",
          payload,
          { ...attributes, compression },
          limits,
          signal
        );
        expect(entry.method).toBe(compression === "store" ? 0 : 8);
        const output = await zip.writeZipArchive(
          { entries: [entry], comment: new Uint8Array() },
          limits,
          signal
        );
        expect(await decoded(output)).toEqual(payload);
      }
    }
  );

  it("rejects invalid payload declarations before returning an archive", async () => {
    const entry = (await zip.readZipArchive(archive(8, 0), limits, signal)).entries[0]!;
    for (const patch of [
      { size: 8 },
      { size: 10 },
      { crc32: 0 },
      { data: Uint8Array.of(...compressed, 0) }
    ]) {
      await expect(
        zip.writeZipArchive(
          { entries: [{ ...entry, ...patch }], comment: new Uint8Array() },
          limits,
          signal
        )
      ).rejects.toThrow();
    }
    const stored = { ...entry, method: 0, data: content, crc32: 0 };
    await expect(
      zip.writeZipArchive({ entries: [stored], comment: new Uint8Array() }, limits, signal)
    ).rejects.toThrow("CRC32");
  });

  it("rejects unsupported writer flags and retained extended fields", async () => {
    const entry = (await zip.readZipArchive(archive(0, 0), limits, signal)).entries[0]!;
    for (const patch of [
      { flags: 1 },
      { flags: 16 },
      { flags: 6 },
      { localExtra: Uint8Array.of(1, 0, 0, 0) },
      { centralExtra: Uint8Array.of(1, 0, 0, 0) }
    ]) {
      await expect(
        zip.writeZipArchive(
          { entries: [{ ...entry, ...patch }], comment: new Uint8Array() },
          limits,
          signal
        )
      ).rejects.toThrow();
    }
  });

  it("bounds forced compression output even when it grows the input", async () => {
    await expect(
      zip.makeZipEntry(
        "x",
        content,
        { ...attributes, compression: "deflate" },
        { ...limits, maxArchiveBytes: 10 },
        signal
      )
    ).rejects.toThrow("compressed byte");
  });

  it("retains caller ordering across many empty members and rejects count overflow", async () => {
    const zip = createZipCodec(
      {
        yieldTurn: async (signal) => {
          signal.throwIfAborted();
        },
        fail: (message) => {
          throw new Error(message);
        },
        compression: createCompressionCodec()
      },
      { validatePayloads: true }
    );
    const countLimits = { ...limits, maxMembers: 2048, maxArchiveBytes: 512 * 1024 };
    const empty = await zip.makeZipEntry("x", new Uint8Array(), attributes, limits, signal);
    const entries = Array.from({ length: 1024 }, (_, index) => ({
      ...empty,
      name: `parts/${1024 - index}`
    }));
    const output = await zip.writeZipArchive(
      { entries, comment: new Uint8Array() },
      countLimits,
      signal
    );
    const parsed = await zip.readZipArchive(output, countLimits, signal);
    expect(parsed.entries.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name));
    await expect(
      zip.writeZipArchive(
        { entries, comment: new Uint8Array() },
        { ...countLimits, maxMembers: 1023 },
        signal
      )
    ).rejects.toThrow("member");
  });

  it("observes cancellation during empty entry cleanup", async () => {
    const controller = new AbortController();
    const compression = createCompressionCodec();
    const zip = createZipCodec({
      yieldTurn: async (signal) => {
        signal.throwIfAborted();
      },
      fail: (message) => {
        throw new Error(message);
      },
      compression: {
        ...compression,
        CodecReader: class extends compression.CodecReader {
          override async close() {
            await super.close();
            controller.abort(new Error("creation cancelled"));
          }
        }
      }
    });
    await expect(
      zip.makeZipEntry(
        "x",
        new Uint8Array(),
        { ...attributes, compression: "store" },
        limits,
        controller.signal
      )
    ).rejects.toThrow("creation cancelled");
  });

  it("rejects an aborted write before exposing archive bytes", async () => {
    const entry = await zip.makeZipEntry("x", content, attributes, limits, signal);
    const controller = new AbortController();
    const pending = zip.writeZipArchive(
      { entries: [entry], comment: new Uint8Array() },
      limits,
      controller.signal
    );
    controller.abort(new Error("writing cancelled"));
    await expect(pending).rejects.toThrow("writing cancelled");
  });

  it("admits compressible raw bytes separately from the compressed output budget", async () => {
    const entry = await zip.makeZipEntry(
      "x",
      new Uint8Array(4096).fill(65),
      { ...attributes, compression: "deflate" },
      { ...limits, maxArchiveBytes: 256 },
      signal
    );
    expect(entry.size).toBe(4096);
    expect(entry.data.length).toBeLessThan(256);
  });

  it("charges all serialized metadata against the archive budget", async () => {
    const entry = await zip.makeZipEntry("x", new Uint8Array(), attributes, limits, signal);
    await expect(
      zip.writeZipArchive(
        { entries: [{ ...entry, comment: new Uint8Array(100) }], comment: new Uint8Array(100) },
        { ...limits, maxArchiveBytes: 250 },
        signal
      )
    ).rejects.toThrow("archive byte");
  });

  it("owns validated filename bytes before strict serialization yields", async () => {
    const rawName = new TextEncoder().encode("harbor");
    const entry = await createZipCodec().makeZipEntry(
      "harbor",
      new Uint8Array(),
      {
        modified: new Date(Date.UTC(1980, 0, 1)),
        mode: 0o100644,
        directory: false,
        symlink: false,
        compression: "store"
      },
      limits,
      signal
    );
    entry.rawName = rawName;
    let turns = 0;
    const zip = createZipCodec(
      {
        async yieldTurn() {
          if (++turns === 2) rawName[0] = 99;
        },
        fail(message) {
          throw new Error(message);
        },
        compression: createCompressionCodec()
      },
      { validatePayloads: true }
    );
    const output = await zip.writeZipArchive(
      { entries: [entry], comment: new Uint8Array() },
      limits,
      signal
    );
    expect(rawName[0]).toBe(99);
    const parsed = await createZipCodec().readZipArchive(output, limits, signal);
    expect(parsed.entries.map((item) => item.name)).toEqual(["harbor"]);
  });
});
