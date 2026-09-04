import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget, JqLimitError, resolveJqLimits, type Json } from "../../../src/commands/structured/limits.js";
import { binary } from "../../../src/commands/structured/values.js";
import { Interpreter } from "../../../src/commands/structured/interpreter.js";
import { parse } from "../../../src/commands/structured/parser.js";
import { splitString } from "../../../src/commands/structured/split.js";
import { registerYieldCheckpoint } from "../../../src/contracts/yield.js";
import { run } from "./helpers.js";

test("split fit proof covers JSON escapes and Unicode with one structural step per operand", async context => {
  for (const input of ["", "A", "\u0000", "\u001f", "\b\t\n\f\r", "\"\\", "é", "中", "\u2028\u2029", "\ud800", "\udfff", "😀", "\ud800A\udc00"]) {
    const separator = input + "!";
    const maxValueBytes = 6 * separator.length + 2;
    for (const operand of [input, separator]) assert.ok(Buffer.byteLength(JSON.stringify(operand)) <= 6 * operand.length + 2);
    const budget = new Budget(resolveJqLimits({ maxValueBytes }), new AbortController().signal);
    const validation = context.mock.method(budget, "value");
    const step = context.mock.method(budget, "step");
    const result = input === "" ? [] : [input];
    assert.deepEqual(await splitString(input, separator, budget), result);
    assert.deepEqual(validation.mock.calls.map(call => call.arguments[0]), input === "" ? [[]] : [input, result]);
    assert.deepEqual(step.mock.calls.map(call => call.arguments[0] ?? 1),
      input === "" ? [1, 1, 1, 1] : [1, 1, 1, 1, input.length, 1, 1, input.length]);
  }
});

test("split fit proof preserves empty-string maxValueBytes one and two boundaries", async context => {
  const signal = new AbortController().signal;
  const rejected = new Budget(resolveJqLimits({ maxValueBytes: 1 }), signal);
  const rejectedValidation = context.mock.method(rejected, "value");
  await assert.rejects(splitString("", "", rejected),
    error => error instanceof JqLimitError && error.message === "maxValueBytes limit exceeded");
  assert.deepEqual(rejectedValidation.mock.calls.map(call => call.arguments[0]), [""]);
  const admitted = new Budget(resolveJqLimits({ maxValueBytes: 2, maxSteps: 4 }), signal);
  const admittedValidation = context.mock.method(admitted, "value");
  assert.deepEqual(await splitString("", "", admitted), []);
  assert.deepEqual(admittedValidation.mock.calls.map(call => call.arguments[0]), [[]]);
  await assert.rejects(splitString("", "", new Budget(resolveJqLimits({ maxValueBytes: 2, maxSteps: 3 }), signal)),
    error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
});

test("split fit proof falls back to exact validation outside its conservative region", async context => {
  for (const fixture of [
    { input: "abc", separator: ",", maxValueBytes: 9, operands: ["abc"] },
    { input: "a", separator: "long", maxValueBytes: 10, operands: ["long"] },
    { input: "abc", separator: "zz", maxValueBytes: 9, operands: ["abc", "zz"] },
    { input: "\n", separator: "z", maxValueBytes: 6, operands: ["\n", "z"] },
    { input: "😀", separator: "z", maxValueBytes: 8, operands: ["😀"] },
    { input: "\ud800", separator: "z", maxValueBytes: 10, operands: [] },
  ]) {
    const budget = new Budget(resolveJqLimits({ maxValueBytes: fixture.maxValueBytes }), new AbortController().signal);
    const validation = context.mock.method(budget, "value");
    assert.deepEqual(await splitString(fixture.input, fixture.separator, budget), [fixture.input]);
    assert.deepEqual(validation.mock.calls.map(call => call.arguments[0]), [...fixture.operands, fixture.input, [fixture.input]]);
  }
  for (const [input, separator, maxValueBytes] of [["abcd", ",", 5], ["", "abcd", 5], ["\ud800", "z", 7], ["😀", "z", 5]] as const) {
    await assert.rejects(splitString(input, separator, new Budget(resolveJqLimits({ maxValueBytes }), new AbortController().signal)),
      error => error instanceof JqLimitError && error.message === "maxValueBytes limit exceeded");
  }
});

test("split fit proof fallback still admits full UTF-16 work before measurement", async context => {
  const budget = new Budget(resolveJqLimits({ maxValueBytes: 5, maxSteps: 4 }), new AbortController().signal);
  const text = context.mock.method(budget, "text");
  const step = context.mock.method(budget, "step");
  await assert.rejects(splitString("abcd", ",", budget),
    error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
  assert.deepEqual(step.mock.calls.map(call => call.arguments[0] ?? 1), [1, 1, 4]);
  assert.equal(text.mock.callCount(), 0);
});

test("split fit proof never bypasses fragment or final-array validation", async context => {
  for (const maxSteps of [9, 14]) {
    const budget = new Budget(resolveJqLimits({ maxSteps }), new AbortController().signal);
    const validation = context.mock.method(budget, "value");
    await assert.rejects(splitString("abc", ",", budget),
      error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
    assert.deepEqual(validation.mock.calls.map(call => call.arguments[0]), maxSteps === 9 ? ["abc"] : ["abc", ["abc"]]);
  }
});

for (const reason of [false, null]) {
  test(`split fit proof pre-abort preserves reason before operand checks: ${reason}`, async context => {
    const controller = new AbortController();
    controller.abort(reason);
    const budget = new Budget(resolveJqLimits(), controller.signal);
    const validation = context.mock.method(budget, "value");
    await assert.rejects(splitString("abc", ",", budget), error => error === reason);
    assert.equal(validation.mock.callCount(), 0);
  });

  test(`split fit proof still yields and preserves cancellation during scanning: ${reason}`, async context => {
    const controller = new AbortController();
    const budget = new Budget(resolveJqLimits(), controller.signal);
    const validation = context.mock.method(budget, "value");
    const step = context.mock.method(budget, "step");
    let checkpoints = 0;
    registerYieldCheckpoint(controller.signal, () => { checkpoints++; controller.abort(reason); });
    await assert.rejects(splitString("x".repeat(1025), ",", budget), error => error === reason);
    assert.equal(checkpoints, 1);
    assert.equal(step.mock.callCount(), 1024);
    assert.equal(validation.mock.callCount(), 0);
  });
}

test("string work charges scalar UTF-16 units plus the structural step", context => {
  for (const text of ["", "x", "é", "😀", "\n\"\\", "\ud800"]) {
    const bytes = Buffer.byteLength(JSON.stringify(text));
    const budget = new Budget(resolveJqLimits({ maxSteps: text.length + 1 }), new AbortController().signal);
    const step = context.mock.method(budget, "step");
    assert.equal(budget.value(text), bytes);
    assert.deepEqual(step.mock.calls.map(call => call.arguments[0] ?? 1), [1, text.length]);
  }
});

test("string work rejects scalar validation before text measurement or serialization", context => {
  const measure = context.mock.method(Buffer, "byteLength");
  const serialize = context.mock.method(JSON, "stringify");
  for (const maxSteps of [1, 40]) {
    const budget = new Budget(resolveJqLimits({ maxSteps }), new AbortController().signal);
    const text = context.mock.method(budget, "text");
    assert.throws(() => budget.value("x".repeat(40)),
      error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
    assert.equal(text.mock.callCount(), 0);
  }
  assert.equal(measure.mock.callCount(), 0);
  assert.equal(serialize.mock.callCount(), 0);
});

test("string work charges concatenation UTF-16 units plus the structural step", context => {
  for (const [left, right] of [["", ""], ["é", "😀"], ["\n", "\"\\"], ["\ud800", "\udc00"]] as const) {
    const units = left.length + right.length;
    const budget = new Budget(resolveJqLimits({ maxSteps: units + 1 }), new AbortController().signal);
    const step = context.mock.method(budget, "step");
    const text = context.mock.method(budget, "text");
    assert.equal(binary("+", left, right, budget), left + right);
    assert.deepEqual(step.mock.calls.map(call => call.arguments[0] ?? 1), [1, units]);
    assert.equal(text.mock.callCount(), 1);
    assert.equal(text.mock.calls[0]!.arguments[0], left + right);
  }
});

test("string work rejects concatenation before result validation or byte measurement", context => {
  const measure = context.mock.method(Buffer, "byteLength");
  for (const maxSteps of [1, 40]) {
    const budget = new Budget(resolveJqLimits({ maxSteps }), new AbortController().signal);
    const text = context.mock.method(budget, "text");
    assert.throws(() => binary("+", "x".repeat(20), "x".repeat(20), budget),
      error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
    assert.equal(text.mock.callCount(), 0);
  }
  assert.equal(measure.mock.callCount(), 0);
});

test("string work preserves exact value byte limits when work is admitted", () => {
  for (const text of ["é😀", "\n\"\\", "\u0000"]) {
    const bytes = Buffer.byteLength(JSON.stringify(text));
    const limits = { maxSteps: text.length + 1, maxValueBytes: bytes };
    assert.equal(new Budget(resolveJqLimits(limits), new AbortController().signal).value(text), bytes);
    assert.throws(() => new Budget(resolveJqLimits({ ...limits, maxValueBytes: bytes - 1 }), new AbortController().signal).value(text),
      error => error instanceof JqLimitError && error.message === "maxValueBytes limit exceeded");
  }
  const budget = new Budget(resolveJqLimits({ maxSteps: 4, maxValueBytes: 5 }), new AbortController().signal);
  assert.throws(() => binary("+", "é", "😀", budget),
    error => error instanceof JqLimitError && error.message === "maxValueBytes limit exceeded");
});

test("string work does not recalibrate object keys or non-string addition", () => {
  const signal = new AbortController().signal;
  const key = "x".repeat(40);
  assert.equal(new Budget(resolveJqLimits({ maxSteps: 2 }), signal).value({ [key]: null }), 49);
  const merged = Object.assign(Object.create(null) as Record<string, Json>, { key: 2 });
  const cases: [Json, Json, Json][] = [[1, 2, 3], [null, "abc", "abc"], ["abc", null, "abc"], [[1], [2], [1, 2]], [{ key: 1 }, { key: 2 }, merged]];
  for (const [left, right, expected] of cases) {
    assert.deepEqual(binary("+", left, right, new Budget(resolveJqLimits({ maxSteps: 1 }), signal)), expected);
  }
});

test("string work admission precedes size errors when both limits are exhausted", () => {
  const limits = resolveJqLimits({ maxSteps: 2, maxValueBytes: 1 });
  const signal = new AbortController().signal;
  assert.throws(() => new Budget(limits, signal).value("xx"),
    error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
  assert.throws(() => binary("+", "x", "x", new Budget(limits, signal)),
    error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
});

test("string work bounds seeded hidden add without optional suppression", async () => {
  const signal = new AbortController().signal;
  const ast = parse("add? | empty", new Map(), new Budget(resolveJqLimits(), signal));
  const interpreter = new Interpreter(new Budget(resolveJqLimits({ maxSteps: 128 }), signal), new Map());
  let emitted = 0;
  await assert.rejects(async () => {
    for await (const value of interpreter.run(ast, Array<string>(32).fill("x".repeat(40)))) {
      assert.notEqual(value, undefined);
      emitted++;
    }
  }, error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
  assert.equal(emitted, 0);
});

test("string work limit escapes optional command output suppression", async () => {
  const result = await run(["-c", "add? | empty"], JSON.stringify(Array<string>(32).fill("x".repeat(40))), { limits: { maxSteps: 8000 } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "jq: maxSteps limit exceeded\n");
});
