import assert from "node:assert/strict";
import test from "node:test";
import { outputFailure, type ByteSink } from "./io.js";
import { createOutputOperation } from "./output.js";

for (const reason of [false, 0, undefined, new Error("source failed")]) {
  test(`output failure forwarding preserves its destination and reason: ${String(reason)}`, async () => {
    const seen: unknown[] = [];
    const destination: ByteSink = {
      async write() {},
      async [outputFailure](failure) {
        assert.equal(this, destination);
        seen.push(failure);
        throw failure;
      },
    };
    const operation = createOutputOperation({ signal: new AbortController().signal }, destination);
    try {
      await assert.rejects(operation.output[outputFailure]!(reason), failure => Object.is(failure, reason));
      assert.deepEqual(seen, [reason]);
    } finally { await operation.close(); }
  });
}
