import assert from "node:assert/strict";
import { test } from "node:test";
import { Interpreter } from "./interpreter.js";
import { Budget, resolveJqLimits, type Json } from "./limits.js";
import { parse } from "./parser.js";

for (const name of ["sort_by", "group_by"]) test(`${name} preserves Unicode code point order and stable ties`, async () => {
  const budget = new Budget(resolveJqLimits(), new AbortController().signal);
  const interpreter = new Interpreter(budget, new Map());
  const ast = parse(`${name}(.k)`, new Map(), budget);
  const a = { k: "\uFFFD", v: 1 }, b = { k: "😀", v: 2 }, c = { k: "\uFFFD", v: 3 };
  const input = [b, a, c];
  const sync = interpreter.tryRunSync(ast, input);
  const results: Json[] = [];
  if (sync) results.push(...sync);
  else for await (const value of interpreter.run(ast, input)) results.push(value);
  assert.deepEqual(results, [name === "sort_by" ? [a, c, b] : [[a, c], [b]]]);
});

test("a failed synchronous pipe leaves scratch available for the next result", () => {
  const budget = new Budget(resolveJqLimits(), new AbortController().signal);
  const interpreter = new Interpreter(budget, new Map());
  const pipe = parse('{a: .x} | [.a]', new Map(), budget);
  assert.equal(interpreter.tryRunSync(pipe, { x: 42 }), undefined);
  const result = interpreter.tryRunSync(parse('{a: .x}', new Map(), budget), { x: 7 })!;
  assert.deepEqual(interpreter.getScratchKeys(result[0]!), ["a"]);
});

for (const limits of [undefined, { maxCollectionSize: Infinity, maxValueBytes: Infinity }, { maxCollectionSize: 4_000_000, maxValueBytes: 20_000_000 }]) {
  test(`array assignment respects configured limits beyond former fixed caps: ${limits === undefined ? "defaults" : limits.maxValueBytes === Infinity ? "Infinity" : "finite"}`, async () => {
    const budget = new Budget(resolveJqLimits(limits), new AbortController().signal);
    const interpreter = new Interpreter(budget, new Map());
    // Null padding crosses both the former million-element and 16 MiB caps.
    const index = 3_355_443;
    const result = await interpreter.set(null, [index], 7);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, index + 1);
    assert.equal(result[0], null);
    assert.equal(result[index - 1], null);
    assert.equal(result[index], 7);
  });
}

for (const [limits, message] of [
  [{ maxCollectionSize: 3 }, "maxCollectionSize limit exceeded"],
  [{ maxValueBytes: 15 }, "maxValueBytes limit exceeded"],
] as const) {
  test(`array assignment still enforces ${message}`, async () => {
    const budget = new Budget(resolveJqLimits(limits), new AbortController().signal);
    const interpreter = new Interpreter(budget, new Map());
    await assert.rejects(interpreter.set(null, [3], 7), { message });
  });
}

test("array assignment accepts exact configured collection and byte boundaries", async () => {
  const budget = new Budget(resolveJqLimits({ maxCollectionSize: 4, maxValueBytes: 18 }), new AbortController().signal);
  const interpreter = new Interpreter(budget, new Map());
  assert.deepEqual(await interpreter.set(null, [3], 7), [null, null, null, 7]);
});
