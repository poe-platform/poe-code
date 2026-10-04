import { expect, it } from "vitest";
import { StoredFontWidths } from "./stored-widths.js";
import { FontWidths } from "./widths.js";
import { PdfFontAllocation } from "./memory.js";

it.each([false, true])(
  "preserves native font width ranges and overrides (overlap: %s)",
  async (overlap) => {
    const bytes = new Uint8Array(2 * 1024 * 1024);
    let end = 0,
      admitted = 0,
      readCount = 0;
    const storage = {
      allocate(n: number) {
        const at = end;
        end += n;
        return at;
      },
      async read(at: number, n: number) {
        expect(n).toBeLessThanOrEqual(4096);
        readCount++;
        return bytes.slice(at, at + n);
      },
      async write(at: number, value: Uint8Array) {
        expect(value.length).toBeLessThanOrEqual(4096);
        bytes.set(value, at);
      }
    };
    const native = new FontWidths(new PdfFontAllocation({})),
      stored = new StoredFontWidths(storage, {
        onAllocation(n) {
          admitted += n;
        }
      });
    for (let i = 0; i < 1024; i++) {
      const low = overlap ? (i * 37) % 300 : i * 4 - 2048,
        width = i % 17 === 0 ? 0 : i * 0.125,
        high = low + 2;
      native.set(low, width, high);
      await stored.set(low, width, high);
    }
    for (const [first, width, last] of [
      [5000.5, -17, 5003.5],
      [1e12, 800, 1e12 + 100],
      [Number.MAX_SAFE_INTEGER - 1, 900, Number.MAX_SAFE_INTEGER]
    ]) {
      native.set(first!, width!, last);
      await stored.set(first!, width!, last);
    }
    for (const code of [
      -Infinity,
      Infinity,
      NaN,
      -2048,
      -2047,
      -0.5,
      0,
      1,
      299,
      300,
      2048,
      5000.5,
      5001,
      5001.5,
      1e12,
      1e12 + 100,
      Number.MAX_SAFE_INTEGER
    ]) {
      expect(await stored.get(code)).toBe(native.get(code));
      expect(await stored.has(code)).toBe(native.has(code));
    }
    const before = readCount;
    expect(await stored.get(1e12)).toBe(800);
    expect(readCount).toBe(before);
    await stored.set(1e12, 0);
    expect(await stored.get(1e12)).toBe(0);
    expect(admitted).toBe(65536);
  }
);

it.each(["read", "write"])("retains cancellation from a final width %s", async (mode) => {
  const controller = new AbortController(),
    failure = new Error("cancelled backing"),
    data = new Uint8Array(4096);
  let end = 0,
    armed = false;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      if (armed && mode === "read") controller.abort(failure);
      return data.slice(at, at + n);
    },
    async write(at: number, bytes: Uint8Array) {
      data.set(bytes, at);
      if (armed && mode === "write") controller.abort(failure);
    }
  };
  const widths = new StoredFontWidths(storage, { signal: controller.signal });
  await widths.set(65, 600);
  armed = true;
  await expect(mode === "read" ? widths.get(65) : widths.set(66, 600)).rejects.toBe(failure);
});

it("initializes width index nodes before reading newly reserved backend ranges", async () => {
  const data = new Uint8Array(65536),
    written = new Set<number>();
  let end = 0;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      for (let i = at; i < at + n; i++)
        if (!written.has(i)) throw Error("uninitialized width index");
      return data.slice(at, at + n);
    },
    async write(at: number, bytes: Uint8Array) {
      data.set(bytes, at);
      for (let i = at; i < at + bytes.length; i++) written.add(i);
    }
  };
  const widths = new StoredFontWidths(storage);
  for (let i = 0; i < 128; i++) await widths.set(i, i + 200);
  expect(await widths.get(0)).toBe(200);
  expect(await widths.get(127)).toBe(327);
});

it("detaches borrowed index reads before mutating a radix node", async () => {
  const data = new Uint8Array(65536);
  let end = 0,
    borrowed: { at: number; bytes: Uint8Array } | undefined;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      borrowed = { at, bytes: data.slice(at, at + n) };
      return data.subarray(at, at + n);
    },
    async write(at: number, bytes: Uint8Array) {
      if (borrowed)
        expect(data.subarray(borrowed.at, borrowed.at + borrowed.bytes.length)).toEqual(
          borrowed.bytes
        );
      borrowed = undefined;
      data.set(bytes, at);
    }
  };
  const widths = new StoredFontWidths(storage);
  for (let i = 0; i < 128; i++) await widths.set(i, i + 200);
  expect(await widths.get(0)).toBe(200);
});
