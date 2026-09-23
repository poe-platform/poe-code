import assert from "node:assert/strict";
import test from "node:test";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";
import { captureContext, ManualScheduler } from "./timeout-author-20260828/fixtures.js";

test("zero kill-after disables host escalation while retaining the initial deadline", async () => {
  for (const preserveStatus of [false, true]) {
    const scheduler = new ManualScheduler();
    const capture = captureContext([
      ...(preserveStatus ? ["--preserve-status"] : []), "-k0", "1", "child",
    ], {
      invoke: async (_command, _args, options) => {
        scheduler.fire(1000);
        throw options!.signal!.reason;
      },
    });
    const result = await createTimeoutCommand({
      scheduler,
      killAfterPolicy: async () => assert.fail("disabled escalation policy invoked"),
    }).execute(capture.context);
    assert.equal(result.exitCode, preserveStatus ? 143 : 124);
    assert.equal(capture.stderr(), "");
    assert.equal(scheduler.pending, false);
  }
});
