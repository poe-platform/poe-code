import assert from "node:assert/strict";
import { test } from "node:test";
import { Interpreter } from "./interpreter.js";
import { Budget, resolveJqLimits, type Json } from "./limits.js";
import { parse } from "./parser.js";
import { equal } from "./values.js";

// Expected results checked with jq 1.7.1.
for (const [filter, expected] of [
  ['path(.[-2:])', [{ start: -2, end: null }]],
  ['path(.[:2])', [{ start: null, end: 2 }]],
  ['path(.[-3:-1])', [{ start: -3, end: -1 }]],
  ['path(.[1.5:2.5])', [{ start: 1.5, end: 2.5 }]],
  ['path(.[20:30])', [{ start: 20, end: 30 }]],
  ['path(.[nan:])', [{ start: null, end: null }]],
  ['path(.[-2:][0])', [{ start: -2, end: null }, 0]],
  ['path(.[-2:] | .[0])', [{ start: -2, end: null }, 0]],
  ['null | path(.[-2:])', [{ start: -2, end: null }]],
  ['[] | path(.[:2])', [{ start: null, end: 2 }]],
  ['(-2) as $start | path(.[$start:])', [{ start: -2, end: null }]],
  ['path(.[-2:]) as $p | [10,20,30,40,50,60] | getpath($p)', [50,60]],
  ['path(.[:2]) as $p | [10,20,30] | getpath($p)', [10,20]],
  ['.[-2:] = [9]', [0,1,9]],
  ['.[:2] |= reverse', [1,0,2,3]],
  ['.[-3:-1][0] = 9', [0,9,2,3]],
  ['.[1.5:2.5] = [9]', [0,9,3]],
  ['.[20:30] = [9]', [0,1,2,3,9]],
  ['.[2:1] = [9]', [0,1,9,2,3]],
  ['.[-2:] |= empty', [0,1]],
  ['(.[:2], .[-2:]) |= empty', []],
  ['.[-3:][0] |= empty', [0,2,3]],
] satisfies [string, Json][]) {
  test(filter, async () => {
    const budget = new Budget(resolveJqLimits(), new AbortController().signal);
    const interpreter = new Interpreter(budget, new Map());
    const results: Json[] = [];
    for await (const value of interpreter.run(parse(filter, new Map(), budget), [0,1,2,3])) results.push(value);
    assert.ok(equal(results, [expected], budget), JSON.stringify(results));
  });
}
