import assert from "node:assert/strict";
import { test } from "node:test";
import { Interpreter } from "./interpreter.js";
import { Budget, resolveJqLimits, type Json } from "./limits.js";
import { parse } from "./parser.js";
import { equal } from "./values.js";

// Expected results checked with jq 1.7.1.
for (const [filter, expected] of [
  ['[limit(length/2; .[])]', [[0, 1, 2]]],
  ['[limit(1/2; .[])]', [[0]]],
  ['[limit(2; .[])]', [[0, 1]]],
  ['[limit(11/2; .[])]', [[0, 1, 2, 3, 4]]],
  ['[limit(0; error("unused"))]', [[]]],
  ['[limit(5/2; 0, 1, 2, error("unused"))]', [[0, 1, 2]]],
  ['[limit((1/2, 3/2); .[])]', [[0, 0, 1]]],
] satisfies [string, Json[]][]) {
  test(`limit: ${filter}`, async () => {
    const budget = new Budget(resolveJqLimits(), new AbortController().signal);
    const interpreter = new Interpreter(budget, new Map());
    const results: Json[] = [];
    for await (const value of interpreter.run(parse(filter, new Map(), budget), [0, 1, 2, 3, 4])) results.push(value);
    assert.ok(equal(results, expected, budget));
  });
}

for (const argument of ['-1/2', '"2"', 'null', 'nan', 'infinite', '9007199254740992']) {
  test(`limit rejects invalid or unsafe count: ${argument}`, async () => {
    const budget = new Budget(resolveJqLimits(), new AbortController().signal);
    const interpreter = new Interpreter(budget, new Map());
    await assert.rejects(async () => {
      for await (const value of interpreter.run(parse(`limit(${argument}; 1)`, new Map(), budget), null)) void value;
    }, /limit requires/);
  });
}

for (const [limits, diagnostic] of [
  [{ maxSteps: 100 }, 'maxSteps'],
  [{ maxCollectionSize: 2 }, 'maxCollectionSize'],
] as const) {
  test(`fractional limit preserves ${diagnostic}`, async () => {
    const budget = new Budget(resolveJqLimits(limits), new AbortController().signal);
    const interpreter = new Interpreter(budget, new Map());
    await assert.rejects(async () => {
      for await (const value of interpreter.run(parse('[limit(2001/2; range(2000))]', new Map(), budget), null)) void value;
    }, new RegExp(`${diagnostic} limit exceeded`));
  });
}
