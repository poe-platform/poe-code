import { expect, it, vi } from "vitest";
import { encodeJpegImage } from "./codecs/jpeg.js";
import { decodeTiffImage } from "./codecs/netpbm.js";
import { decodeTiffToStorage } from "./codecs/tiff-input-storage.js";
interface Spec {
  progressive?: boolean;
  tiles?: boolean;
  le?: boolean;
  tables?: boolean;
  tableType?: number;
  tableCount?: number;
  tableBadOffset?: boolean;
  badSoi?: boolean;
  samples?: number;
  bits?: number;
  predictor?: number;
  compression?: number;
  chunks?: number;
  rawSize?: "small" | "large";
  rawLength?: number;
  padding?: number;
  repeated?: boolean;
}
const join = (parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
};
function fixture(spec: Spec = {}) {
  const le = spec.le ?? true,
    width = 7,
    height = 5,
    samples = spec.samples ?? 3,
    bits = spec.bits ?? 8,
    chunkCount = spec.chunks ?? (spec.tiles ? 4 : 3);
  let tables = new Uint8Array();
  const raws: Uint8Array[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const w = spec.rawSize === "small" ? 1 : spec.rawSize === "large" ? 13 : spec.tiles ? 4 : 7,
      h = spec.rawSize === "small" ? 1 : spec.rawSize === "large" ? 11 : spec.tiles ? 3 : 2;
    const data = Uint8Array.from({ length: w * h * 4 }, (_, p) =>
      p % 4 === 3 ? 255 : (p * 39 + i * 61 + Math.floor(p / 11)) & 255
    );
    const segment = (marker: number, body: number[]) => [
      255,
      marker,
      (body.length + 2) >>> 8,
      (body.length + 2) & 255,
      ...body
    ];
    const blocks = Math.ceil(w / 8) * Math.ceil(h / 8),
      entropy = Array.from({ length: Math.ceil(blocks / 8) }, (_, index) =>
        index === Math.ceil(blocks / 8) - 1 && blocks % 8 ? (1 << (8 - (blocks % 8))) - 1 : 0
      );
    const jpeg = spec.progressive
      ? Uint8Array.from([
          255,
          216,
          ...segment(219, [0, ...new Array<number>(64).fill(1)]),
          ...segment(194, [8, h >>> 8, h & 255, w >>> 8, w & 255, 1, 1, 17, 0]),
          ...segment(196, [
            0,
            1,
            ...new Array<number>(15).fill(0),
            0,
            16,
            1,
            ...new Array<number>(15).fill(0),
            0
          ]),
          ...segment(218, [1, 1, 0, 0, 0, 0]),
          ...entropy,
          ...segment(218, [1, 1, 0, 1, 63, 0]),
          ...entropy,
          255,
          217
        ])
      : encodeJpegImage({
          width: w,
          height: h,
          data,
          format: "raw",
          space: "srgb",
          channels: 4,
          depth: "uchar",
          density: 144,
          orientation: 6,
          hasAlpha: true
        });
    if (!spec.tables || spec.tableCount !== undefined || spec.tableBadOffset || spec.badSoi) {
      raws.push(jpeg);
      continue;
    }
    const header: Uint8Array[] = [Uint8Array.of(255, 216)],
      raw: Uint8Array[] = [Uint8Array.of(255, 216)];
    for (let at = 2; at < jpeg.length; ) {
      const marker = jpeg[at + 1]!;
      if (marker === 218) {
        raw.push(jpeg.subarray(at));
        break;
      }
      const end = at + 2 + (jpeg[at + 2]! << 8) + jpeg[at + 3]!;
      (marker === 196 || marker === 219 ? header : raw).push(jpeg.subarray(at, end));
      at = end;
    }
    if (spec.padding) {
      const left = spec.padding;
      header.push(
        Uint8Array.of(255, 254, (left + 2) >>> 8, (left + 2) & 255),
        new Uint8Array(left).fill(47)
      );
    }
    header.push(Uint8Array.of(255, 217));
    tables = join(header);
    raws.push(join(raw));
  }
  if (spec.tables && !tables.length)
    tables = Uint8Array.of(spec.badSoi ? 0 : 255, 216, 0, 0, 255, 217);
  const entries: [number, number, number, number][] = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, 1, bits],
    [259, 3, 1, spec.compression ?? 7],
    [262, 3, 1, 2],
    [277, 3, 1, samples],
    [274, 3, 1, 8],
    [317, 3, 1, spec.predictor ?? 1],
    [282, 4, 1, 91]
  ];
  if (spec.tables) entries.push([347, spec.tableType ?? 7, spec.tableCount ?? tables.length, 0]);
  if (spec.tiles)
    entries.push([322, 4, 1, 4], [323, 4, 1, 3], [324, 4, chunkCount, 0], [325, 4, chunkCount, 0]);
  else
    entries.push(
      [278, 4, 1, spec.repeated ? 1 : 2],
      [273, 4, chunkCount, 0],
      [279, 4, chunkCount, 0]
    );
  const directoryEnd = 14 + entries.length * 12,
    offsetList = directoryEnd,
    countList = offsetList + chunkCount * 4,
    tableStart = countList + chunkCount * 4,
    rawStart = tableStart + tables.length;
  const bytes = new Uint8Array(rawStart + raws.reduce((n, r) => n + r.length, 0)),
    view = new DataView(bytes.buffer);
  bytes.set(le ? [73, 73] : [77, 77]);
  view.setUint16(2, 42, le);
  view.setUint32(4, 8, le);
  view.setUint16(8, entries.length, le);
  let rawAt = rawStart;
  raws.forEach((raw, i) => {
    view.setUint32(offsetList + i * 4, spec.repeated ? rawStart : rawAt, le);
    view.setUint32(
      countList + i * 4,
      spec.rawLength ?? (spec.repeated ? raws[0]!.length : raw.length),
      le
    );
    bytes.set(raw, rawAt);
    rawAt += raw.length;
  });
  bytes.set(tables, tableStart);
  entries.forEach(([tag, type, count, value], i) => {
    const at = 10 + i * 12;
    view.setUint16(at, tag, le);
    view.setUint16(at + 2, type, le);
    view.setUint32(at + 4, count, le);
    if (tag === 347) {
      value = spec.tableBadOffset ? bytes.length - 1 : tableStart;
      if (count <= 4) {
        bytes.set(tables.subarray(0, count), at + 8);
        return;
      }
    } else if (tag === 273 || tag === 324) value = chunkCount === 1 ? rawStart : offsetList;
    else if (tag === 279 || tag === 325)
      value = chunkCount === 1 ? (spec.rawLength ?? raws[0]!.length) : countList;
    if (type === 3 && tag !== 347) view.setUint16(at + 8, value, le);
    else view.setUint32(at + 8, value, le);
  });
  return bytes;
}
type Event = "source" | "read" | "write" | "allocate";
function harness(
  input: Uint8Array,
  hook?: (event: Event, position: number, length: number) => void
) {
  const memory = new Uint8Array(8 * 1024 * 1024),
    borrowed = new Uint8Array(4096),
    controller = new AbortController();
  let end = 17;
  const allocations: number[] = [];
  const source = {
    size: input.length,
    async read(position: number, length: number, options?: { signal?: AbortSignal }) {
      expect(options?.signal).toBe(controller.signal);
      expect(length).toBeLessThanOrEqual(4096);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position + length).toBeLessThanOrEqual(input.length);
      hook?.("source", position, length);
      await Promise.resolve();
      borrowed.fill(133);
      borrowed.set(input.subarray(position, position + length));
      return borrowed.subarray(0, length);
    }
  };
  const storage = {
    allocate(length: number) {
      hook?.("allocate", end, length);
      allocations.push(length);
      const at = end;
      end += length + 19;
      return at;
    },
    async read(position: number, length: number, options?: { signal?: AbortSignal }) {
      expect(options?.signal).toBe(controller.signal);
      expect(length).toBeLessThanOrEqual(4096);
      hook?.("read", position, length);
      await Promise.resolve();
      borrowed.fill(197);
      borrowed.set(memory.subarray(position, position + length));
      return borrowed.subarray(0, length);
    },
    async write(position: number, bytes: Uint8Array, options?: { signal?: AbortSignal }) {
      expect(options?.signal).toBe(controller.signal);
      expect(bytes.length).toBeLessThanOrEqual(4096);
      hook?.("write", position, bytes.length);
      await Promise.resolve();
      memory.set(bytes, position);
    }
  };
  return {
    source,
    storage,
    controller,
    allocations,
    async decode() {
      const { position, ...meta } = await decodeTiffToStorage(source, storage, controller.signal, {
        maxDecodeDimension: 1
      });
      return { ...meta, data: memory.slice(position, position + meta.width * meta.height * 4) };
    }
  };
}
const cases: Spec[] = [];
for (const tiles of [false, true])
  for (const le of [false, true])
    for (const samples of [1, 2, 4, 5])
      for (const bits of [8, 16])
        for (const predictor of [1, 2])
          cases.push({
            tiles,
            le,
            samples,
            bits,
            predictor,
            tables: true,
            compression: le ? 6 : 7
          });
for (const tableType of [1, 2, 3, 4, 5, 7, 9, 12])
  for (const le of [false, true]) cases.push({ tables: true, tableType, le });
for (const tableCount of [0, 1, 2, 3, 4, 5, 6, 1000000, 0xffffffff])
  cases.push({ tables: true, tableCount });
for (const rawLength of [0, 1, 2, 3, 0xffffffff]) cases.push({ tables: true, rawLength });
for (const tiles of [false, true])
  for (const rawSize of ["small", "large"] as const)
    cases.push({ tiles, rawSize, tables: true, samples: 5, bits: 16, predictor: 2 });
cases.push(
  { tables: true, tableBadOffset: true },
  { tables: true, badSoi: true },
  { tables: true, padding: 20000 },
  { tiles: true, tables: true, padding: 4090 },
  { tiles: true, tables: true, chunks: 6 }
);
for (const tiles of [false, true])
  for (const tables of [false, true])
    for (const rawSize of ["small", "large"] as const)
      cases.push({ progressive: true, tiles, tables, rawSize, samples: 5, bits: 16, predictor: 2 });
it.each(cases)("matches original multi-chunk TIFF JPEG %j", async (spec) => {
  const input = fixture(spec),
    env = harness(input);
  let expected: ReturnType<typeof decodeTiffImage>;
  try {
    expected = decodeTiffImage(input);
  } catch (error) {
    await expect(env.decode()).rejects.toThrow((error as Error).message);
    return;
  }
  expect(await env.decode()).toEqual(expected);
});
for (const event of ["source", "read", "write", "allocate"] as const)
  for (const cancel of [false, true])
    it(`propagates ${event} ${cancel ? "cancellation" : "failure"}`, async () => {
      const reason = new Error(event),
        env = harness(fixture({ tables: true }), (type) => {
          if (type === event) {
            if (cancel) env.controller.abort(reason);
            else throw reason;
          }
        });
      await expect(env.decode()).rejects.toBe(reason);
    });
it("copies logical JPEG reads immediately before borrowed source/backing reuse", async () => {
  const input = fixture({
      tables: true,
      padding: 20000,
      tiles: true,
      rawSize: "large",
      samples: 5,
      predictor: 2
    }),
    env = harness(input);
  expect(await env.decode()).toEqual(decodeTiffImage(input));
});
it("keeps ignored large shared-table bodies out of new raster allocations", async () => {
  const input = fixture({ tables: true, padding: 65530 }),
    expected = decodeTiffImage(input),
    env = harness(input),
    Native = Uint8Array;
  let max = 0;
  vi.stubGlobal(
    "Uint8Array",
    new Proxy(Native, {
      construct(target, args) {
        if (typeof args[0] === "number") max = Math.max(max, args[0]);
        return Reflect.construct(target, args);
      }
    })
  );
  try {
    expect(await env.decode()).toEqual(expected);
    expect(max).toBeLessThanOrEqual(4096);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("reuses JPEG scratch capacity across repeated TIFF tiles", async () => {
  const small = harness(fixture({ tiles: true, tables: true, chunks: 4, repeated: true })),
    many = harness(fixture({ tiles: true, tables: true, chunks: 40, repeated: true }));
  expect(await many.decode()).toEqual(await small.decode());
  const initial = small.allocations.reduce((a, b) => a + b, 0),
    repeated = many.allocations.reduce((a, b) => a + b, 0);
  expect(repeated - initial).toBeLessThanOrEqual(4096);
});
for (const cancel of [false, true])
  it(`propagates logical JPEG region ${cancel ? "cancellation" : "failure"}`, async () => {
    let hit = false;
    const reason = new Error("logical source");
    const env = harness(fixture({ tables: true }), (event, _position, length) => {
      if (event === "source" && length === 2) {
        hit = true;
        if (cancel) env.controller.abort(reason);
        else throw reason;
      }
    });
    await expect(env.decode()).rejects.toBe(reason);
    expect(hit).toBe(true);
  });
it("rejects short logical JPEG component ranges without a buffered fallback", async () => {
  const env = harness(fixture({ tables: true })),
    read = env.source.read;
  env.source.read = async (...args) => (args[1] === 2 ? new Uint8Array(1) : read(...args));
  await expect(env.decode()).rejects.toThrow("Truncated TIFF JPEG source");
});
it("does not acquire cleanup authority over caller source or storage", async () => {
  const env = harness(fixture({ tables: true })),
    sourceClose = vi.fn(),
    storageClose = vi.fn();
  Object.assign(env.source, { close: sourceClose });
  Object.assign(env.storage, { close: storageClose });
  await env.decode();
  expect(sourceClose).not.toHaveBeenCalled();
  expect(storageClose).not.toHaveBeenCalled();
});
import { BackingArena } from "./codecs/backing-arena.js";
it("addresses the final trimmed arena segment without unsafe arithmetic", async () => {
  let end = 0,
    calls = 0;
  const reads: [number, number][] = [];
  const arena = new BackingArena({
    allocate(length) {
      calls++;
      const start = end;
      end += length;
      return start;
    },
    async read(position, length) {
      reads.push([position, length]);
      return new Uint8Array(length).fill(position % 251);
    },
    async write() {
      throw new Error("unexpected write");
    }
  });
  arena.allocate(Number.MAX_SAFE_INTEGER);
  expect(calls).toBe(42);
  const bytes = await arena.read(Number.MAX_SAFE_INTEGER - 4096, 4096);
  expect(reads).toEqual([
    [Number.MAX_SAFE_INTEGER - 4096, 1],
    [Number.MAX_SAFE_INTEGER - 4095, 4095]
  ]);
  expect(bytes[0]).toBe((Number.MAX_SAFE_INTEGER - 4096) % 251);
  expect(bytes[1]).toBe((Number.MAX_SAFE_INTEGER - 4095) % 251);
  await expect(arena.read(Number.MAX_SAFE_INTEGER, 1)).rejects.toThrow(RangeError);
});
for (const mode of ["read", "write"] as const)
  it(`stops split arena ${mode} after cancellation of the first region`, async () => {
    let end = 0,
      calls = 0;
    const controller = new AbortController(),
      reason = new Error("boundary abort");
    const arena = new BackingArena({
      allocate(length) {
        const at = end;
        end += length + 5;
        return at;
      },
      async read(_position, length) {
        calls++;
        controller.abort(reason);
        return new Uint8Array(length);
      },
      async write() {
        calls++;
        controller.abort(reason);
      }
    });
    arena.allocate(8192);
    const result =
      mode === "read"
        ? arena.read(4095, 4, { signal: controller.signal })
        : arena.write(4095, Uint8Array.of(1, 2, 3, 4), { signal: controller.signal });
    await expect(result).rejects.toBe(reason);
    expect(calls).toBe(1);
  });
it("preserves second-region backing failures after copying the first borrowed region", async () => {
  let end = 0,
    calls = 0;
  const reason = new Error("second range"),
    arena = new BackingArena({
      allocate(length) {
        const at = end;
        end += length;
        return at;
      },
      async read(_position, length) {
        if (++calls === 2) throw reason;
        return new Uint8Array(length).fill(7);
      },
      async write() {}
    });
  arena.allocate(9000);
  await expect(arena.read(4095, 4)).rejects.toBe(reason);
  expect(calls).toBe(2);
});
