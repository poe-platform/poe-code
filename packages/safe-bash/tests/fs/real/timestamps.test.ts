import assert from "node:assert/strict";
import native from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { bytes, fixture } from "./helpers.js";

test("utimes forwards exact historical millisecond Dates to the native host", async (context) => {
  const { filesystem, root } = await fixture(context);
  await filesystem.writeFile("file", bytes("data"));
  const original = native.utimes;
  const calls: Parameters<typeof native.utimes>[] = [];
  const spy = context.mock.method(native, "utimes", async (...args: Parameters<typeof native.utimes>) => {
    calls.push(args);
    return original(...args);
  });
  syncBuiltinESMExports();
  try {
    for (const [atimeMs, mtimeMs] of [[10000, 20000], [1_600_000_000_125, 1_650_000_000_250]] as const) {
      const previousCalls = calls.length;
      await filesystem.utimes("file", atimeMs, mtimeMs);
      assert.equal(calls.length, previousCalls + 1);
      const [path, atime, mtime] = calls[previousCalls]!;
      assert.equal(path, join(root, "file"));
      assert.ok(atime instanceof Date);
      assert.ok(mtime instanceof Date);
      assert.equal(atime.getTime(), atimeMs);
      assert.equal(mtime.getTime(), mtimeMs);
      const stat = await native.stat(join(root, "file"));
      assert.equal(stat.mtimeMs, mtimeMs);
      context.diagnostic(`HISTORICAL ATIME OBSERVATION: requested=${atimeMs} observed=${stat.atimeMs}; forwarding is asserted, host atime persistence is not`);
    }
    assert.equal(spy.mock.callCount(), 2);
  } finally {
    spy.mock.restore();
    syncBuiltinESMExports();
  }
});
