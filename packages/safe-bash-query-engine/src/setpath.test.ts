import assert from "node:assert/strict";
import { test } from "node:test";
import { Interpreter } from "./interpreter.js";
import { Budget, resolveJqLimits, type Json } from "./limits.js";
import { parse } from "./parser.js";
import { equal } from "./values.js";

for (const [filter, input, expected] of [
  ['setpath(path(.[1:2]); ["A"])', ["build", "lint", "test", "test:unit", "typecheck"], ["build", "A", "test", "test:unit", "typecheck"]],
  ['setpath([{start:1,end:2}]; [8,9])', [0,1,2,3], [0,8,9,2,3]],
  ['setpath([{start:-3,end:-1},-1]; 9)', [0,1,2,3], [0,1,9,3]],
  ['setpath(path(.a[1:3][0].b); 9)', { a: [0,{b:1},2,3] }, { a: [0,{b:9},2,3] }],
  ['setpath([{start:null,end:null}]; [])', [0,1,2,3], []],
  ['setpath([{start:20,end:30}]; [9])', [0,1], [0,1,9]],
  ['setpath([{start:2,end:1}]; [9])', [0,1,2], [0,1,9,2]],
  ['setpath([{start:1.5,end:2.5}]; [9])', [0,1,2,3], [0,9,3]],
  ['setpath([{start:1,end:2}]; [9])', null, [9]],
] satisfies [string, Json, Json][]) {
  test(filter, async () => {
    const budget = new Budget(resolveJqLimits(), new AbortController().signal);
    const interpreter = new Interpreter(budget, new Map());
    const original = structuredClone(input);
    const results: Json[] = [];
    for await (const value of interpreter.run(parse(filter, new Map(), budget), input)) results.push(value);
    assert.ok(equal(results, [expected], budget));
    assert.deepEqual(input, original);
  });
}

for (const filter of [
  'setpath([{start:1}]; [9])',
  'setpath([{start:"1",end:2}]; [9])',
  'setpath([{start:1,end:2}]; 9)',
]) {
  test(`${filter} rejects invalid slices`, async () => {
    const budget = new Budget(resolveJqLimits(), new AbortController().signal);
    const interpreter = new Interpreter(budget, new Map());
    await assert.rejects(async () => {
      for await (const value of interpreter.run(parse(filter, new Map(), budget), [0,1,2])) void value;
    });
  });
}

test("setpath slice growth respects collection limits", async () => {
  const budget = new Budget(resolveJqLimits({ maxCollectionSize: 4 }), new AbortController().signal);
  const interpreter = new Interpreter(budget, new Map());
  await assert.rejects(async () => {
    for await (const value of interpreter.run(parse('setpath([{start:1,end:1}]; [8,9])', new Map(), budget), [0,1,2,3])) void value;
  }, { message: "maxCollectionSize limit exceeded" });
});
