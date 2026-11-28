import assert from "node:assert/strict";
import { test } from "node:test";
import { Interpreter } from "./interpreter.js";
import { Budget, resolveJqLimits } from "./limits.js";
import { parse } from "./parser.js";

for (const [filter, expected] of [
  ['[[1,2],[3,4]] | reduce .[] as [$a,$b] (0; . + $a * $b)', [14]],
  ['[{"k":"a","v":1},{"k":"b","v":2}] | [foreach .[] as {k:$k, v:$v} (0; . + $v; "\\($k)=\\(.)")]', [["a=1", "b=3"]]],
  ['[[1,2],[3,4]] | [foreach .[] as [$a,$b] (0; . + $a * $b)]', [[2, 14]]],
  ['[{"v":[1,2]},{"v":[3,4]}] | reduce .[] as {v:[$a,$b]} (0; . + $a * $b)', [14]],
  ['10 as $a | [reduce [[2],[]][] as [$a] ($a; . + $a), $a + 0]', [[12, 10]]],
  ['[1,2] | reduce .[] as $a (0; . + $a)', [3]],
] as const) {
  test(`iteration bindings: ${filter}`, async () => {
    const budget = new Budget(resolveJqLimits(), new AbortController().signal);
    const interpreter = new Interpreter(budget, new Map());
    assert.deepEqual(await interpreter.collect(parse(filter, new Map(), budget), null), expected);
  });
}

for (const filter of [
  'reduce [[1]][] as [$a] ($a; . + $a)',
  '(reduce [[1]][] as [$a] (0; . + $a)) | $a',
  'reduce [{"a":1}][] as {(missing):$a} (0; . + $a)',
]) {
  test(`iteration patterns reject unbound names: ${filter}`, () => {
    const budget = new Budget(resolveJqLimits(), new AbortController().signal);
    assert.throws(() => parse(filter, new Map(), budget), /undefined|not defined/);
  });
}
