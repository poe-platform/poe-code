import { deflateRawSync } from "node:zlib";
import { expect, it } from "vitest";
import { createZipCodec, crc32 } from "./zip.js";
import { createCompressionCodec } from "./compression.js";
import { defaultRuntime } from "./runtime.js";

const limits = {
  maxArchiveBytes: 1024 * 1024, maxEntryBytes: 1024 * 1024, maxTotalBytes: 1024 * 1024,
  maxMembers: 10, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024,
  maxTextBytes: 1024, chunkSize: 512
};
const zip = createZipCodec({compression: createCompressionCodec(), yieldTurn: async signal => signal.throwIfAborted(), fail(message) {throw new Error(message);}});
const metadata = {name: "payload", modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false};

it.each([0, 8])("decodes streamed ZIP method %s with backpressure and owned bounded output", async method => {
  const bytes = new Uint8Array(128 * 1024);
  let state = 12345;
  for(let i = 0; i < bytes.length; i++) {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; bytes[i] = state >>> 24;}
  const encoded = method === 8 ? new Uint8Array(deflateRawSync(bytes)) : bytes;
  expect(encoded.length).toBeGreaterThan(limits.chunkSize * 100);
  let reads = 0, closed = false;
  const source = (async function* () {
    const reused = new Uint8Array(257);
    try {
      for(let offset = 0; offset < encoded.length; offset += reused.length) {
        const part = encoded.subarray(offset, offset + reused.length);
        reused.fill(0); reused.set(part); reads++;
        yield reused.subarray(0, part.length);
      }
    } finally {closed = true;}
  })();
  const stream = zip.decodeZipEntry({...metadata, data: source, compressedSize: encoded.length, size: bytes.length, crc32: crc32(bytes), method}, limits, new AbortController().signal);
  const output = stream[Symbol.asyncIterator]();
  expect(reads).toBe(0);
  const first = await output.next();
  expect(first.done).toBe(false);
  const snapshot = new Uint8Array(first.value!);
  const pausedReads = reads;
  await Promise.resolve();
  expect(reads).toBe(pausedReads);
  expect(reads).toBeLessThan(10);
  let offset = first.value!.length;
  expect(first.value).toEqual(bytes.subarray(0, offset));
  for await (const chunk of stream) {
    expect(chunk.length).toBeLessThanOrEqual(limits.chunkSize);
    expect(chunk).toEqual(bytes.subarray(offset, offset + chunk.length));
    offset += chunk.length;
  }
  expect(offset).toBe(bytes.length);
  expect(first.value).toEqual(snapshot);
  expect(closed).toBe(true);
});

it("closes streamed ZIP input on early return and cancellation", async () => {
  for(const abort of [false, true]) {
    const controller = new AbortController();
    let closed = false;
    const data = (async function* () {try {yield new Uint8Array(1024); yield new Uint8Array(1024);} finally {closed = true;}})();
    const stream = zip.decodeZipEntry({...metadata, data, compressedSize: 2048, size: 2048, crc32: 0, method: 0}, limits, controller.signal);
    const output = stream[Symbol.asyncIterator]();
    await output.next();
    if(abort) {
      const reason = new Error("stop ZIP read"); controller.abort(reason);
      await expect(output.next()).rejects.toBe(reason);
    } else await output.return!(undefined);
    expect(closed).toBe(true);
  }
});

it.each(["size", "crc", "truncated", "trailing", "compressed-size"])("rejects %s in streamed ZIP entries and closes their producer", async failure => {
  const bytes = new TextEncoder().encode("123456789");
  let data = new Uint8Array(deflateRawSync(bytes));
  if(failure === "truncated") data = data.slice(0, -1);
  if(failure === "trailing") data = Uint8Array.from([...data, 42]);
  let closed = false;
  const source = (async function* () {try {for(const byte of data) yield Uint8Array.of(byte);} finally {closed = true;}})();
  const stream = zip.decodeZipEntry({...metadata, data: source, compressedSize: data.length + (failure === "compressed-size" ? 1 : 0), size: bytes.length + (failure === "size" ? 1 : 0), crc32: failure === "crc" ? 0 : 0xcbf43926, method: 8}, limits, new AbortController().signal);
  await expect((async () => {for await(const chunk of stream) void chunk;})()).rejects.toThrow();
  expect(closed).toBe(true);
});


it("keeps empty input chunks cooperative and closes the source when its checkpoint fails", async () => {
  const stop = new Error("checkpoint stopped");
  let reads = 0, closed = false;
  const compression = createCompressionCodec({...defaultRuntime, yieldTurn: async () => {throw stop;}});
  const codec = createZipCodec({compression, yieldTurn: async () => {}, fail(message) {throw new Error(message);}});
  const data = (async function* () {
    try {for(let i = 0; i < 1000; i++) {reads++; yield new Uint8Array();}}
    finally {closed = true;}
  })();
  const stream = codec.decodeZipEntry({...metadata, data, compressedSize: 0, size: 0, crc32: 0, method: 0}, limits, new AbortController().signal);
  await expect((async () => {for await(const chunk of stream) void chunk;})()).rejects.toBe(stop);
  expect(reads).toBeLessThan(64);
  expect(closed).toBe(true);
});

it.each([0, 8])("preserves method %s producer failures after output and releases its input exactly once", async method => {
  const bytes = new TextEncoder().encode("producer ownership ".repeat(4000));
  const encoded = method === 8 ? new Uint8Array(deflateRawSync(bytes)) : new Uint8Array(bytes);
  const failure = { source: "failed after its final payload" };
  let closed = 0;
  const source = (async function* () {
    try { yield encoded; throw failure; }
    finally { closed++; encoded.fill(255); }
  })();
  const retained: Uint8Array[] = [];
  const stream = zip.decodeZipEntry({...metadata, data: source, compressedSize: encoded.length, size: bytes.length, crc32: crc32(bytes), method}, limits, new AbortController().signal);
  await expect((async () => {for await (const chunk of stream) retained.push(chunk);})()).rejects.toBe(failure);
  expect(closed).toBe(1);
  expect(retained.length).toBeGreaterThan(0);
  expect(retained.every(chunk => chunk.length <= limits.chunkSize)).toBe(true);
  const output = Buffer.concat(retained);
  expect(output.equals(bytes.subarray(0, output.length))).toBe(true);
});

it("closes deflated input after a partial consumer read without invalidating published chunks", async () => {
  const bytes = new TextEncoder().encode("compressed early return ".repeat(4000));
  const encoded = new Uint8Array(deflateRawSync(bytes));
  let closed = 0;
  const source = (async function* () {
    try { yield encoded; }
    finally { closed++; encoded.fill(255); }
  })();
  const output = zip.decodeZipEntry({...metadata, data: source, compressedSize: encoded.length, size: bytes.length, crc32: crc32(bytes), method: 8}, limits, new AbortController().signal)[Symbol.asyncIterator]();
  const first = await output.next();
  expect(first.done).toBe(false);
  expect(closed).toBe(0);
  await output.return!(undefined);
  await output.return!(undefined);
  expect(closed).toBe(1);
  expect(first.value).toEqual(bytes.subarray(0, limits.chunkSize));
});
