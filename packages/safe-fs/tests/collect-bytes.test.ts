import { afterEach, expect, it, vi } from "vitest";
import { collectBytes } from "../src/contracts/io.js";

afterEach(() => vi.unstubAllGlobals());

it("grows owned storage without copying a second complete output", async () => {
  const allocations: number[] = [];
  const Native = Uint8Array;
  vi.stubGlobal("Uint8Array", new Proxy(Native, {
    construct(target, args) {
      const result = Reflect.construct(target, args) as Uint8Array;
      allocations.push(result.byteLength);
      return result;
    }
  }));
  const chunk = new Native([7]);
  const result = await collectBytes((async function* () {
    for (let i = 0; i < 7; i++) yield chunk;
  })(), { maxBytes: 8 });
  expect([...result]).toEqual(Array(7).fill(7));
  expect(allocations.filter(size => size > 0)).toEqual([1, 2, 4, 8]);
  expect(result.buffer.byteLength).toBe(8);
});

it("accounts for the input backing buffer and resize peak before allocating", async () => {
  let closed = false;
  const source = (async function* () {
    try {
      yield new Uint8Array(4);
      yield new Uint8Array(5);
    } finally { closed = true; }
  })();
  await expect(collectBytes(source, { maxBytes: 9, maxMemoryBytes: 17 }))
    .rejects.toMatchObject({ code: "EFBIG" });
  expect(closed).toBe(true);
  await expect(collectBytes((async function* () {
    yield new Uint8Array(32).subarray(0, 1);
  })(), { maxMemoryBytes: 16 })).rejects.toMatchObject({ code: "EFBIG" });
});

it("accepts an exact memory boundary and snapshots reused source chunks", async () => {
  const source = (async function* () {
    const chunk = new Uint8Array([1, 2, 3, 4]);
    yield chunk;
    chunk.fill(5);
    yield chunk;
  })();
  expect([...await collectBytes(source, { maxBytes: 8, maxMemoryBytes: 16 })])
    .toEqual([1, 2, 3, 4, 5, 5, 5, 5]);
});

it.each([-1, Infinity, NaN, 1.5])("rejects invalid memory budget %s", async maxMemoryBytes => {
  await expect(collectBytes((async function* () {})(), { maxMemoryBytes }))
    .rejects.toBeInstanceOf(RangeError);
});

it("returns empty output with a zero budget and closes a source on byte overflow", async () => {
  expect((await collectBytes((async function* () {})(), { maxMemoryBytes: 0 })).length).toBe(0);
  let closed = false;
  await expect(collectBytes((async function* () {
    try { yield new Uint8Array(2); } finally { closed = true; }
  })(), { maxBytes: 1 })).rejects.toMatchObject({ code: "EFBIG" });
  expect(closed).toBe(true);
});
