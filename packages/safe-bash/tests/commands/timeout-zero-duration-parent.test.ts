import assert from "node:assert/strict";
import test from "node:test";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";
import { captureContext } from "./timeout-author-20260828/fixtures.js";

for (const alreadyAborted of [false, true]) {
  test(`zero duration forwards parent cancellation (already aborted: ${alreadyAborted})`, async () => {
    const parent = new AbortController();
    const reason = new Error("parent cancelled");
    let invoked = false;
    if (alreadyAborted) parent.abort(reason);
    const capture = captureContext(["-k0.03", "0", "child"], {
      signal: parent.signal,
      invoke: async (_command, _args, options) => {
        invoked = true;
        parent.abort(reason);
        assert.equal(options!.signal, parent.signal);
        options!.signal!.throwIfAborted();
        return { exitCode: 0 };
      },
    });
    await assert.rejects(async () => createTimeoutCommand({
      killAfterPolicy: async () => assert.fail("zero duration must bypass escalation"),
    }).execute(capture.context), error => error === reason);
    assert.equal(invoked, !alreadyAborted);
  });
}

test("zero duration checks parent cancellation after child settlement", async () => {
  const parent = new AbortController();
  const reason = new Error("parent cancelled");
  const capture = captureContext(["--kill-after=0.03", "0", "child"], {
    signal: parent.signal,
    invoke: async () => {
      parent.abort(reason);
      return { exitCode: 0 };
    },
  });
  await assert.rejects(async () => createTimeoutCommand().execute(capture.context), error => error === reason);
});
