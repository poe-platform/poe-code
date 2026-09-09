import { describe, expect, it } from "vitest";
import { integerIndex, type IntegerIndexContext } from "./index-protocol.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

interface Value { name: string; integer?: bigint; exact?: boolean; method?: () => Value }
const integer = (value: bigint, name = "int"): Value => ({ name, integer: value, exact: name === "int" });
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: IntegerIndexContext<Value> = {
  integer: value => value.integer, isExactInteger: value => value.exact === true,
  lookupIndex: value => value.method, typeName: value => value.name,
  warn: () => { throw new Error("unexpected warning"); }
};

describe("integer index protocol", () => {
  it.each(["int", "bool", "IntSubclass"])("uses %s payload without calling overridden index", name => {
    expect(integerIndex({ ...integer(7n, name), method: () => { throw new Error("unexpected index"); } }, context, budget())).toBe(7n);
  });
  it("preserves an arbitrarily large signed integer result", () => {
    const result = -(1n << 1000n);
    expect(integerIndex({ name: "Index", method: () => integer(result) }, context, budget())).toBe(result);
  });
  it("rejects missing index without falling back to int conversion", () => {
    expect(() => integerIndex({ name: "float" }, context, budget())).toThrow(expect.objectContaining({ name: "TypeError", message: "'float' object cannot be interpreted as an integer" }));
  });
  it("does not recursively convert non-integer index results", () => {
    expect(() => integerIndex({ name: "Index", method: () => ({ name: "Other", method: () => integer(1n) }) }, context, budget()))
      .toThrow("__index__ returned non-int (type Other)");
  });
  it.each(["bool", "IntSubclass"])("warns before accepting a returned %s payload", name => {
    const warnings: unknown[] = [];
    expect(integerIndex({ name: "Index", method: () => integer(1n, name) }, { ...context,
      warn: (category, message) => { warnings.push([category, message]); }
    }, budget())).toBe(1n);
    expect(warnings).toEqual([["DeprecationWarning", `__index__ returned non-int (type ${name}).  The ability to return an instance of a strict subclass of int is deprecated, and may be removed in a future version of Python.`]]);
  });
  it.each(["lookup", "call", "warning"])("propagates %s failures", phase => {
    const failure = new Error(phase);
    const value = { name: "Index", method: () => { if (phase === "call") throw failure; return integer(1n, "bool"); } };
    expect(() => integerIndex(value, { ...context,
      lookupIndex: value => { if (phase === "lookup") throw failure; return value.method; },
      warn: () => { throw failure; }
    }, budget())).toThrow(failure);
  });
  it("checks cancellation after index calls before issuing warnings", () => {
    let cancelled = false;
    const value = { name: "Index", method: () => { cancelled = true; return integer(1n, "bool"); } };
    expect(() => integerIndex(value, context, { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
});
