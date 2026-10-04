import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type FileSystem } from "safe-bash-contracts";
import { Budget } from "./shared.js";
import { IndexedDocument, closeDocumentResources } from "./document.js";

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
