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
    }).execute(capture.context);
    assert.equal(result.exitCode, preserveStatus ? 143 : 124);
    assert.equal(capture.stderr(), "");
    assert.equal(scheduler.pending, false);
  }
});

for (const grace of [[], ["-k0"], ["-k", "inf"]]) {
  test(`signal policies receive disabled escalation for ${JSON.stringify(grace)}`, async () => {
    const capture = captureContext([...grace, "1", "child"], {
      invoke: async () => assert.fail("signal policy bypassed"),
    });
    const result = await createTimeoutCommand({
      killAfterPolicy: async (_context, _command, _args, _options, policy) => {
        assert.equal(policy.killAfterMilliseconds, Infinity);
        assert.equal(policy.durationMilliseconds, 1000);
        return { exitCode: 7 };
      },
    }).execute(capture.context);
    assert.equal(result.exitCode, 7);
  });
}
