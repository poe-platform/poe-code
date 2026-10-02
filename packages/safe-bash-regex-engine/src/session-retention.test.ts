import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoundedRegexProvider } from "./execution/bounded-provider.js";
import { RegexExecutor } from "./execution/portable.js";

test("pooled sessions release invocation signals and reset for reuse", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  try {
    const controller = new AbortController();
    const session = executor.open(controller.signal);
    session.closeSync();
    assert.notEqual(session.signal, controller.signal);
    assert.notEqual(Reflect.get(session, "requestSignal"), controller.signal);
    const next = new AbortController();
    const reused = executor.open(next.signal);
    assert.equal(reused, session);
    assert.equal(reused.signal, next.signal);
    assert.equal(Reflect.get(reused, "requestSignal"), next.signal);
    reused.closeSync();
  } finally { await executor.dispose(); }
});
