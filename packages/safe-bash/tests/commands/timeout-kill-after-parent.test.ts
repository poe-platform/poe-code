import assert from "node:assert/strict";
import test from "node:test";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";
import { captureContext, ManualScheduler } from "./timeout-author-20260828/fixtures.js";

for (const signalOption of [[], ["-s0"]]) {
  test(`cooperative timeout forwards parent cancellation with signal ${signalOption.length ? "0" : "TERM"}`, async () => {
    const parent = new AbortController();
    const reason = new Error("parent cancelled");
    const scheduler = new ManualScheduler();
    let childSignal: AbortSignal | undefined;
    const capture = captureContext([...signalOption, "2", "child"], {
      signal: parent.signal,
      invoke: async (_command, _args, options) => {
        parent.abort(reason);
        childSignal = options!.signal;
        options!.signal!.throwIfAborted();
        return { exitCode: 0 };
      },
    });
    await assert.rejects(async () => createTimeoutCommand({ scheduler }).execute(capture.context), error => error === reason);
    assert.equal(childSignal!.aborted, true);
    assert.equal(childSignal!.reason, reason);
    assert.equal(scheduler.pending, false);
  });
}
