import assert from "node:assert/strict";
import { test } from "node:test";

test("portable regex imports without request-scoped signal operations", async () => {
  const abort = AbortSignal.abort;
  let module: typeof import("./execution/portable.js");
  try {
    AbortSignal.abort = () => { throw new Error("AbortSignal.abort is unavailable during Worker startup"); };
    module = await import("./execution/portable.js");
  } finally {
    AbortSignal.abort = abort;
  }
  const { createBoundedRegexProvider } = await import("./execution/bounded-provider.js");
  const executor = new module.RegexExecutor(createBoundedRegexProvider());
  try {
    const session = executor.open(new AbortController().signal);
    session.closeSync();
    assert.equal(session.signal.aborted, true);
    assert.equal(session.signal.reason.code, "CLOSED");
    const signal = session.signal;
    const reason = session.signal.reason;
    const reused = executor.open(new AbortController().signal);
    reused.closeSync();
    assert.equal(reused.signal.reason, reason);
    assert.notEqual(reused.signal, signal);
  } finally {
    await executor.dispose();
  }
});
