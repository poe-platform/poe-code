import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { expandBraces } from "../../src/shell/brace-expansion.js";
import type { Word } from "../../src/shell/parser.js";
import { Budget, defaultLimits } from "../../src/shell/runtime.js";
import { ShellLimitError, type ShellLimits } from "../../src/shell/types.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";

function budgetFor(context: TestContext, limits: ShellLimits = {}): Budget {
  const budget = new Budget({ ...defaultLimits, maxExpansionBytes: 262144, maxParseUnits: 8192, ...limits });
  context.after(() => { budget.close(); budget.values.close(); });
  return budget;
}

function wordFor(value: string): Word {
  return { offset: 0, parts: [{ kind: "text", value, quoted: false }] };
}

for (const repetitions of [8, 32, 128]) {
  test(`literal brace admission retains constant bookkeeping for ${repetitions} groups`, async context => {
    const budget = budgetFor(context);
    const allocated = context.mock.method(budget.values, "allocate");
    const released = context.mock.method(budget.values, "release");
    const parsing = context.mock.method(budget.parsing, "admit");
    const word = wordFor("{a}".repeat(repetitions));
    const iterator = expandBraces(word, budget, budget.signal);
    try {
      const first = await iterator.next();
      assert.equal(first.done, false);
      assert.equal(first.value, word);
      assert.deepEqual(budget.values.usage, { bytes: 128 + repetitions * 360, slots: 1 });
      assert.equal(parsing.mock.callCount(), repetitions * 10 + 2);
      assert.equal(allocated.mock.callCount(), 2);
      assert.equal(released.mock.callCount(), 0);
    } finally { await iterator.return(undefined); }
    assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
    assert.equal(released.mock.callCount(), 2);
  });
}

for (const value of ["{".repeat(32) + "a" + "}".repeat(32), "{a}".repeat(8) + "{x,y}"]) {
  test(`nested and materialized braces retain bounded records: ${value.length} bytes`, async context => {
    const budget = budgetFor(context);
    const allocated = context.mock.method(budget.values, "allocate");
    const iterator = expandBraces(wordFor(value), budget, budget.signal);
    try {
      const first = await iterator.next();
      assert.equal(first.done, false);
      assert.ok(allocated.mock.callCount() <= 4);
      const expected = value.endsWith("{x,y}") ? "{a}".repeat(8) + "x" : value;
      assert.equal(first.value?.parts.map(part => part.kind === "text" ? part.value : "").join(""), expected);
    } finally { await iterator.return(undefined); }
    assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
  });
}

for (const [limits, expected] of [
  [{ maxExpansionBytes: 3007 }, "maxExpansionBytes"],
  [{ maxParseUnits: 81 }, "maxParseUnits"],
] as const) {
  test(`brace reservation preserves the exact ${expected} boundary`, async context => {
    const budget = budgetFor(context, limits);
    const iterator = expandBraces(wordFor("{a}".repeat(8)), budget, budget.signal);
    await assert.rejects(iterator.next(), error => error instanceof ShellLimitError && error.limit === expected);
    assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
  });
}

test("brace admission accepts its unchanged exact byte and parse budgets", async context => {
  const budget = budgetFor(context, { maxExpansionBytes: 3008, maxParseUnits: 82 });
  const word = wordFor("{a}".repeat(8));
  const values: Word[] = [];
  for await (const value of expandBraces(word, budget, budget.signal)) values.push(value);
  assert.deepEqual(values, [word]);
  assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
});

test("brace byte refusal precedes the rejected text slice", async context => {
  const budget = budgetFor(context, { maxExpansionBytes: 193 });
  const value = "{a}";
  const slice = String.prototype.slice;
  let slices = 0;
  context.mock.method(String.prototype, "slice", function (this: string, start?: number, end?: number) {
    if (this === value) slices++;
    return slice.call(this, start, end);
  });
  await assert.rejects(expandBraces(wordFor(value), budget, budget.signal).next(),
    error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  assert.equal(slices, 0);
  assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
});

test("brace cancellation releases cumulative reservations and preserves the reason", async context => {
  const budget = budgetFor(context);
  const reason = Object.freeze({ cancelled: "brace admission" });
  let yields = 0;
  registerYieldCheckpoint(budget.signal, () => { yields++; budget.controller.abort(reason); });
  await assert.rejects(expandBraces(wordFor("{a}".repeat(128)), budget, budget.signal).next(), error => error === reason);
  assert.equal(yields, 1);
  assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
});
