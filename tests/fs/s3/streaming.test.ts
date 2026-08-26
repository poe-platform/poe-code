import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { FsError, isFsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import { collectBytes, toByteSource } from "../../../src/contracts/io.js";
import type { ByteSource } from "../../../src/contracts/io.js";
import { MockS3Client, S3FileSystem, S3ServiceError, createS3Transport } from "../../../src/fs/s3/index.js";
import type { S3StreamGetOutput, S3Transport } from "../../../src/fs/s3/transport.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const errno = (code: ErrnoCode) => (error: unknown) => isFsError(error, code);

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

async function setup(overrides: Partial<S3Transport> = {}) {
  const client = new MockS3Client({ buckets: ["bucket"] });
  await client.putObject({ Bucket: "bucket", Key: "input", Body: bytes("abcdef") });
  const transport = { ...createS3Transport(client, client.capabilities), ...overrides };
  return { client, transport, fs: new S3FileSystem({ bucket: "bucket", transport }) };
}

test("stream discovery requires both negotiated capability and a streaming method", async () => {
  const { client } = await setup();
  const capable = createS3Transport(client, client.capabilities);
  const { getObjectStream: _read, putObjectStream: _write, ...buffered } = capable;
  const fs = new S3FileSystem({ bucket: "bucket", transport: buffered });
  assert.equal(fs.readStream, undefined);
  assert.equal(fs.writeStream, undefined);
  assert.equal(fs.capabilities.streamingRead, false);
  assert.equal(fs.capabilities.streamingWrite, false);
  assert.deepEqual(await fs.readFile("/input"), bytes("abcdef"));
});

test("stream reads pull only on demand, split chunks and release on early return", async () => {
  let pulls = 0;
  let returns = 0;
  const payload = bytes("abcdef");
  const body: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { pulls++; return pulls === 1 ? { done: false, value: payload } : { done: true, value: undefined }; },
    async return() { returns++; return { done: true, value: undefined }; },
  }; } };
  const { fs } = await setup({ async getObjectStream() { return { ContentLength: 6, Body: body }; } });
  assert.ok(fs.readStream);
  const iterator = fs.readStream("/input", { chunkSize: 2 })[Symbol.asyncIterator]();
  assert.equal(pulls, 0);
  const first = await iterator.next();
  assert.deepEqual(first.value, bytes("ab"));
  first.value!.fill(255);
  assert.equal(pulls, 1);
  assert.deepEqual((await iterator.next()).value, bytes("cd"));
  assert.equal(pulls, 1);
  await iterator.return!();
  await setImmediate();
  assert.equal(returns, 1);
  assert.deepEqual(payload, bytes("abcdef"));
});

test("early consumer return does not hang on an uncooperative response return hook", { timeout: 2000 }, async () => {
  let returned = false;
  const { fs } = await setup({ async getObjectStream() { return { ContentLength: 6, Body: {
    [Symbol.asyncIterator]() { return {
      async next() { return { done: false, value: bytes("abc") }; },
      return() { returned = true; return new Promise(() => {}); },
    }; },
  } }; } });
  assert.ok(fs.readStream);
  const iterator = fs.readStream("/input")[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.return!();
  await setImmediate();
  assert.equal(returned, true);
});

test("abort interrupts stalled response next and observes its late rejection", { timeout: 2000 }, async () => {
  const entered = deferred<void>();
  const pending = deferred<IteratorResult<Uint8Array>>();
  let returned = false;
  const { fs } = await setup({ async getObjectStream() { return { ContentLength: 6, Body: {
    [Symbol.asyncIterator]() { return {
      next() { entered.resolve(); return pending.promise; },
      async return() { returned = true; return { done: true, value: undefined }; },
    }; },
  } }; } });
  const controller = new AbortController();
  assert.ok(fs.readStream);
  const reading = collectBytes(fs.readStream("/input", { signal: controller.signal }), { maxBytes: 6 });
  await entered.promise;
  controller.abort("stop");
  await assert.rejects(reading, errno("ECANCELED"));
  pending.reject(new Error("late response failure"));
  await setImmediate();
  assert.equal(returned, true);
});

test("abort stops awaiting transport and releases an eventual response body", { timeout: 2000 }, async () => {
  const entered = deferred<void>();
  const pending = deferred<S3StreamGetOutput>();
  let destroyed = false;
  const { fs } = await setup({ getObjectStream() { entered.resolve(); return pending.promise; } });
  const controller = new AbortController();
  assert.ok(fs.readStream);
  const reading = collectBytes(fs.readStream("/input", { signal: controller.signal }), { maxBytes: 6 });
  await entered.promise;
  controller.abort();
  await assert.rejects(reading, errno("ECANCELED"));
  const body = Object.assign(toByteSource(bytes("abcdef")), { destroy() { destroyed = true; } });
  pending.resolve({ Body: body, ContentLength: 6 });
  await setImmediate();
  assert.equal(destroyed, true);
});

for (const variant of ["short", "long", "header", "etag", "text"] as const) {
  test(`corrupt streaming response ${variant} rejects and cleans up`, async () => {
    let destroyed = false;
    const body = Object.assign((async function* () {
      if (variant === "text") yield "abcdef" as unknown as Uint8Array;
      else yield bytes(variant === "short" ? "abc" : variant === "long" ? "abcdefg" : "abcdef");
    })(), { destroy() { destroyed = true; } });
    const { fs } = await setup({ async getObjectStream() { return {
      ContentLength: variant === "header" ? 7 : 6, Body: body, ...(variant === "etag" ? { ETag: '"wrong"' } : {}),
    }; } });
    assert.ok(fs.readStream);
    await assert.rejects(collectBytes(fs.readStream("/input"), { maxBytes: 20 }), errno("EIO"));
    assert.equal(destroyed, true);
  });
}

test("empty reads still enforce GET authorization; exact empty ranges and EOF do not issue invalid Range", async () => {
  let deny = false;
  const client = new MockS3Client({ buckets: ["bucket"], authorize(request) {
    if (deny && request.operation === "getObject") throw new S3ServiceError("AccessDenied", 403);
  } });
  const fs = new S3FileSystem({ bucket: "bucket", transport: client });
  await fs.writeFile("/empty", new Uint8Array());
  assert.ok(fs.readStream);
  assert.deepEqual(await collectBytes(fs.readStream("/empty"), { maxBytes: 0 }), new Uint8Array());
  assert.deepEqual(await collectBytes(fs.readStream("/empty", { start: 9 }), { maxBytes: 0 }), new Uint8Array());
  deny = true;
  await assert.rejects(collectBytes(fs.readStream("/empty"), { maxBytes: 0 }), errno("EACCES"));
  deny = false;
  await fs.writeFile("/input", bytes("abc"));
  assert.deepEqual(await collectBytes(fs.readStream("/input", { start: 9 }), { maxBytes: 0 }), new Uint8Array());
  assert.deepEqual(await collectBytes(fs.readStream("/input", { start: 1, endExclusive: 1 }), { maxBytes: 0 }), new Uint8Array());
});

test("read argument and transfer budgets fail before requesting a body", async () => {
  const { client, transport } = await setup();
  const fs = new S3FileSystem({ bucket: "bucket", transport, maxStreamBytes: 3 });
  assert.ok(fs.readStream);
  for (const options of [{ start: -1 }, { endExclusive: -1 }, { start: 3, endExclusive: 2 }, { chunkSize: 0 }, { start: 1.5 }]) {
    await assert.rejects(collectBytes(fs.readStream("/input", options), { maxBytes: 6 }), errno("EINVAL"));
  }
  await assert.rejects(collectBytes(fs.readStream("/input"), { maxBytes: 6 }), errno("EFBIG"));
  assert.equal(client.requests.some(request => request.operation === "getObject"), false);
  assert.deepEqual(await collectBytes(fs.readStream("/input", { start: 2, endExclusive: 5 }), { maxBytes: 3 }), bytes("cde"));
});

test("stream source snapshots reject a concurrent object replacement before GET", async () => {
  const { client, transport } = await setup();
  const fs = new S3FileSystem({ bucket: "bucket", transport: { ...transport, async getObjectStream(input, options) {
    await client.putObject({ Bucket: "bucket", Key: "input", Body: bytes("newnew") });
    return client.getObjectStream(input, options);
  } } });
  assert.ok(fs.readStream);
  await assert.rejects(collectBytes(fs.readStream("/input"), { maxBytes: 6 }), errno("EAGAIN"));
});

test("stream writes follow transport demand and do not mutate producer chunks", async () => {
  let pulls = 0;
  const payload = bytes("abc");
  const nextAllowed = deferred<void>();
  const entered = deferred<void>();
  const { client, transport } = await setup();
  const fs = new S3FileSystem({ bucket: "bucket", transport: { ...transport, async putObjectStream(input, options) {
    assert.equal(pulls, 0);
    const iterator = input.Body[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.equal(pulls, 1);
    first.value!.fill(255);
    entered.resolve();
    await nextAllowed.promise;
    assert.equal(pulls, 1);
    const second = await iterator.next();
    assert.deepEqual(second.value, bytes("def"));
    assert.equal((await iterator.next()).done, true);
    await client.putObject({ ...input, Body: bytes("abcdef") }, options);
  } } });
  const source = (async function* () { pulls++; yield payload; pulls++; yield bytes("def"); })();
  assert.ok(fs.writeStream);
  const writing = fs.writeStream("/output", source);
  await entered.promise;
  assert.equal(pulls, 1);
  assert.deepEqual(payload, bytes("abc"));
  nextAllowed.resolve();
  await writing;
  assert.deepEqual(await fs.readFile("/output"), bytes("abcdef"));
});

test("stream upload limit closes input and preserves an existing object", async () => {
  const { transport } = await setup();
  const fs = new S3FileSystem({ bucket: "bucket", transport, maxStreamBytes: 4 });
  let closed = false;
  const source = (async function* () { try { yield bytes("abc"); yield bytes("de"); } finally { closed = true; } })();
  assert.ok(fs.writeStream);
  await assert.rejects(fs.writeStream("/input", source), errno("EFBIG"));
  assert.equal(closed, true);
  assert.deepEqual(await fs.readFile("/input"), bytes("abcdef"));
});

test("stream source failure preserves prior bytes and maps to EIO", async () => {
  const { fs } = await setup();
  assert.ok(fs.writeStream);
  await assert.rejects(fs.writeStream("/input", (async function* () {
    yield bytes("abc"); throw new Error("source broke");
  })()), errno("EIO"));
  assert.deepEqual(await fs.readFile("/input"), bytes("abcdef"));
});

test("abort interrupts a stalled upload source without publishing partial data", { timeout: 2000 }, async () => {
  const { fs } = await setup();
  const entered = deferred<void>();
  const pending = deferred<IteratorResult<Uint8Array>>();
  let returned = false;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { entered.resolve(); return pending.promise; },
    async return() { returned = true; return { done: true, value: undefined }; },
  }; } };
  const controller = new AbortController();
  assert.ok(fs.writeStream);
  const writing = fs.writeStream("/input", source, { signal: controller.signal });
  await entered.promise;
  controller.abort();
  await assert.rejects(writing, errno("ECANCELED"));
  pending.reject(new Error("late source rejection"));
  await setImmediate();
  assert.equal(returned, true);
  assert.deepEqual(await fs.readFile("/input"), bytes("abcdef"));
});

test("early transport success without consuming the stream is not reported as a completed write", async () => {
  const { fs } = await setup({ async putObjectStream() { return {}; } });
  assert.ok(fs.writeStream);
  await assert.rejects(fs.writeStream("/input", toByteSource(bytes("replacement"))), errno("EIO"));
  assert.deepEqual(await fs.readFile("/input"), bytes("abcdef"));
});

test("a transport failure cancels a pending producer pull and observes its late failure", { timeout: 2000 }, async () => {
  const entered = deferred<void>();
  const pending = deferred<IteratorResult<Uint8Array>>();
  let returned = false;
  const { fs } = await setup({ async putObjectStream(input) {
    const iterator = input.Body[Symbol.asyncIterator]();
    void iterator.next().catch(() => {});
    await entered.promise;
    throw new S3ServiceError("AccessDenied", 403);
  } });
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { entered.resolve(); return pending.promise; },
    async return() { returned = true; return { done: true, value: undefined }; },
  }; } };
  assert.ok(fs.writeStream);
  await assert.rejects(fs.writeStream("/input", source), errno("EACCES"));
  pending.reject(new Error("late failure"));
  await setImmediate();
  assert.equal(returned, true);
});

test("exclusive stream conditions are evaluated after upload and preserve a concurrent winner", async () => {
  const { client, fs } = await setup();
  assert.ok(fs.writeStream);
  await assert.rejects(fs.writeStream("/output", (async function* () {
    yield bytes("loser");
    await client.putObject({ Bucket: "bucket", Key: "output", Body: bytes("winner") });
  })(), { flag: "wx" }), errno("EEXIST"));
  assert.deepEqual(await fs.readFile("/output"), bytes("winner"));
});

test("pre-aborted stream operations and readonly mutations consume no input", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const fs = new S3FileSystem({ bucket: "bucket", transport: client });
  const readonly = new S3FileSystem({ bucket: "bucket", transport: client, readOnly: true });
  const signal = AbortSignal.abort();
  const source = (async function* () { throw new FsError("EIO", { message: "must not consume" }); })();
  assert.ok(fs.readStream);
  assert.ok(fs.writeStream);
  assert.ok(readonly.writeStream);
  await assert.rejects(collectBytes(fs.readStream("/input", { signal }), { maxBytes: 0 }), errno("ECANCELED"));
  await assert.rejects(fs.writeStream("/input", source, { signal }), errno("ECANCELED"));
  await assert.rejects(readonly.writeStream("/input", source), errno("EROFS"));
  assert.equal(client.requests.length, 0);
});

test("stream append is explicitly bounded and preserves metadata with a conditional write", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const fs = new S3FileSystem({ bucket: "bucket", transport: client, maxStreamBytes: 4, maxReadBytes: 8 });
  await client.putObject({ Bucket: "bucket", Key: "input", Body: bytes("ab"), Metadata: { custom: "retained" } });
  assert.ok(fs.writeStream);
  await fs.writeStream("/input", toByteSource(bytes("cd")), { flag: "a" });
  assert.deepEqual(await fs.readFile("/input"), bytes("abcd"));
  await assert.rejects(fs.writeStream("/input", toByteSource(bytes("e")), { flag: "a" }), errno("EFBIG"));
  assert.equal((await client.headObject({ Bucket: "bucket", Key: "input" })).Metadata?.custom, "retained");
});

test("stream flags cover empty replacement, new append, exclusive append and concurrent append conflicts", async () => {
  const { client, fs } = await setup();
  assert.ok(fs.writeStream);
  await fs.writeStream("/empty", toByteSource(new Uint8Array()), { flag: "wx" });
  assert.deepEqual(await fs.readFile("/empty"), new Uint8Array());
  await fs.writeStream("/append", toByteSource(bytes("a")), { flag: "a", mode: 0o600 });
  await fs.writeStream("/exclusive", toByteSource(bytes("b")), { flag: "ax" });
  await assert.rejects(fs.writeStream("/exclusive", toByteSource(bytes("c")), { flag: "ax" }), errno("EEXIST"));
  await assert.rejects(fs.writeStream("/append", (async function* () {
    yield bytes("loser");
    await client.putObject({ Bucket: "bucket", Key: "append", Body: bytes("winner") });
  })(), { flag: "a" }), errno("EAGAIN"));
  assert.deepEqual(await fs.readFile("/append"), bytes("winner"));
  await fs.writeStream("/input", toByteSource(new Uint8Array()));
  assert.deepEqual(await fs.readFile("/input"), new Uint8Array());
});

test("deterministic range boundaries preserve the exclusive endpoint and chunk budget", async () => {
  const { fs } = await setup();
  assert.ok(fs.readStream);
  for (let start = 0; start <= 8; start++) {
    for (let endExclusive = start; endExclusive <= 9; endExclusive++) {
      const actual = await collectBytes(fs.readStream("/input", { start, endExclusive, chunkSize: 1 }), { maxBytes: 6 });
      assert.deepEqual(actual, bytes("abcdef").slice(start, endExclusive), `${start}:${endExclusive}`);
    }
  }
});
