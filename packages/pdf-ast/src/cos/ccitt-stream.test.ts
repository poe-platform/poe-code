import { describe, expect, it, vi } from "vitest";
import { decodeCcittFax } from "./filters.js";
import { decodeCcittFaxChunks } from "./ccitt.js";

function bits(value: string): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(value.length / 8));
  for (let i = 0; i < value.length; i++) if (value[i] === "1") bytes[Math.floor(i / 8)]! |= 1 << (7 - i % 8);
  return bytes;
}
async function* pieces(bytes: Uint8Array) {
  const scratch = new Uint8Array(1);
  for (const byte of bytes) { scratch[0] = byte; yield scratch; }
}
async function collect(input: AsyncIterable<Uint8Array>) {
  const result: number[] = [];
  for await (const chunk of input) result.push(...chunk);
  return Uint8Array.from(result);
}

describe("streamed CCITT rows", () => {
  it.each([
    [0, "1011011", [240]], [0, "00110101000101", [0]],
    [-1, "1", [255]], [-1, "001101101111", [240, 240]],
    [-1, "00110110110001", [240, 255]],
    [-1, "00110110110111", [240, 248]], [-1, "00110110110101", [240, 224]],
  ] as const)("preserves Group %i mode sequence %s", async (K, encoded, expected) => {
    const bytes = bits(encoded);
    const parms = { K, Columns: 8, Rows: expected.length };
    expect(decodeCcittFax(bytes, parms)).toEqual(Uint8Array.from(expected));
    expect(await collect(decodeCcittFaxChunks(() => pieces(bytes), parms, { chunkBytes: 1 }))).toEqual(Uint8Array.from(expected));
  });

  it.each([false, true])("preserves polarity and padding for 11-column rows (BlackIs1=%s)", async BlackIs1 => {
    const bytes = bits("111");
    const parms = { K: -1, Columns: 11, Rows: 3, BlackIs1 };
    const expected = BlackIs1 ? [0, 0, 0, 0, 0, 0] : [255, 224, 255, 224, 255, 224];
    expect(await collect(decodeCcittFaxChunks(() => pieces(bytes), parms, { chunkBytes: 1 }))).toEqual(Uint8Array.from(expected));
  });

  it("decodes all rows without a declared Rows value", async () => {
    const bytes = new Uint8Array(40).fill(255);
    expect(await collect(decodeCcittFaxChunks(() => pieces(bytes), { K: -1, Columns: 8 }))).toEqual(new Uint8Array(320).fill(255));
  });

  it("replays retained input for the original-byte fallback, including unread suffix", async () => {
    const bytes = new Uint8Array([0, 0, 17, 23, 42]);
    const open = vi.fn(() => pieces(bytes));
    expect(await collect(decodeCcittFaxChunks(open, { Columns: 8 }))).toEqual(bytes);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("admits packed row storage before pulling input", async () => {
    const open = vi.fn(() => pieces(new Uint8Array([255])));
    await expect(collect(decodeCcittFaxChunks(open, { K: -1, Columns: 8000000 }, { maxRowBytes: 16 }))).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(open).not.toHaveBeenCalled();
  });

  it("bounds outstanding row allocation and input pulls under a slow consumer", async () => {
    let pulled = 0, closed = false;
    async function* input() { try { for (let i = 0; i < 10000; i++) { pulled++; yield new Uint8Array([255]); } } finally { closed = true; } }
    const allocations: number[] = [];
    const original = Uint8Array;
    vi.stubGlobal("Uint8Array", new Proxy(original, { construct(target, args) {
      const value = Reflect.construct(target, args) as Uint8Array;
      allocations.push(value.length); return value;
    } }));
    try {
      const iterator = decodeCcittFaxChunks(input, { K: -1, Columns: 800 }, { chunkBytes: 7, maxRowBytes: 100 });
      const first = await iterator.next();
      expect(first.value).toHaveLength(7);
      expect(pulled).toBe(1);
      expect(Math.max(...allocations)).toBeLessThanOrEqual(100);
      const saved = first.value!.slice();
      await iterator.next();
      expect(first.value).toEqual(saved);
      await iterator.return(undefined);
      expect(closed).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it("charges decoded rows and fallback bytes against the output budget", async () => {
    await expect(collect(decodeCcittFaxChunks(() => pieces(new Uint8Array([255])), { K: -1, Columns: 8 }, { maxDecodedBytes: 7 }))).rejects.toMatchObject({ code: "E_LIMIT" });
    await expect(collect(decodeCcittFaxChunks(() => pieces(new Uint8Array([0, 0, 17])), { Columns: 8 }, { maxDecodedBytes: 2 }))).rejects.toMatchObject({ code: "E_LIMIT" });
  });
  it("retains byte alignment between fax rows", async () => {
    const bytes = new Uint8Array([0x80, 0x80, 0x80]);
    expect(await collect(decodeCcittFaxChunks(() => pieces(bytes), { K: -1, Columns: 8, EncodedByteAlign: true }))).toEqual(new Uint8Array([255, 255, 255]));
  });

  it.each([false, true])("cancels pending input during fallback=%s and closes the active iterator", async fallback => {
    const controller = new AbortController();
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const close = vi.fn(async () => { throw new Error("cleanup failure"); });
    let opened = 0;
    const open = () => {
      if (fallback && opened++ === 0) return pieces(new Uint8Array([0, 0]));
      return { [Symbol.asyncIterator]: () => ({
        next: () => { ready(); return new Promise<IteratorResult<Uint8Array>>(() => {}); }, return: close,
      }) };
    };
    const pending = collect(decodeCcittFaxChunks(open, { Columns: 8 }, { signal: controller.signal }));
    await started;
    controller.abort(new Error("stop fax"));
    await expect(pending).rejects.toThrow("stop fax");
    expect(close).toHaveBeenCalledOnce();
  });

});
