import assert from "node:assert/strict";
import { test } from "node:test";
import type { ByteSource } from "../../../src/contracts/io.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "./mock.js";
import { withLoopbackDav } from "./property-fixture.js";

const payload = Uint8Array.from({ length: 4099 }, (_, index) => index % 256);
async function* source(data = payload): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < data.length; offset += 17) yield data.subarray(offset, offset + 17);
}

function fixture(mock = new MockDav(), maxResponseBytes = 64 * 1024) {
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch, maxResponseBytes });
  return { fs, mock };
}

test("streamed PUT preserves bytes, append snapshots and exclusive creation", async () => {
  const { fs, mock } = fixture();
  assert.equal(fs.capabilities.streamingWrite, true);
  await fs.writeStream("/file", source(), { flag: "wx" });
  assert.deepEqual(await fs.readFile("/file"), payload);
  await assert.rejects(fs.writeStream("/file", source(), { flag: "wx" }), { code: "EEXIST" });
  await assert.rejects(fs.writeStream("/file", source(), { flag: "ax" }), { code: "EEXIST" });
  await fs.writeStream("/file", source(new Uint8Array([0, 255])), { flag: "a" });
  assert.deepEqual(await fs.readFile("/file"), new Uint8Array([...payload, 0, 255]));
  assert.ok(mock.requests.filter(request => request.init.method === "PUT").at(-1)!.headers.has("If-Match"));
  await fs.writeStream("/file", source(new Uint8Array()));
  assert.deepEqual(await fs.readFile("/file"), new Uint8Array());
  await fs.writeStream("/new", source(), { flag: "a" });
  assert.deepEqual(await fs.readFile("/new"), payload);
  assert.equal(mock.requests.filter(request => request.init.method === "PUT").at(-1)!.headers.get("If-None-Match"), "*");
});

test("streamed append rejects version races without clobbering concurrent writes", async () => {
  for (const existing of [true, false]) {
    const mock = new MockDav();
    if (existing) mock.files.set("/file", new Uint8Array([1]));
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
      if (init.method === "PUT") mock.files.set("/file", new Uint8Array([99]));
      return mock.fetch(url, init);
    } });
    await assert.rejects(fs.writeStream("/file", source(), { flag: "a" }), { code: existing ? "EAGAIN" : "EEXIST" });
    assert.deepEqual(mock.files.get("/file"), new Uint8Array([99]));
  }
});

test("uploads are pull driven and copy mutable producer buffers", async () => {
  let reads = 0;
  let ready!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const mock = new MockDav();
  const stored: Uint8Array[] = [];
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    if (init.method !== "PUT") return mock.fetch(url, init);
    assert.ok(init.body instanceof ReadableStream);
    assert.equal(init.duplex, "half");
    const reader = init.body.getReader();
    const first = await reader.read();
    stored.push(first.value!);
    ready();
    await resume;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      stored.push(next.value);
    }
    reader.releaseLock();
    return new Response(null, { status: 201 });
  } });
  const upload = fs.writeStream("/file", (async function* () {
    const chunk = new Uint8Array([1, 2]);
    for (const value of [1, 3, 5]) { reads++; chunk[0] = value; yield chunk; }
  })());
  await started;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  release();
  await upload;
  assert.deepEqual(stored, [new Uint8Array([1, 2]), new Uint8Array([3, 2]), new Uint8Array([5, 2])]);
});

test("upload cancellation releases blocked producer and observes its late rejection", { timeout: 2000 }, async () => {
  const { fs } = fixture();
  let ready!: () => void;
  let rejectRead!: (error: Error) => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  let returned = 0;
  const blocked: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { ready(); return new Promise((_resolve, reject) => { rejectRead = reject; }); },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  const controller = new AbortController();
  const rejected = assert.rejects(fs.writeStream("/file", blocked, { signal: controller.signal }), { code: "ECANCELED" });
  await started;
  controller.abort();
  await rejected;
  rejectRead(new Error("late source failure"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, 1);
});

test("upload deadline interrupts an uncooperative source without waiting for iterator cleanup", { timeout: 2000 }, async context => {
  const keepAlive = setInterval(() => {}, 1000);
  context.after(() => clearInterval(keepAlive));
  const mock = new MockDav();
  let returned = false;
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch, timeoutMs: 30 });
  const blocked: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { return new Promise(() => {}); },
    return() { returned = true; return new Promise(() => {}); },
  }; } };
  await assert.rejects(fs.writeStream("/file", blocked), { code: "ETIMEDOUT" });
  assert.equal(returned, true);
  assert.ok(!mock.files.has("/file"));
});

test("upload limits, invalid paths and permission failures are not silent successes", async () => {
  const { fs, mock } = fixture(new MockDav(), 10);
  await assert.rejects(fs.writeStream("/file", source()), { code: "EFBIG" });
  assert.ok(!mock.files.has("/file"));
  await assert.rejects(fs.writeStream("/", source()), { code: "EISDIR" });
  await assert.rejects(fs.writeStream("/absent/file", source()), { code: "ENOENT" });
  await assert.rejects(fs.writeStream("/file", source(), { mode: 0o600 }), { code: "ENOTSUP" });
  await assert.rejects(fs.writeStream("/file", source(), { signal: AbortSignal.abort() }), { code: "ECANCELED" });
  for (const [status, code] of [[201, "EIO"], [403, "EACCES"], [423, "EBUSY"], [507, "ENOSPC"]] as const) {
    let reads = 0;
    const early = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: (url, init) =>
      init.method === "PUT" ? Promise.resolve(new Response(null, { status })) : mock.fetch(url, init) });
    await assert.rejects(early.writeStream("/file", (async function* () { reads++; yield payload; })()), { code });
    assert.equal(reads, 0);
  }
});

test("real loopback Fetch accepts chunked uploads and preserves empty binary append", async () => {
  const mock = new MockDav();
  await withLoopbackDav(mock.fetch, async baseUrl => {
    const fs = new WebDavFileSystem({ baseUrl, fetch, timeoutMs: 2000 });
    await fs.writeStream("/file", source(), { flag: "wx" });
    assert.deepEqual(await fs.readFile("/file"), payload);
    await fs.writeStream("/file", source(new Uint8Array([128, 255])), { flag: "a" });
    assert.deepEqual(await fs.readFile("/file"), new Uint8Array([...payload, 128, 255]));
    await fs.writeStream("/empty", source(new Uint8Array()));
    assert.deepEqual(await fs.readFile("/empty"), new Uint8Array());
    assert.equal(mock.requests.find(request => request.init.method === "PUT")!.headers.get("Transfer-Encoding"), "chunked");
  });
});
