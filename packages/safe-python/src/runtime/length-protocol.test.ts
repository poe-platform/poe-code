import { describe, expect, it } from "vitest";
import { optionalLength, type LengthProtocolContext } from "./length-protocol.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

interface Value { name: string; integer?: bigint; length?: () => Value; index?: () => Value }
const int = (integer: bigint, name = "int"): Value => ({ name, integer });
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: LengthProtocolContext<Value> = {
  integer: value => value.integer, isExactInteger: value => value.name === "int", typeName: value => value.name,
  lookupIndex: value => value.index, lookupLength: value => value.length,
  warn: () => { throw new Error("unexpected warning"); }
};

describe("length slot conversion", () => {
  it("returns absence only for a missing slot", () => {
    expect(optionalLength({ name: "Missing" }, context, budget())).toBeUndefined();
  });
  it.each([0n, 1n, (1n << 63n) - 1n])("accepts length %s", value => {
    expect(optionalLength({ name: "Source", length: () => int(value) }, context, budget())).toBe(value);
  });
  it.each([-1n, -(1n << 100n)])("rejects negative length %s before overflow", value => {
    expect(() => optionalLength({ name: "Source", length: () => int(value) }, context, budget())).toThrow("__len__() should return >= 0");
  });
  it.each(["int", "Sub"])("preserves direct %s overflow diagnostics", name => {
    expect(() => optionalLength({ name: "Source", length: () => int(1n << 100n, name) }, context, budget()))
      .toThrow(expect.objectContaining({ name: "OverflowError", message: `cannot fit '${name}' into an index-sized integer` }));
  });
  it("converts index results and warns before checking overflow", () => {
    const events: string[] = [];
    expect(() => optionalLength({ name: "Source", length: () => ({ name: "Index", index: () => { events.push("index"); return int(1n << 100n, "Sub"); } }) }, {
      ...context, warn: () => { events.push("warning"); }
    }, budget())).toThrow("cannot fit 'Sub' into an index-sized integer");
    expect(events).toEqual(["index", "warning"]);
  });
  it("rejects non-index results without treating the slot as missing", () => {
    expect(() => optionalLength({ name: "Source", length: () => ({ name: "float" }) }, context, budget())).toThrow("'float' object cannot be interpreted as an integer");
  });
  it.each(["lookup", "call", "warning"])("propagates %s failures", phase => {
    const failure = new Error(phase);
    expect(() => optionalLength({ name: "Source", length: () => {
      if (phase === "call") throw failure;
      return { name: "Index", index: () => int(1n, "Sub") };
    } }, { ...context,
      lookupLength: value => { if (phase === "lookup") throw failure; return value.length; },
      warn: () => { throw failure; }
    }, budget())).toThrow(failure);
  });
  it("checks cancellation after len before index conversion", () => {
    let cancelled = false;
    expect(() => optionalLength({ name: "Source", length: () => { cancelled = true; return { name: "Index", index: () => { throw new Error("unexpected index"); } }; } }, context,
      { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
});
