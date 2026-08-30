import assert from "node:assert/strict";
import { test } from "node:test";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import type { ReadStreamOptions } from "../../../src/contracts/filesystem.js";
import { MockDav } from "./mock.js";

const payload = Uint8Array.from({ length: 4099 }, (_, index) => index % 256);

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

function fixture(get?: () => Response, options: { timeoutMs?: number; maxResponseBytes?: number } = {}) {
  const mock = new MockDav();
  mock.files.set("/file", payload);
  mock.files.set("/empty", new Uint8Array());
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", ...options,
    fetch: (url, init) => init.method === "GET" && get ? Promise.resolve(get()) : mock.fetch(url, init),
  });
  return { fs, mock };
}

test("read access checks GET authorization, not synthesized POSIX mode bits", async () => {
  const { fs, mock } = fixture();
  await fs.access("/file", 4);
  await fs.access("/", 4);
  await assert.rejects(fs.access("/missing", 4), { code: "ENOENT" });
  for (const mode of [1, 2, 3, 5, 6, 7]) await assert.rejects(fs.access("/file", mode), { code: "ENOTSUP" });
  for (const mode of [-1, 8, 1.5, NaN]) await assert.rejects(fs.access("/file", mode), { code: "EINVAL" });
  assert.equal(mock.requests.filter(request => request.init.method === "GET").length, 1);
  for (const [status, code] of [[401, "EACCES"], [403, "EACCES"], [404, "ENOENT"], [423, "EBUSY"], [503, "EAGAIN"]] as const) {
    await assert.rejects(fixture(() => new Response(null, { status })).fs.access("/file", 4), { code });
  }
});

test("read streams are lazy, binary exact, ranged and chunk bounded", async () => {
  const { fs, mock } = fixture();
  const stream = fs.readStream("/file", { start: 13, endExclusive: 4097, chunkSize: 17 });
  assert.equal(mock.requests.length, 0);
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) { assert.ok(chunk.length <= 17); chunks.push(chunk); }
  assert.deepEqual(new Uint8Array(Buffer.concat(chunks)), payload.slice(13, 4097));
  assert.deepEqual(await collect(fs.readStream("/file")), payload);
  assert.deepEqual(await collect(fs.readStream("/file", { start: 5000 })), new Uint8Array());
  assert.deepEqual(await collect(fs.readStream("/file", { start: 2, endExclusive: 2 })), new Uint8Array());
  assert.deepEqual(await collect(fs.readStream("/empty")), new Uint8Array());
  assert.equal(fs.capabilities.streamingRead, true);
  await assert.rejects(collect(fs.readStream("/")), { code: "EISDIR" });
  await assert.rejects(collect(fs.readStream("/missing")), { code: "ENOENT" });
  await assert.rejects(collect(fs.readStream("/file/")), { code: "ENOTDIR" });
});

test("invalid stream options and pre-aborted requests do not dispatch", async () => {
  const { fs, mock } = fixture();
  for (const options of [{ start: -1 }, { start: NaN }, { endExclusive: Infinity }, { start: 3, endExclusive: 2 },
    { chunkSize: 0 }, { chunkSize: 0.5 }, { start: Number.MAX_SAFE_INTEGER + 1 }] satisfies ReadStreamOptions[]) {
    await assert.rejects(collect(fs.readStream("/file", options)), { code: "EINVAL" });
  }
  await assert.rejects(collect(fs.readStream("/file", { signal: AbortSignal.abort() })), { code: "ECANCELED" });
  await assert.rejects(fs.access("/file", 4, { signal: AbortSignal.abort() }), { code: "ECANCELED" });
  assert.equal(mock.requests.length, 0);
});

test("stream backpressure and early return cancel without draining the response", async () => {
  let pulls = 0;
  let cancelled = 0;
  const { fs } = fixture(() => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(payload.slice(0, 3)); },
    cancel() { cancelled++; },
  }, { highWaterMark: 0 })));
  const stream = fs.readStream("/file");
  assert.deepEqual((await stream.next()).value, payload.slice(0, 3));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pulls, 1);
  await stream.return(undefined);
  assert.equal(pulls, 1);
  assert.equal(cancelled, 1);
});

test("blocked response reads and consumer pauses observe cancellation and deadlines", { timeout: 2000 }, async context => {
  const keepAlive = setInterval(() => {}, 1000);
  context.after(() => clearInterval(keepAlive));
  for (const deadline of [false, true]) {
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    let cancelled = 0;
    const { fs } = fixture(() => new Response(new ReadableStream<Uint8Array>({
      pull() { ready(); }, cancel() { cancelled++; },
    }, { highWaterMark: 0 })), { timeoutMs: deadline ? 30 : 1000 });
    const controller = new AbortController();
    const result = collect(fs.readStream("/file", { signal: controller.signal }));
    const rejected = assert.rejects(result, { code: deadline ? "ETIMEDOUT" : "ECANCELED" });
    await started;
    if (!deadline) controller.abort(new Error("stop"));
    await rejected;
    assert.equal(cancelled, 1);
  }
  const controller = new AbortController();
  const { fs } = fixture();
  const stream = fs.readStream("/file", { chunkSize: 1, signal: controller.signal });
  await stream.next();
  controller.abort();
  await assert.rejects(stream.next(), { code: "ECANCELED" });
});

test("stream bodies enforce byte limits, declared lengths and actual HTTP failures", async () => {
  for (const length of ["bogus", "9007199254740992", "1", "4"]) {
    const { fs } = fixture(() => new Response(new Uint8Array([0, 255]), { headers: { "Content-Length": length } }));
    await assert.rejects(collect(fs.readStream("/file")), { code: "EIO" });
  }
  await assert.rejects(collect(fixture(() => new Response(payload), { maxResponseBytes: 100 }).fs.readStream("/file")), { code: "EFBIG" });
  await assert.rejects(collect(fixture(() => new Response(null, { status: 403 })).fs.readStream("/file")), { code: "EACCES" });
  await assert.rejects(collect(fixture(() => new Response(new ReadableStream({ start(controller) { controller.error(new Error("broken")); } }))).fs.readStream("/file")), { code: "EIO" });
});
