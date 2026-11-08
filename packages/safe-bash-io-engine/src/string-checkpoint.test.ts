import assert from "node:assert/strict";
import test from "node:test";
import { stringCheckpoint } from "./shell/string-operations.js";

test("the initial string checkpoint admits queued cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("queued cancellation");
  const pending = setImmediate(() => controller.abort(reason));
  try {
    const checkpoint = stringCheckpoint({ signal: controller.signal, remaining: Infinity, exhausted() { throw new Error("exhausted"); } });
    assert.ok(checkpoint instanceof Promise);
    await assert.rejects(checkpoint, error => error === reason);
  } finally { clearImmediate(pending); }
});
