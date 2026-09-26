import assert from "node:assert/strict";
import test from "node:test";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";
import { captureContext, ManualScheduler } from "./timeout-author-20260828/fixtures.js";

test("cooperative timeout preserves status when the child settles after the first signal", async () => {
  for (const preserveStatus of [false, true]) {
    const scheduler = new ManualScheduler();
    const capture = captureContext([
      ...(preserveStatus ? ["--preserve-status"] : []), "1", "child",
    ], {
      invoke: async (_command, _args, options) => {
        scheduler.fire(1000);
        assert.equal(options!.signal!.aborted, true);
        return { exitCode: 143 };
      },
    });
    const result = await createTimeoutCommand({ scheduler }).execute(capture.context);
    assert.equal(result.exitCode, preserveStatus ? 143 : 124);
    assert.equal(capture.stderr(), "");
    assert.equal(scheduler.pending, false);
  }
});
