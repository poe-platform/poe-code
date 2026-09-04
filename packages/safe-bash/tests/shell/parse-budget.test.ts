import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMaxParseUnits, ParseBudget } from "../../src/shell/parse-budget.js";
import { ShellLimitError } from "../../src/shell/types.js";

test("parse admission is inclusive, cumulative, and terminal with one failure identity", () => {
  const failures: ShellLimitError[] = [];
  const budget = new ParseBudget(3, undefined, error => { failures.push(error); });
  budget.admit(2);
  budget.admit();
  assert.throws(() => budget.admit(), ShellLimitError);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.limit, "maxParseUnits");
  assert.throws(() => budget.admit(0), error => error === failures[0]);
  assert.equal(failures.length, 1);
  assert.equal(defaultMaxParseUnits, 262_144);
});

test("invalid limits and admissions fail before changing allowance", () => {
  for (const value of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new ParseBudget(value), RangeError);
    const budget = new ParseBudget(1);
    assert.throws(() => budget.admit(value), RangeError);
    budget.admit();
  }
});

test("already-observed cancellation retains identity before quota failure", () => {
  const reason = Object.freeze({ cancelled: true });
  const budget = new ParseBudget(0, AbortSignal.abort(reason), () => { assert.fail("must not replace cancellation"); });
  assert.throws(() => budget.admit(), error => error === reason);
});
