import assert from "node:assert/strict";
import { test } from "node:test";

test("portable regex executor imports without creating request-owned aborted signals", async context => {
  context.mock.method(AbortSignal, "abort", () => {
    throw new Error("AbortSignal.abort is unavailable outside a Worker request");
  });
  const portable = await import("./execution/portable.js");
  assert.equal(typeof portable.RegexExecutor, "function");
});
