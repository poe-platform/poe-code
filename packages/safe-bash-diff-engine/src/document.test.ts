import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type FileSystem } from "safe-bash-contracts";
import { Budget } from "./shared.js";
import { IndexedDocument, closeDocumentResources } from "./document.js";

test("repeated short-line comparisons reuse bounded bytes without skipping work charges", async t => {
  const controller = new AbortController();
  const budget = new Budget({ command: "diff", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: controller.signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
  }, { maxWork: 100_000 });
  const left = new IndexedDocument(budget), right = new IndexedDocument(budget);
  try {
    const text = "same\n".repeat(513) + "x".repeat(128) + "\n";
    await left.load(toByteSource(text)); await right.load(toByteSource(text));
    const leftRead = t.mock.method(left.data, "read"), rightRead = t.mock.method(right.data, "read");
    const before = budget.remainingWork;
    assert.equal(await left.equal(0, right, 0), true);
    const after = budget.remainingWork;
    assert.equal(await left.equal(0, right, 0), true);
    assert.equal(before - after, after - budget.remainingWork);
    assert.equal(leftRead.mock.callCount(), 1);
    assert.equal(rightRead.mock.callCount(), 1);
    for (let position = 1; position < 513; position++) assert.equal(await left.equal(position, right, position), true);
    const reads = leftRead.mock.callCount();
    assert.equal(await left.equal(0, right, 0), true);
    assert.equal(leftRead.mock.callCount(), reads + 1, "evicted lines must be loaded again");
    const longReads = leftRead.mock.callCount();
    assert.equal(await left.equal(513, right, 513), true);
    assert.equal(await left.equal(513, right, 513), true);
    assert.equal(leftRead.mock.callCount(), longReads + 2, "long lines must not grow the cache");
    const reason = new Error("cancel cached comparison");
    controller.abort(reason);
    await assert.rejects(left.equal(0, right, 0), error => error === reason);
  } finally { await closeDocumentResources([left, right]); }
});

test("cached short lines still compare exact bytes when line hashes collide", async t => {
  const budget = new Budget({ command: "diff", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
  }, {});
  const document = new IndexedDocument(budget);
  try {
    await document.load(toByteSource("alpha\nbravo\n"));
    const line = document.line.bind(document);
    t.mock.method(document, "line", async (position: number) => ({ ...await line(position), hash: 7 }));
    assert.equal(await document.equal(0, document, 1), false);
    assert.equal(await document.equal(0, document, 1), false);
    assert.equal(await document.equal(0, document, 0), true);
    assert.equal(await document.equal(1, document, 1), true);
  } finally { await document.close(); }
});

for (const longLine of [false, true]) test(`document spills bytes and line indexes through caller storage: longLine=${longLine}`, async () => {
  const fs = createMemoryFileSystem();
  let opened = 0, closed = 0, written = 0, inFlight = 0, peak = 0;
  const view = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => assert.fail("whole payload IO");
    if (key === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      opened++;
      const descriptor = await target.open!(...args);
      return new Proxy(descriptor, { get(handle, method) {
        if (method === "write") return async (...params: Parameters<typeof descriptor.write>) => {
          assert.ok(params[0].byteLength <= 16384);
          inFlight += params[0].byteLength; peak = Math.max(peak, inFlight);
          try { const count = await handle.write(...params); written += count; return count; }
          finally { inFlight -= params[0].byteLength; }
        };
        if (method === "close") return async (...params: Parameters<typeof descriptor.close>) => { closed++; return handle.close(...params); };
        const value = Reflect.get(handle, method, handle);
        return typeof value === "function" ? value.bind(handle) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const budget = new Budget({ command: "diff", args: [], cwd: "/", env: {}, fs: view,
    signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
  }, {});
  const document = new IndexedDocument(budget, 1);
  const chunk = new Uint8Array(16384);
  try {
    await document.load((async function* () {
      for (let i = 0; i < 4; i++) { chunk.fill(longLine ? 65 : 10); yield chunk; }
      chunk.fill(255); // Retained source views must not change staged bytes.
    })());
    assert.equal(document.size, 65536);
    assert.equal(document.length, longLine ? 1 : 65536);
    const first = await document.line(0), last = await document.line(document.length - 1);
    assert.equal(first.start, 0);
    assert.equal(last.end, 65536);
    let total = 0;
    for await (const bytes of document.range(0, document.size)) {
      assert.ok(bytes.byteLength <= 16384);
      assert.ok(bytes.every(byte => byte === (longLine ? 65 : 10)));
      total += bytes.byteLength;
    }
    assert.equal(total, 65536);
    assert.ok(opened >= (longLine ? 1 : 2));
    assert.ok(written > 16384, "spilled data must reach caller storage, not another RAM cache");
    assert.equal(peak, 16384);
  } finally { await document.close(); }
  assert.equal(closed, opened);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("cleanup drains other resources before exposing a close failure", async () => {
  const failure = new Error("close failure");
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let finished = false;
  const closing = closeDocumentResources([
    { async close() { throw failure; } },
    { async close() { await delayed; finished = true; } },
  ]);
  await Promise.resolve();
  assert.equal(finished, false);
  release();
  await assert.rejects(closing, error => error instanceof AggregateError && error.errors[0] === failure);
  assert.equal(finished, true);
});
