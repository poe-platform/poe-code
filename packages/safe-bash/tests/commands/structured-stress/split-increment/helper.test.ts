import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget, JqError, JqLimitError, resolveJqLimits, type JqLimits } from "../../../../src/commands/structured/limits.js";
import { splitString } from "../../../../src/commands/structured/split.js";
import { evidence } from "./evidence.js";

const options = { timeout: 3000 };
const budgetFor = (limits: Partial<JqLimits> = {}, signal = AbortSignal.timeout(2000)): Budget => new Budget(resolveJqLimits(limits), signal);
const limit = (name: keyof JqLimits) => (error: unknown): boolean => error instanceof JqLimitError && error.message === `${name} limit exceeded`;

for (const fixture of evidence.cases.filter(row => row.direct)) {
  test(`split helper native exact bytes: ${fixture.id}`, options, async () => {
    const { input, separator } = fixture.direct!;
    if (fixture.status === 0) {
      const result = await splitString(input, separator, budgetFor());
      assert.equal(`${JSON.stringify(result)}\n`, fixture.stdout);
      assert.equal(fixture.stderr, "");
    } else {
      await assert.rejects(splitString(input, separator, budgetFor()), (error: unknown) => {
        assert.ok(error instanceof JqError);
        assert.equal(error.exitCode, fixture.status);
        assert.equal(`jq: error (at <stdin>:1): ${error.message}\n`, fixture.stderr);
        return true;
      });
      assert.equal(fixture.stdout, "");
    }
  });
}

test("split collection boundary includes trailing empty fields", options, async () => {
  assert.deepEqual(await splitString("a,b,", ",", budgetFor({ maxCollectionSize: 3 })), ["a", "b", ""]);
  await assert.rejects(splitString("a,b,", ",", budgetFor({ maxCollectionSize: 2 })), limit("maxCollectionSize"));
});

test("split empty separator counts Unicode code points, not UTF-16 units", options, async () => {
  assert.deepEqual(await splitString("😀中", "", budgetFor({ maxCollectionSize: 2 })), ["😀", "中"]);
  await assert.rejects(splitString("😀中", "", budgetFor({ maxCollectionSize: 1 })), limit("maxCollectionSize"));
});

test("split aggregate value budget includes brackets, commas and quoted empties", options, async () => {
  assert.deepEqual(await splitString(",", ",", budgetFor({ maxValueBytes: 7 })), ["", ""]);
  await assert.rejects(splitString(",", ",", budgetFor({ maxValueBytes: 6 })), limit("maxValueBytes"));
});

test("split value accounting uses escaped control bytes", options, async () => {
  assert.deepEqual(await splitString("\0,", ",", budgetFor({ maxValueBytes: 13 })), ["\0", ""]);
  await assert.rejects(splitString("\0,", ",", budgetFor({ maxValueBytes: 12 })), limit("maxValueBytes"));
});

test("split value accounting uses multibyte UTF-8 bytes", options, async () => {
  assert.deepEqual(await splitString("😀中", "", budgetFor({ maxValueBytes: 14 })), ["😀", "中"]);
  await assert.rejects(splitString("😀中", "", budgetFor({ maxValueBytes: 13 })), limit("maxValueBytes"));
});

test("split empty result still accounts for its array bytes", options, async () => {
  assert.deepEqual(await splitString("", "", budgetFor({ maxValueBytes: 2 })), []);
});

test("split validates input and separator value bounds before scanning", options, async () => {
  await assert.rejects(splitString("abcd", ",", budgetFor({ maxValueBytes: 5 })), limit("maxValueBytes"));
  await assert.rejects(splitString("", "abcd", budgetFor({ maxValueBytes: 5 })), limit("maxValueBytes"));
});

test("split output budgets remain with the command writer, not intermediate values", options, async () => {
  const budget = budgetFor({ maxOutputBytes: 1, maxResults: 1 });
  assert.deepEqual(await splitString("a,b", ",", budget), ["a", "b"]);
  assert.equal(budget.outputBytes, 0);
  assert.equal(budget.results, 0);
});

test("split step budget bounds long no-match scans", options, async () => {
  await assert.rejects(splitString("a".repeat(10000), "b", budgetFor({ maxSteps: 200 })), limit("maxSteps"));
});

test("split step budget bounds separator preprocessing", options, async () => {
  await assert.rejects(splitString("a".repeat(20000), "a".repeat(10000) + "b", budgetFor({ maxSteps: 200 })), limit("maxSteps"));
});

test("split linear matching handles adversarial repeated prefixes", options, async () => {
  const input = `${"a".repeat(20000)}bTAIL`;
  const separator = `${"a".repeat(10000)}b`;
  assert.deepEqual(await splitString(input, separator, budgetFor({ maxSteps: 90000 })), ["a".repeat(10000), "TAIL"]);
});

test("split pre-abort preserves caller reason before type errors", options, async () => {
  const controller = new AbortController();
  const reason = new Error("split pre-abort");
  controller.abort(reason);
  await assert.rejects(splitString(null, 1, budgetFor({}, controller.signal)), error => error === reason);
});

for (const [name, input, separator] of [
  ["no-match scan", "a".repeat(200000), "b"],
  ["separator preprocessing", "a".repeat(200000), "a".repeat(100000) + "b"],
  ["empty-separator expansion", "😀".repeat(90000), ""],
] as const) test(`split cancellation yields during ${name}`, options, async () => {
  const controller = new AbortController();
  const reason = new Error(`abort ${name}`);
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(splitString(input, separator, budgetFor({}, controller.signal)), error =>
      error === reason || (error instanceof Error && error.name === "AbortError" && error.cause === reason));
  } finally { clearTimeout(timer); }
});

test("split collection limit rejects expansion before an oversized result", options, async () => {
  await assert.rejects(splitString(",".repeat(100000), ",", budgetFor({ maxCollectionSize: 5, maxSteps: 1000 })), limit("maxCollectionSize"));
});
