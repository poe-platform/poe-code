import { expect, it } from "vitest";
import { encodeJpegImage } from "./codecs/jpeg.js";
import { decodeTiffImage } from "./codecs/netpbm.js";
import { decodeTiffToStorage } from "./codecs/tiff-input-storage.js";
import type { ImageByteStorage } from "./codecs/png-storage.js";

interface Spec {
  compression: number;
  samples: number;
  bits: number;
  predictor: number;
  tiles: boolean;
  tables: boolean;
  le?: boolean;
  wide?: boolean;
  tablePadding?: number;
  badTables?: boolean;
}
function join(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
function fixture(spec: Spec) {
  const width = spec.wide ? 13 : 5,
    height = spec.wide ? 11 : 3,
    pixels = Uint8Array.from(
      { length: width * height * 4 },
      (_, i) => (i * 71 + Math.floor(i / 5)) & 255
    );
  const jpeg = encodeJpegImage({
    width,
    height,
    data: pixels,
    format: "raw",
    space: "srgb",
    channels: 4,
    depth: "uchar",
    density: 144,
    orientation: 6,
    hasAlpha: true
  });
  let raw = jpeg,
    tables = new Uint8Array();
  if (spec.tables) {
    const parts = [Uint8Array.of(255, 216)],
      headers = [Uint8Array.of(255, 216)];
    for (let p = 2; p < jpeg.length; ) {
      const marker = jpeg[p + 1]!;
      if (marker === 218) {
        parts.push(jpeg.subarray(p));
        break;
      }
      const end = p + 2 + (jpeg[p + 2]! << 8) + jpeg[p + 3]!;
      (marker === 219 || marker === 196 ? headers : parts).push(jpeg.subarray(p, end));
      p = end;
    }
    if (spec.tablePadding) {
      const length = spec.tablePadding;
      headers.push(
        Uint8Array.of(255, 254, (length + 2) >>> 8, (length + 2) & 255),
        new Uint8Array(length).fill(71)
      );
    }
    headers.push(Uint8Array.of(255, 217));
    tables = join(headers);
    raw = join(parts);
    if (spec.badTables) {
      tables[0] = 0;
      raw = jpeg;
    }
  }
  const entries: [number, number, number, number][] = [
    [256, 4, 1, 7],
    [257, 4, 1, 5],
    [258, 3, 1, spec.bits],
    [259, 3, 1, spec.compression],
    [262, 3, 1, spec.samples < 3 ? 1 : 2],
    [277, 3, 1, spec.samples],
    [274, 3, 1, 8],
    [317, 3, 1, spec.predictor]
  ];
  if (spec.tables) entries.push([347, 7, tables.length, 0]);
  if (spec.tiles)
    entries.push([322, 4, 1, 7], [323, 4, 1, 5], [324, 4, 1, 0], [325, 4, 1, raw.length]);
  else entries.push([278, 4, 1, 5], [273, 4, 1, 0], [279, 4, 1, raw.length]);
  const start = 8 + 2 + entries.length * 12 + 4,
    bytes = new Uint8Array(start + tables.length + raw.length),
    view = new DataView(bytes.buffer),
    le = spec.le ?? true;
  bytes.set(le ? [73, 73] : [77, 77]);
  view.setUint16(2, 42, le);
  view.setUint32(4, 8, le);
  view.setUint16(8, entries.length, le);
  entries.forEach(([tag, type, count, value], i) => {
    const p = 10 + i * 12;
    view.setUint16(p, tag, le);
    view.setUint16(p + 2, type, le);
    view.setUint32(p + 4, count, le);
    value = tag === 347 ? start : tag === 273 || tag === 324 ? start + tables.length : value;
    if (type === 3) view.setUint16(p + 8, value, le);
    else view.setUint32(p + 8, value, le);
  });
  bytes.set(tables, start);
  bytes.set(raw, start + tables.length);
  return bytes;
}
function backing() {
  const memory = new Uint8Array(2 * 1024 * 1024),
    borrowed = new Uint8Array(4096);
  let end = 17;
  const storage: ImageByteStorage = {
    allocate(length) {
      const position = end;
      end += length + 7;
      expect(end).toBeLessThan(memory.length);
      return position;
    },
    async read(position, length) {
      expect(length).toBeLessThanOrEqual(4096);
      borrowed.fill(189);
      borrowed.set(memory.subarray(position, position + length));
      return borrowed.subarray(0, length);
    },
    async write(position, bytes) {
      expect(bytes.length).toBeLessThanOrEqual(4096);
      memory.set(bytes, position);
    }
  };
  return { storage, memory };
}
const cases: Spec[] = [];
for (const compression of [6, 7])
  for (const tables of [false, true])
    for (const tiles of [false, true])
      for (const samples of [1, 2, 3, 4, 5])
        for (const bits of [8, 16])
          for (const predictor of [1, 2])
            cases.push({ compression, tables, tiles, samples, bits, predictor });
cases.push(
  {
    compression: 7,
    tables: true,
    tiles: false,
    samples: 3,
    bits: 8,
    predictor: 1,
    tablePadding: 20000,
    le: false
  },
  {
    compression: 6,
    tables: true,
    tiles: true,
    samples: 4,
    bits: 16,
    predictor: 2,
    badTables: true,
    wide: true
  }
);
it.each(cases)("decodes retained JPEG-in-TIFF %j", async (spec) => {
  const bytes = fixture(spec),
    expected = decodeTiffImage(bytes),
    { storage, memory } = backing(),
    borrowed = new Uint8Array(4096);
  const source = {
    size: bytes.length,
    async read(position: number, length: number) {
      expect(length).toBeLessThanOrEqual(4096);
      borrowed.fill(113);
      borrowed.set(bytes.subarray(position, position + length));
      return borrowed.subarray(0, length);
    }
  };
  const { position, ...metadata } = await decodeTiffToStorage(
    source,
    storage,
    new AbortController().signal,
    { maxDecodeDimension: 1 }
  );
  expect({
    ...metadata,
    data: memory.slice(position, position + metadata.width * metadata.height * 4)
  }).toEqual(expected);
});

it.each([false, true])(
  "publishes JPEG-in-TIFF tiles=%s through retained filesystem reads",
  async (tiles) => {
    const { MemoryFileSystem } = await import("@poe-code/safe-fs/core"),
      { default: sharp } = await import("./index.js"),
      fs = new MemoryFileSystem();
    const bytes = fixture({
      compression: 7,
      tables: true,
      tiles,
      samples: 3,
      bits: 8,
      predictor: 1,
      tablePadding: 20000
    });
    await fs.writeFile("/in", bytes);
    const guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "readFile" || key === "writeFile")
          return () => {
            throw new Error("whole-file I/O forbidden");
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const pipeline = (image: ReturnType<typeof sharp>) => image.resize(11, 9).rotate().png();
    const expected = pipeline(sharp(bytes)).toBufferWithObjectSync(),
      info = await pipeline(sharp("/in", { filesystem: guarded })).toFile("/out"),
      actual = await fs.readFile("/out");
    expect(info).toEqual({ ...expected.info, size: actual.length });
    expect(sharp(actual).raw().toBufferSync()).toEqual(sharp(expected.data).raw().toBufferSync());
    expect((await fs.readdir("/")).map((entry) => entry.name)).toEqual(["in", "out"]);
  }
);
it.each(["cancel", "identity"] as const)(
  "preserves destination and cleans JPEG-in-TIFF scratch after %s",
  async (mode) => {
    const { MemoryFileSystem } = await import("@poe-code/safe-fs/core"),
      { default: sharp } = await import("./index.js"),
      fs = new MemoryFileSystem(),
      controller = new AbortController(),
      reason = new Error("TIFF JPEG cancellation");
    const bytes = fixture({
      compression: 6,
      tables: true,
      tiles: false,
      samples: 4,
      bits: 8,
      predictor: 2
    });
    await fs.writeFile("/in", bytes);
    await fs.writeFile("/out", Uint8Array.of(42));
    let reads = 0,
      closed = 0;
    const guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "readFile" || key === "writeFile")
          return () => {
            throw new Error("whole-file I/O forbidden");
          };
        if (key === "openReadFile")
          return async (...args: Parameters<typeof fs.openReadFile>) => {
            const handle = await fs.openReadFile(...args);
            return {
              stat: handle.stat.bind(handle),
              async read(...options: Parameters<typeof handle.read>) {
                const result = await handle.read(...options);
                if (++reads === 3) {
                  if (mode === "cancel") controller.abort(reason);
                  else await fs.writeFile("/in", bytes);
                }
                return result;
              },
              async close() {
                closed++;
                await handle.close();
              }
            };
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const pending = sharp("/in", { filesystem: guarded, signal: controller.signal })
      .png()
      .toFile("/out");
    if (mode === "cancel") await expect(pending).rejects.toBe(reason);
    else await expect(pending).rejects.toThrow("changed while decoding");
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(closed).toBe(1);
    expect(await fs.readFile("/out")).toEqual(Uint8Array.of(42));
    expect((await fs.readdir("/")).map((entry) => entry.name)).toEqual(["in", "out"]);
  }
);
