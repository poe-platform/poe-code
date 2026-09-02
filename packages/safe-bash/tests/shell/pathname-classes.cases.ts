import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesPattern } from "../../src/shell/pattern.js";

test("unmatched bracket tokenization yields to cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("tokenization stopped");
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(matchesPattern("[".repeat(8192), "x", { remaining: 1048576, signal: controller.signal, exhausted() { throw new Error("budget"); } }), (error) => error === reason);
  } finally { clearTimeout(timer); }
});

test("pattern compilation consumes finite work before matching empty subjects", async () => {
  await assert.rejects(matchesPattern("[".repeat(1000), "", { remaining: 100, signal: new AbortController().signal, exhausted() { throw new Error("compile budget"); } }), /compile budget/u);
});
