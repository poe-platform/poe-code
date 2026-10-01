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
