import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesPattern } from "../../src/shell/pattern.js";

test("queued pattern cancellation precedes allocation and tokenization", async context => {
  const controller = new AbortController();
  const reason = new Error("allocation stopped");
  const pattern = "[".repeat(128);
  const budget = 1048576;
  let allocations = 0;
  let materializations = 0;
  const work = {
    remaining: budget, signal: controller.signal, exhausted() { throw new Error("budget"); },
    allocation: { assertOpen() {}, reserve(): never { allocations++; throw new Error("allocation before queued cancellation"); } },
  };
  const from = Array.from;
  context.mock.method(Array, "from", function(input: Iterable<unknown>, ...rest: unknown[]) {
    if (input === pattern) materializations++;
    return Reflect.apply(from, Array, [input, ...rest]);
  });
  let remainingAtCancellation = budget;
  const immediate = setImmediate(() => {
    remainingAtCancellation = work.remaining;
    controller.abort(reason);
  });
  try {
    await assert.rejects(matchesPattern(pattern, "x", work), error => error === reason);
    assert.equal(remainingAtCancellation, budget - pattern.length, "only preallocation work is charged");
    assert.equal(allocations, 0, "queued cancellation precedes scratch admission");
    assert.equal(materializations, 0, "queued cancellation precedes Array.from");
    assert.equal(work.remaining, remainingAtCancellation, "no work is charged after cancellation");
  } finally { clearImmediate(immediate); }
});

test("unmatched bracket tokenization yields to cancellation", async context => {
  const controller = new AbortController();
  const reason = new Error("tokenization stopped");
  const pattern = "[".repeat(1025);
  const budget = 1048576;
  const work = { remaining: budget, signal: controller.signal, exhausted() { throw new Error("budget"); } };
  let materializations = 0;
  let remainingAfterAllocation = budget;
  let remainingAtCancellation = budget;
  let immediate: ReturnType<typeof setImmediate> | undefined;
  const from = Array.from;
  context.mock.method(Array, "from", function(input: Iterable<unknown>, ...rest: unknown[]) {
    const result = Reflect.apply(from, Array, [input, ...rest]);
    if (input === pattern) {
      assert.equal(++materializations, 1);
      remainingAfterAllocation = work.remaining;
      immediate = setImmediate(() => {
        remainingAtCancellation = work.remaining;
        controller.abort(reason);
      });
    }
    return result;
  });
  try {
    await assert.rejects(matchesPattern(pattern, "x", work), (error) => error === reason);
    assert.equal(materializations, 1, "cancellation is scheduled only after pattern materialization");
    assert.equal(remainingAfterAllocation, budget - pattern.length, "preallocation charge is separate from tokenization");
    assert.ok(remainingAtCancellation < remainingAfterAllocation, "tokenization must start before cancellation");
    assert.equal(remainingAtCancellation, remainingAfterAllocation - 1024, "tokenization yields at its first checkpoint");
    assert.ok(remainingAtCancellation > remainingAfterAllocation - pattern.length, "cancellation must interrupt tokenization, not only matching");
    assert.equal(work.remaining, remainingAtCancellation, "tokenization must stop consuming work after cancellation");
  } finally { if (immediate) clearImmediate(immediate); }
});

test("pattern compilation consumes finite work before matching empty subjects", async () => {
  await assert.rejects(matchesPattern("[".repeat(1000), "", { remaining: 100, signal: new AbortController().signal, exhausted() { throw new Error("compile budget"); } }), /compile budget/u);
});
