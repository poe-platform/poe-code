import assert from "node:assert/strict";
import test from "node:test";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";
import { captureContext, ManualScheduler } from "./timeout-author-20260828/fixtures.js";

test("kill-after retains timeout status after cooperative cancellation rejection and cleanup", async () => {
  for (const preserveStatus of [false, true]) {
    const scheduler = new ManualScheduler();
    let cleaned = false;
    const capture = captureContext([
      ...(preserveStatus ? ["--preserve-status"] : []), "-k0.03", "1", "child",
    ], {
      invoke: async (_command, _args, options) => {
        try {
          scheduler.fire(1000);
          options!.signal!.throwIfAborted();
          assert.fail("deadline did not cancel child");
        } finally { cleaned = true; }
      },
    });
    const result = await createTimeoutCommand({ scheduler }).execute(capture.context);
    assert.equal(result.exitCode, preserveStatus ? 143 : 124);
    assert.equal(cleaned, true);
    assert.equal(capture.stderr(), "");
    assert.equal(scheduler.pending, false);
  }
});
