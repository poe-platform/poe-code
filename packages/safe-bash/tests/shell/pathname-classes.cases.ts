import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesPattern } from "../../src/shell/pattern.js";

test("unmatched bracket tokenization yields to cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("tokenization stopped");
  const pattern = "[".repeat(8192);
  const budget = 1048576;
  const work = { remaining: budget, signal: controller.signal, exhausted() { throw new Error("budget"); } };
  let remainingAtCancellation = budget;
  const immediate = setImmediate(() => {
    remainingAtCancellation = work.remaining;
    controller.abort(reason);
  });
  try {
    await assert.rejects(matchesPattern(pattern, "x", work), (error) => error === reason);
    assert.ok(remainingAtCancellation < budget, "tokenization must start before cancellation");
    assert.ok(remainingAtCancellation > budget - pattern.length, "cancellation must interrupt tokenization, not only matching");
    assert.equal(work.remaining, remainingAtCancellation, "tokenization must stop consuming work after cancellation");
  } finally { clearImmediate(immediate); }
});

test("pattern compilation consumes finite work before matching empty subjects", async () => {
  await assert.rejects(matchesPattern("[".repeat(1000), "", { remaining: 100, signal: new AbortController().signal, exhausted() { throw new Error("compile budget"); } }), /compile budget/u);
});
