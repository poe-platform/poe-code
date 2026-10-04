import { describe, expect, it } from "vitest";
import * as api from "./index.js";
import { encodeOgg, readOgg } from "./ogg.js";

const fixture = () => encodeOgg([
  { data: new Uint8Array(150000).fill(23), serial: 17, granule: 48000n, bos: true, eos: true },
  { data: new Uint8Array([1, 2, 3]), serial: 9, granule: 12n, bos: true, eos: true }
]);

// The resident implementation is the compatibility oracle; independent CRC vectors
// below keep this from testing only the same encoder/decoder implementation.
describe("Ogg source pages", () => {
  it("validates continuation pages using bounded borrowed ranges and retains only descriptors", async () => {
    expect(api.scanOggPages).toBeTypeOf("function");
    const bytes = fixture(), borrowed = new Uint8Array(97);
    let largest = 0, reads = 0, checkpoints = 0;
    const pages = [];
    for await (const page of api.scanOggPages({ size: bytes.length, async read(offset, length) {
      largest = Math.max(largest, length); reads++;
      const size = Math.min(length, borrowed.length);
      borrowed.set(bytes.subarray(offset, offset + size));
      return borrowed.subarray(0, size);
    } }, { checkpoint: async () => { checkpoints++; } })) pages.push(page);
    expect(largest).toBeLessThanOrEqual(16384);
    expect(checkpoints).toBeGreaterThan(8);
    expect(reads).toBeGreaterThan(100);
    expect(pages).toEqual(readOgg(bytes).nodes.map(node => ({
      offset: node.offset, size: node.size, payloadOffset: node.offset + 27 + (node.fields!.lacing as Uint8Array).length,
      flags: node.fields!.flags, granule: node.fields!.granule, serial: node.fields!.serial,
      sequence: node.fields!.sequence, checksum: node.fields!.checksum, lacing: node.fields!.lacing
    })));
  });

  it("streams arbitrary borrowed chunks with backpressure and closes on return", async () => {
    expect(api.scanOggPages).toBeTypeOf("function");
    const bytes = fixture(), borrowed = new Uint8Array(101); let reads = 0, closed = 0;
    async function* source() {
      try { for (let pos = 0; pos < bytes.length; pos += borrowed.length) {
        const size = Math.min(borrowed.length, bytes.length - pos);
        borrowed.set(bytes.subarray(pos, pos + size)); reads++; yield borrowed.subarray(0, size);
      } } finally { closed++; }
    }
    const pages = api.scanOggPages(source());
    const first = (await pages.next()).value!;
    expect(first.size).toBe(65307);
    const admitted = reads;
    await Promise.resolve();
    expect(reads).toBe(admitted);
    expect(reads * borrowed.length).toBeLessThan(bytes.length);
    await pages.return();
    expect(closed).toBe(1);
  });

  it("has identical retained and streaming descriptors", async () => {
    expect(api.scanOggPages).toBeTypeOf("function");
    const bytes = fixture();
    const retained = [], streamed = [];
    for await (const page of api.scanOggPages({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } })) retained.push(page);
    for await (const page of api.scanOggPages({ async *[Symbol.asyncIterator]() { for (const byte of bytes) yield Uint8Array.of(byte); } })) streamed.push(page);
    expect(streamed).toEqual(retained);
  });

  it("accepts an independent empty Ogg page CRC vector", async () => {
    expect(api.scanOggPages).toBeTypeOf("function");
    // Ogg polynomial 0x04c11db7, initial zero, non-reflected, no final xor.
    const bytes = Uint8Array.from([79,103,103,83,0,6,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,86,120,136,86,0]);
    const pages = [];
    for await (const page of api.scanOggPages({ size: bytes.length, async read(offset, length) { return bytes.slice(offset, offset + length); } })) pages.push(page);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.payloadOffset).toBe(27);
  });

  it.each(["header", "lacing", "payload", "checksum", "version", "flags"])("rejects %s corruption without yielding its page", async kind => {
    expect(api.scanOggPages).toBeTypeOf("function");
    let bytes = fixture();
    if (kind === "header") bytes = bytes.slice(0, 20);
    if (kind === "lacing") bytes = bytes.slice(0, 40);
    if (kind === "payload") bytes = bytes.slice(0, 500);
    if (kind === "checksum") bytes[1000] = bytes[1000]! ^ 1;
    if (kind === "version") bytes[4] = 1;
    if (kind === "flags") bytes[5] = 8;
    const pages = api.scanOggPages({ size: bytes.length, async read(offset, length) { return bytes.slice(offset, offset + length); } });
    await expect(pages.next()).rejects.toThrow();
  });

  it("propagates read failures and checks cancellation after awaited reads", async () => {
    expect(api.scanOggPages).toBeTypeOf("function");
    const failure = new Error("read failed");
    await expect(api.scanOggPages({ size: 100, async read() { throw failure; } }).next()).rejects.toBe(failure);
    const controller = new AbortController();
    await expect(api.scanOggPages({ size: 100, async read() { controller.abort(failure); return new Uint8Array(27); } }, { signal: controller.signal }).next()).rejects.toBe(failure);
  });

  it("rejects invalid source sizes, early EOF and oversized range responses", async () => {
    expect(api.scanOggPages).toBeTypeOf("function");
    for (const size of [-1, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(api.scanOggPages({ size, async read() { throw new Error("unexpected read"); } }).next()).rejects.toThrow("Invalid Ogg source size");
    }
    await expect(api.scanOggPages({ size: 100, async read() { return new Uint8Array(); } }).next()).rejects.toThrow("Truncated Ogg page");
    await expect(api.scanOggPages({ size: 100, async read() { return new Uint8Array(28); } }).next()).rejects.toThrow("Ogg source returned more bytes than requested");
  });

  it("observes late sequential errors and cancellation at EOF", async () => {
    expect(api.scanOggPages).toBeTypeOf("function");
    const bytes = fixture(), failure = new Error("late source"), controller = new AbortController();
    const collect = async (source: AsyncIterable<Uint8Array>, signal?: AbortSignal) => { for await (const ignoredPage of api.scanOggPages(source, { signal })) { /* validate all input */ } };
    await expect(collect({ async *[Symbol.asyncIterator]() { yield bytes; throw failure; } })).rejects.toBe(failure);
    await expect(collect({ async *[Symbol.asyncIterator]() { yield bytes; controller.abort(failure); } }, controller.signal)).rejects.toBe(failure);
  });

  it("preserves primary failures and reports iterator cleanup failures on early return", async () => {
    const bytes = fixture(), closeError = new Error("close failure"), readError = new Error("primary failure");
    const source = (fail: boolean): AsyncIterable<Uint8Array> => ({
      [Symbol.asyncIterator]() { return {
        async next() { if (fail) throw readError; return { done: false, value: bytes }; },
        async return() { throw closeError; }
      }; }
    });
    await expect(api.scanOggPages(source(true)).next()).rejects.toBe(readError);
    const pages = api.scanOggPages(source(false));
    await pages.next();
    await expect(pages.return()).rejects.toBe(closeError);
  });

  it("checks cancellation after checkpoints and before delivering the next page", async () => {
    const bytes = fixture(), controller = new AbortController(), error = new Error("checkpoint cancelled");
    const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); } };
    await expect(api.scanOggPages(source, { signal: controller.signal, async checkpoint() { controller.abort(error); } }).next()).rejects.toBe(error);
    const nextController = new AbortController(), pages = api.scanOggPages(source, { signal: nextController.signal });
    await pages.next();
    nextController.abort(error);
    await expect(pages.next()).rejects.toBe(error);
  });

});
