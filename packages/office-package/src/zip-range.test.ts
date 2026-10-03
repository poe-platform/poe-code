import { expect, it } from "vitest";
import { createZipCodec } from "./zip.js";
import { createCompressionCodec } from "./compression.js";

const limits = {maxArchiveBytes: 1024 * 1024, maxEntryBytes: 512 * 1024, maxTotalBytes: 1024 * 1024, maxMembers: 10, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 1024, chunkSize: 512};
const signal = new AbortController().signal;
const codec = createZipCodec({compression: createCompressionCodec(), yieldTurn: async signal => signal.throwIfAborted(), fail(message) {throw new Error(message);}});
const attributes = {modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store" as const};

it("discovers large stored members without materializing their bodies and decodes them on demand", async () => {
  const payload = new Uint8Array(256 * 1024).fill(37);
  const entry = await codec.makeZipEntry("large", payload, attributes, limits, signal);
  const archive = await codec.writeZipArchive({entries: [entry], comment: new Uint8Array()}, limits, signal);
  let decoding = false, payloadReads = 0;
  const parsed = await codec.readZipArchive({size: archive.length, async read(position, maximum, options) {
    expect(options.signal).toBe(signal);
    expect(maximum).toBeLessThanOrEqual(limits.chunkSize);
    if(position >= 4096 && position < 128 * 1024) {expect(decoding).toBe(true); payloadReads++;}
    return archive.subarray(position, position + maximum);
  }}, limits, signal);
  expect(payloadReads).toBe(0);
  decoding = true;
  let length = 0;
  for await(const chunk of codec.decodeZipEntry(parsed.entries[0]!, limits, signal)) {
    expect(chunk).toEqual(payload.subarray(length, length + chunk.length));
    length += chunk.length;
  }
  expect(length).toBe(payload.length);
  expect(payloadReads).toBeGreaterThan(100);
});

it("owns range bytes before another concurrent member read can reuse the source buffer", async () => {
  const entries = await Promise.all([1, 2].map(n => codec.makeZipEntry(`part-${n}`, new Uint8Array(8192).fill(n), attributes, limits, signal)));
  const archive = await codec.writeZipArchive({entries, comment: new Uint8Array()}, limits, signal);
  const scratch = new Uint8Array(limits.chunkSize);
  const parsed = await codec.readZipArchive({size: archive.length, async read(position, maximum) {
    scratch.fill(0); scratch.set(archive.subarray(position, position + maximum));
    return scratch.subarray(0, maximum);
  }}, limits, signal);
  await Promise.all(parsed.entries.map(async (entry, index) => {
    let length = 0;
    for await(const chunk of codec.decodeZipEntry(entry, limits, signal)) {
      expect([...chunk].every(byte => byte === index + 1)).toBe(true);
      length += chunk.length;
    }
    expect(length).toBe(8192);
  }));
});

it("propagates range read failures and cancellation without taking ownership of the reader", async () => {
  const failure = {error: "remote range failed"};
  await expect(codec.readZipArchive({size: 100, async read() {throw failure;}}, limits, signal)).rejects.toBe(failure);
  const controller = new AbortController();
  await expect(codec.readZipArchive({size: 100, async read() {
    controller.abort(failure); return new Uint8Array(100);
  }}, limits, controller.signal)).rejects.toBe(failure);
});

it.each([0, 513])("rejects invalid range reply length %s", async length => {
  await expect(codec.readZipArchive({size: 100, async read() {return new Uint8Array(length);}}, limits, signal)).rejects.toThrow("archive range");
});

it("propagates the member decode signal into a pending retained range read", async () => {
  const entry = await codec.makeZipEntry("part", new Uint8Array(8192).fill(4), attributes, limits, signal);
  const archive = await codec.writeZipArchive({entries: [entry], comment: new Uint8Array()}, limits, signal);
  let decoding = false;
  let observed: AbortSignal | undefined;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => {enter = resolve;});
  const released = new Promise<void>(resolve => {release = resolve;});
  const parsed = await codec.readZipArchive({size: archive.length, async read(position, maximum, options) {
    if (decoding) {
      observed = options.signal;
      enter();
      await released;
      options.signal.throwIfAborted();
    }
    return archive.subarray(position, position + maximum);
  }}, limits, signal);
  const controller = new AbortController();
  const reason = { stop: "only this member decode" };
  decoding = true;
  const output = codec.decodeZipEntry(parsed.entries[0]!, limits, controller.signal)[Symbol.asyncIterator]();
  const pending = output.next();
  const settled = pending.then(() => undefined, error => error);
  try {
    await entered;
    controller.abort(reason);
    expect(observed?.aborted).toBe(true);
    expect(observed?.reason).toBe(reason);
  } finally {
    release();
    expect(await settled).toBe(reason);
    await output.return!(undefined);
  }
});

it("finds the earliest legal end record with a maximum-length owned archive comment", async () => {
  const archive = new Uint8Array(22 + 65535);
  const header = new DataView(archive.buffer);
  header.setUint32(0, 0x06054b50, true);
  header.setUint16(20, 65535, true);
  archive.fill(91, 22);
  const reused = new Uint8Array(257);
  let firstRead = true;
  const parsed = await codec.readZipArchive({size: archive.length, async read(position, maximum) {
    if (firstRead) {expect(position).toBeGreaterThanOrEqual(archive.length - limits.chunkSize - 42); firstRead = false;}
    const count = Math.min(maximum, reused.length, archive.length - position);
    reused.fill(0);
    reused.set(archive.subarray(position, position + count));
    return reused.subarray(0, count);
  }}, {...limits, maxTextBytes: 65535}, signal);
  reused.fill(0);
  expect(parsed.entries).toEqual([]);
  expect(parsed.comment).toEqual(archive.subarray(22));
});

it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])("rejects invalid archive size %s before requesting source bytes", async size => {
  let reads = 0;
  await expect(codec.readZipArchive({size, async read() {reads++; return new Uint8Array();}}, limits, signal)).rejects.toThrow("archive byte");
  expect(reads).toBe(0);
});

it.each([undefined, "bytes", new DataView(new ArrayBuffer(4))])("rejects non-byte retained range responses (%s)", async response => {
  await expect(codec.readZipArchive({size: 100, async read() {return response as unknown as Uint8Array;}}, limits, signal)).rejects.toThrow("archive range");
});

it("shares one composed cancellation signal across a member's range reads", async () => {
  const entry = await codec.makeZipEntry("part", new Uint8Array(8192).fill(9), attributes, limits, signal);
  const archive = await codec.writeZipArchive({entries: [entry], comment: new Uint8Array()}, limits, signal);
  const observed = new Set<AbortSignal>();
  let decoding = false;
  const parsed = await codec.readZipArchive({size: archive.length, async read(position, maximum, options) {
    if (decoding) observed.add(options.signal);
    return archive.subarray(position, position + maximum);
  }}, limits, signal);
  decoding = true;
  for await (const chunk of codec.decodeZipEntry(parsed.entries[0]!, limits, new AbortController().signal)) void chunk;
  expect(observed.size).toBe(1);
});
