import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateArithmetic, parseArithmetic, prepareArithmetic } from "../../src/shell/arithmetic.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { ShellLimitError, ShellSyntaxError } from "../../src/shell/types.js";

const parseLimit = (error: unknown): boolean => error instanceof ShellLimitError && error.limit === "maxParseUnits";

for (const [source, units] of [["", 1], ["1", 2], ["1+2", 6], ["(1)", 4], ["-1", 4], ["name++", 4], ["1?2:3", 9]] as const) {
  test(`arithmetic counts actual tokens and nodes: ${JSON.stringify(source)}`, () => {
    assert.throws(() => parseArithmetic(source, 0, new ParseBudget(units - 1)), parseLimit);
    const budget = new ParseBudget(units);
    parseArithmetic(source, 0, budget);
    assert.throws(() => budget.admit(), parseLimit);
  });
}

test("arithmetic node admission precedes integer conversion", context => {
  let conversions = 0;
  const conversion = context.mock.method(globalThis, "BigInt", () => { conversions++; return 1n; });
  try {
    assert.throws(() => parseArithmetic("123", 0, new ParseBudget(1)), parseLimit);
    assert.equal(conversions, 0);
  } finally { conversion.mock.restore(); }
});

test("deferred syntax never swallows parse limits", () => {
  assert.ok(prepareArithmetic("1+").error instanceof ShellSyntaxError);
  assert.throws(() => prepareArithmetic("1+", new ParseBudget(2)), parseLimit);
  assert.throws(() => prepareArithmetic("1", new ParseBudget(2)), parseLimit);
  assert.equal(evaluateArithmetic(prepareArithmetic("1", new ParseBudget(3)), {}), 1n);
});

test("arithmetic variable reparses share allowance but AST reuse does not spend it", () => {
  const budget = new ParseBudget(5);
  const program = prepareArithmetic("value", budget);
  assert.equal(evaluateArithmetic(program, { value: "1" }, budget), 1n);
  assert.throws(() => evaluateArithmetic(program, { value: "1" }, budget), parseLimit);
  const literal = prepareArithmetic("1");
  assert.equal(evaluateArithmetic(literal, {}, new ParseBudget(0)), 1n);
});
