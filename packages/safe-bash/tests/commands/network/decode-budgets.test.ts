import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync, deflateSync } from "node:zlib";
import { run } from "./helpers.js";

async function compressed(encoding: string, body: Uint8Array, maxBytes = 1024) {
  let disposed = false;
  const result = await run(["--compressed", "http://127.0.0.1/"], { options: {
    limits: { maxDownloadBytes: maxBytes },
    transport: async () => ({ status: 200, statusText: "OK", headers: [["Content-Encoding", encoding]],
      body: (async function* () { yield body; })(), async dispose() { disposed = true; } }),
  } });
  assert.equal(disposed, true);
  return result;
}

test("curl rejects header-sized encoding chains before allocating any decoder", async t => {
  let allocations = 0;
  t.mock.method(globalThis, "DecompressionStream", function () {
    allocations++;
    throw new Error("Decoder must not be allocated");
  });
  for (const encoding of [Array(8000).fill("gzip").join(","), "gzip,gzip,gzip,gzip,gzip", "gzip,br", "gzip,"]) {
    const result = await compressed(encoding, Uint8Array.of(1, 2, 3));
    assert.equal(allocations, 0);
    assert.equal(result.exitCode, 61, result.stderr.toString());
    assert.equal(result.stdout.length, 0);
  }
});

test("curl budgets intermediate decoded bytes before invalid inner data reaches the next decoder", async () => {
  const body = gzipSync(Buffer.alloc(32768, 1));
  assert.ok(body.length < 1024);
  const result = await compressed("gzip,gzip", body);
  assert.equal(result.exitCode, 63, result.stderr.toString());
  assert.equal(result.stdout.length, 0);
});

test("curl supports bounded layered encodings in reverse order", async () => {
  const result = await compressed("gzip, deflate", deflateSync(gzipSync(Buffer.from("hello"))));
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "hello");
});

test("curl budgets final decoded bytes and preserves invalid-body failures", async () => {
  assert.equal((await compressed("gzip", gzipSync(Buffer.alloc(32768)))).exitCode, 63);
  assert.equal((await compressed("gzip", Uint8Array.of(1, 2, 3))).exitCode, 61);
});

test("decoder byte-budget failure cancels the encoded producer", async () => {
  const { decodeContent } = await import("../../../src/commands/network/decode.js");
  let cancelled = false;
  let reads = 0;
  const source = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          await new Promise<void>(resolve => setImmediate(resolve));
          reads++;
          return { done: false as const, value: gzipSync(Buffer.alloc(32768)) };
        },
        async return() { cancelled = true; return { done: true as const, value: undefined }; },
      };
    },
  };
  await assert.rejects(async () => {
    for await (const ignoredChunk of decodeContent(source, "gzip", new AbortController().signal, 1024)) {
      assert.fail("Over-budget data must not be emitted");
    }
  }, (error: unknown) => error instanceof Error && "exitCode" in error && error.exitCode === 63);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.ok(reads <= 4, `Read ${reads} chunks after budget failure`);
});

test("decoder budget failure awaits encoded producer cancellation", async () => {
  const { decodeContent } = await import("../../../src/commands/network/decode.js");
  let release!: () => void;
  const cleanup = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const closing = new Promise<void>(resolve => { started = resolve; });
  let settled = false;
  const source = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          await new Promise<void>(resolve => setImmediate(resolve));
          return { done: false as const, value: gzipSync(Buffer.alloc(32768)) };
        },
        async return() { started(); await cleanup; return { done: true as const, value: undefined }; },
      };
    },
  };
  const operation = (async () => {
    for await (const ignoredChunk of decodeContent(source, "gzip", new AbortController().signal, 1024)) {
      assert.fail("Over-budget data must not be emitted");
    }
  })();
  const outcome = operation.catch(error => error).finally(() => { settled = true; });
  try {
    await closing;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false, "decoder must await the producer's cancellation acknowledgement");
  } finally { release(); }
  const error: unknown = await outcome;
  assert.ok(error instanceof Error && "exitCode" in error && error.exitCode === 63);
});
