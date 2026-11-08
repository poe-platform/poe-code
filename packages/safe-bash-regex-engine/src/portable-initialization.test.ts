import assert from "node:assert/strict";
import test from "node:test";

test("loads the portable executor without creating request-scoped abort signals", async t => {
  const abort = t.mock.method(AbortSignal, "abort", () => {
    throw new Error("AbortSignal.abort requires a Worker request");
  });
  const module = await import("./execution/portable.js");
  assert.equal(typeof module.RegexExecutor, "function");
  assert.equal(abort.mock.callCount(), 0);
});
