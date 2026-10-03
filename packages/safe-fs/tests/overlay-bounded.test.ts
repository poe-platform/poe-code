import { expect, test, vi } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { wrapped } from "./migration/fs/overlay/helpers.js";

const chunk = new Uint8Array(65536).fill(7);
const forbidden = () => { throw new Error("payload-wide I/O"); };

for (const operation of ["chmod", "append", "truncate"] as const) {
  test(`${operation} copies lower bytes through retained ranges`, async () => {
    const lower = new MemoryFileSystem(), upper = new MemoryFileSystem();
    await lower.writeFile("/file", chunk);
    const fs = new OverlayFileSystem({
      lower: wrapped(lower, { readFile: forbidden, readStream: undefined }),
      upper: wrapped(upper, { readFile: forbidden, writeFile: forbidden, truncate: undefined }),
    });
    if (operation === "chmod") await fs.chmod("/file", 0o600);
    if (operation === "append") await fs.writeStream("/file", (async function* () { yield chunk; })(), { flag: "a" });
    if (operation === "truncate") await fs.truncate("/file", chunk.length + 17);
    const bytes = await upper.readFile("/file");
    expect(bytes.length).toBe(operation === "chmod" ? chunk.length : operation === "append" ? chunk.length * 2 : chunk.length + 17);
    expect(Buffer.compare(bytes.subarray(0, chunk.length), chunk)).toBe(0);
    if (operation === "truncate") expect(bytes.subarray(chunk.length)).toEqual(new Uint8Array(17));
  });
}

test("whole-file-only upper refuses streaming before consuming input", async () => {
  const upper = new MemoryFileSystem();
  const fs = new OverlayFileSystem({ lower: new MemoryFileSystem(), upper: wrapped(upper, {
    capabilities: { ...upper.capabilities, streamingWrite: false }, writeStream: undefined,
  }) });
  const next = vi.fn(async () => ({ done: true as const, value: undefined }));
  await expect(fs.writeStream("/file", { [Symbol.asyncIterator]: () => ({ next }) })).rejects.toMatchObject({ code: "ENOTSUP" });
  expect(next).not.toHaveBeenCalled();
});

test("stock memory stream replacement retains inode and hardlink identity", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await upper.writeFile("/file", chunk);
  await upper.link("/file", "/alias");
  const fs = new OverlayFileSystem({ upper, lower });
  const before = await fs.stat("/file");
  await fs.writeStream("/file", (async function* () { yield new Uint8Array([42]); })());
  expect((await fs.stat("/file")).ino).toBe(before.ino);
  expect(await upper.readFile("/alias")).toEqual(new Uint8Array([42]));
});

import { boundedFileSystem } from "./fixtures/bounded-filesystem.js";

for (const size of [128 * 1024, 2 * 1024 * 1024]) {
  test(`copy-up and resize use fixed chunks for ${size} external bytes`, async () => {
    const lower = boundedFileSystem(), upper = boundedFileSystem();
    await lower.seed("/file", size);
    const fs = new OverlayFileSystem({ upper: upper.fs, lower: lower.fs });
    await fs.chmod("/file", 0o600);
    expect(upper.files.get("/file")).toEqual({ size, nonzero: size });
    await fs.truncate("/file", size + 17);
    expect(upper.files.get("/file")).toEqual({ size: size + 17, nonzero: size });
    await fs.truncate("/file", 17);
    expect(upper.files.get("/file")).toEqual({ size: 17, nonzero: 17 });
    for (const backend of [lower, upper]) {
      expect(backend.metrics.maxRead).toBeLessThanOrEqual(65536);
      expect(backend.metrics.maxWrite).toBeLessThanOrEqual(65536);
      expect(backend.metrics.payloadStored).toBe(0);
      expect(backend.metrics.openHandles).toBe(0);
      expect(backend.files.size).toBe(1);
    }
  });
}

for (const failure of ["sink", "abort"] as const) {
  test(`${failure} releases retained reads and removes private staging`, async () => {
    const lower = boundedFileSystem(), upper = boundedFileSystem();
    await lower.seed("/file", 131072);
    const fs = new OverlayFileSystem({ upper: upper.fs, lower: lower.fs });
    const controller = new AbortController(), reason = new Error(failure);
    upper.injectWrite(() => { if (failure === "abort") controller.abort(reason); else throw reason; });
    await expect(fs.chmod("/file", 0o600, { signal: controller.signal })).rejects.toBe(reason);
    expect(lower.metrics.openHandles).toBe(0);
    expect(upper.files.size).toBe(0);
    expect((await fs.stat("/file")).size).toBe(131072);
  });
}

test("slow sink applies backpressure to reused input chunks and closes failed source", async () => {
  const upper = boundedFileSystem(), lower = boundedFileSystem();
  const fs = new OverlayFileSystem({ upper: upper.fs, lower: lower.fs });
  let produced = 0, peak = 0, closed = false;
  const source = async function* () {
    const reused = new Uint8Array(65536).fill(7);
    try {
      for (let index = 0; index < 8; index++) {
        produced += reused.length; peak = Math.max(peak, produced - upper.metrics.writes * reused.length);
        yield reused;
      }
    } finally { closed = true; }
  };
  await fs.writeStream("/file", source());
  expect(peak).toBe(65536);
  expect(closed).toBe(true);
  expect(upper.files.get("/file")).toEqual({ size: 8 * 65536, nonzero: 8 * 65536 });
  closed = false;
  upper.injectWrite(() => { throw new Error("sink"); });
  await expect(fs.writeStream("/file", source())).rejects.toThrow("sink");
  expect(closed).toBe(true);
  expect(upper.files.size).toBe(1);
});

import { withFileSystemQuota } from "../src/fs/quota/index.js";

test("quota cannot advertise bounded streaming through a whole-file append backend", () => {
  const backend = new MemoryFileSystem();
  const quota = withFileSystemQuota(wrapped(backend, { capabilities: {
    ...backend.capabilities, streamingAppend: false,
  } }), { maxBytes: 1048576 });
  expect(quota.capabilities.streamingWrite).toBe(false);
});

test("memory publication transfers staged storage without a third payload allocation", async () => {
  const upper = new MemoryFileSystem({ maxRetainedBytes: 2 * 65536 + 8192 });
  await upper.writeFile("/file", chunk);
  const fs = new OverlayFileSystem({ upper, lower: new MemoryFileSystem() });
  await fs.writeStream("/file", (async function* () { yield chunk; })());
  expect((await fs.stat("/file")).size).toBe(65536);
});

import { S3FileSystem, createS3Transport, MockS3Client } from "../src/fs/s3/index.js";

test("S3 and quota wrappers expose buffered append as a capability limitation", () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const fs = new S3FileSystem({ bucket: "bucket", transport: createS3Transport(client, {
    streamingRead: true, streamingWrite: true, conditionalPut: true,
  }) });
  expect(fs.capabilities.streamingWrite).toBe(true);
  expect(fs.capabilities.streamingAppend).toBe(false);
  expect(withFileSystemQuota(fs, { maxBytes: 1048576 }).capabilities.streamingWrite).toBe(false);
});

test("quota stream claims require the backend stream method", async () => {
  const backend = new MemoryFileSystem();
  const fs = withFileSystemQuota(wrapped(backend, { writeStream: undefined }), { maxBytes: 1048576 });
  expect(fs.capabilities.streamingWrite).toBe(false);
  expect((await fs.capabilitiesFor!("/file", { create: true })).streamingAppend).toBe(false);
});

test("failed input leaves existing upper contents and identity intact", async () => {
  const upper = new MemoryFileSystem();
  await upper.writeFile("/file", new Uint8Array([9]));
  const fs = new OverlayFileSystem({ upper, lower: new MemoryFileSystem() });
  const before = await fs.stat("/file"), reason = new Error("source failed");
  await expect(fs.writeStream("/file", (async function* () { yield chunk; throw reason; })())).rejects.toBe(reason);
  expect((await fs.stat("/file")).ino).toBe(before.ino);
  expect(await fs.readFile("/file")).toEqual(new Uint8Array([9]));
  expect((await upper.readdir("/")).map(entry => entry.name)).toEqual(["file"]);
});
