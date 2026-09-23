import assert from "node:assert/strict";
import test from "node:test";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";
import { captureContext, ManualScheduler } from "./timeout-author-20260828/fixtures.js";

test("kill-after reports deadline failure when a cancelled child settles normally", async () => {
  const scheduler = new ManualScheduler();
  const capture = captureContext(["-k0.03", "1", "child"], {
    invoke: async (_command, _args, options) => {
      scheduler.nowValue = Number.NaN;
      scheduler.fire(1000);
      assert.equal(options!.signal!.aborted, true);
      return { exitCode: 0 };
    },
  });
  const result = await createTimeoutCommand({ scheduler }).execute(capture.context);
  assert.equal(result.exitCode, 125);
  assert.equal(capture.stderr(), "timeout: timer setup failed\n");
  assert.equal(scheduler.pending, false);
});
