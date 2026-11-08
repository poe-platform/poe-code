import assert from "node:assert/strict";
import test from "node:test";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";
import { captureContext } from "./timeout-author-20260828/fixtures.js";

test("infinite timeout bypasses scheduler and escalation while forwarding parent cancellation", async () => {
  const parent = new AbortController();
  const reason = new Error("parent cancelled");
  const capture = captureContext(["-k1", "inf", "child"], {
    signal: parent.signal,
    invoke: async (_command, _args, options) => {
      assert.equal(options!.signal, parent.signal);
      parent.abort(reason);
      return { exitCode: 11 };
    },
  });
  await assert.rejects(async () => createTimeoutCommand({
    scheduler: {
      now: () => assert.fail("infinity must not sample the clock"),
      setTimeout: () => assert.fail("infinity must not arm a timer"),
      clearTimeout: () => assert.fail("infinity must not clear a timer"),
    },
    killAfterPolicy: async () => assert.fail("infinity must bypass escalation"),
  }).execute(capture.context), error => error === reason);
});

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

test("zero duration child rejection preserves parent cancellation precedence", async () => {
  for (const cancelled of [true, false]) {
    const parent = new AbortController();
    const parentFailure = new Error("parent cancelled");
    const childFailure = new Error("child cleanup failed");
    const capture = captureContext(["-k0.03", "0", "child"], {
      signal: parent.signal,
      invoke: async () => {
        if (cancelled) parent.abort(parentFailure);
        throw childFailure;
      },
    });
    await assert.rejects(async () => createTimeoutCommand().execute(capture.context),
      error => error === (cancelled ? parentFailure : childFailure));
  }
});
