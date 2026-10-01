import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget, JqLimitError, put, remove, resolveJqLimits, type Json } from "./limits.js";
import { jsonValues } from "./input.js";
import { Interpreter } from "./interpreter.js";
import { parse } from "./parser.js";

const budget = (limits = {}) => new Budget(resolveJqLimits({ maxValueBytes: 10000, ...limits }), new AbortController().signal);

test("cached subtrees charge the same work as fresh subtrees", () => {
  const b = budget();
  const value = { tags: ["hello", { nested: [1, 2] }] };
  b.value(value);
  const steps = b.currentSteps;
  b.value(value);
  assert.equal(b.currentSteps, steps * 2);
  const limited = budget({ maxSteps: steps - 1 });
  assert.throws(() => limited.value(value), /maxSteps/);
});

test("put and remove invalidate cached object size and depth", () => {
  const b = budget({ maxCollectionSize: 2, maxValueBytes: 20 });
  const value: Record<string, Json> = { a: 1 };
  assert.equal(b.value(value), 7);
  put(value, "b", "x".repeat(30));
  assert.throws(() => b.value(value), /maxValueBytes/);
  remove(value, "b");
  assert.equal(b.value(value), 7);
  remove(value, "a");
  assert.equal(b.value(value), 2);
  put(value, "a", 1); put(value, "b", 2); put(value, "c", 3);
  assert.throws(() => b.value(value), /maxCollectionSize/);
});

test("reused NDJSON arrays cannot retain metrics from the previous record", async () => {
  const b = budget({ maxValueBytes: 60 });
  const interpreter = new Interpreter(b, new Map());
  const ast = parse('{a: .tags, b: .tags, c: .tags}', new Map(), b);
  const source = { async *[Symbol.asyncIterator]() {
    yield new TextEncoder().encode('{"id":1,"tags":["a"]}\n{"id":2,"tags":["0123456789","0123456789","0123456789"]}\n');
  } };
  await assert.rejects(async () => {
    for await (const value of jsonValues(source, b, { onValue(doc) {
      // Check the result independently, including when sync evaluation declines.
      b.value({ a: (doc as Record<string, Json>).tags!, b: (doc as Record<string, Json>).tags!, c: (doc as Record<string, Json>).tags! });
      interpreter.tryRunSync(ast, doc);
      interpreter.releaseScratch();
    } })) void value;
  }, /maxValueBytes/);
});

for (const name of ["sort_by", "group_by"]) {
  test(`${name} accounts for key tuple wrappers`, async () => {
    const b = budget({ maxValueBytes: 10 });
    const interpreter = new Interpreter(b, new Map());
    const ast = parse(`${name}(.)`, new Map(), b);
    await assert.rejects(async () => {
      const result = interpreter.tryRunSync(ast, [1, 1, 1, 1]);
      if (!result) for await (const value of interpreter.run(ast, [1, 1, 1, 1])) void value;
    }, /maxValueBytes/);
  });
  test(`${name} charges each numeric sort comparison`, () => {
    const counts = [[1, 2, 3, 4, 5, 6], [3, 1, 6, 2, 5, 4]].map(input => {
      const b = budget();
      const interpreter = new Interpreter(b, new Map());
      const ast = parse(`${name}(.)`, new Map(), b);
      assert.ok(interpreter.tryRunSync(ast, input));
      return b.currentSteps;
    });
    assert.ok(counts[1]! > counts[0]!);
  });
}

for (const name of ["map", "sort_by", "group_by"]) test(`${name} speculative limits allow fallback`, () => {
  const ast = parse(`${name}(error("stop"))`, new Map(), budget());
  const b = budget({ maxSteps: 4 });
  const interpreter = new Interpreter(b, new Map());
  assert.equal(interpreter.tryRunSync(ast, Array(100).fill(1)), undefined);
  assert.equal(b.currentSteps, 0);
});

for (const noScratch of [false, true]) test(`fallback preserves execution order, noScratch=${noScratch}`, async () => {
  const ast = parse('map(error("stop"))', new Map(), budget());
  const b = budget({ maxSteps: 10, maxValueBytes: Infinity });
  const interpreter = new Interpreter(b, new Map());
  const input = Array(100).fill(1);
  const result = noScratch ? interpreter.tryRunSyncNoScratch(ast, input) : interpreter.tryRunSync(ast, input);
  assert.equal(result, undefined);
  assert.equal(b.currentSteps, 0);
  await assert.rejects(async () => {
    for await (const value of interpreter.run(ast, input)) void value;
  }, /stop/);
});

test("speculative fallback never swallows cancellation carrying a limit error", () => {
  const controller = new AbortController();
  const reason = new JqLimitError("maxSteps");
  const b = new Budget(resolveJqLimits(), controller.signal);
  const interpreter = new Interpreter(b, new Map());
  const ast = parse('sort_by(.)', new Map(), b);
  controller.abort(reason);
  assert.throws(() => interpreter.tryRunSync(ast, [3, 1, 2]), error => error === reason);
  assert.throws(() => interpreter.tryRunSyncNoScratch(ast, [3, 1, 2]), error => error === reason);
});
