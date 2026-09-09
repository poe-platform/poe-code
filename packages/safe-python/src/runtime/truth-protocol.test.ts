import { describe, expect, it } from "vitest";
import { protocolTruth, type TruthProtocolContext } from "./truth-protocol.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

interface Value { name: string; bool?: boolean; integer?: bigint; truth?: (() => Value) | null; length?: () => Value; index?: () => Value }
const boolean = (bool: boolean): Value => ({ name: "bool", bool });
const int = (integer: bigint): Value => ({ name: "int", integer });
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: TruthProtocolContext<Value> = {
  boolean: value => value.bool, isNone: value => value.name === "NoneType", lookupBool: value => value.truth,
  lookupLength: value => value.length, lookupIndex: value => value.index,
  integer: value => value.integer ?? (value.bool === undefined ? undefined : value.bool ? 1n : 0n),
  isExactInteger: value => value.name === "int", typeName: value => value.name,
  warn: () => { throw new Error("unexpected warning"); }
};

describe("guest truth protocol", () => {
  it.each([true, false])("handles builtin bool %s without slot lookup", value => {
    expect(protocolTruth(boolean(value), { ...context, lookupBool: () => { throw new Error("unexpected lookup"); } }, budget())).toBe(value);
  });
  it("recognizes None and defaults slotless objects to true", () => {
    expect(protocolTruth({ name: "NoneType" }, context, budget())).toBe(false);
    expect(protocolTruth({ name: "Object" }, context, budget())).toBe(true);
  });
  it.each([true, false])("prefers bool result %s to len", value => {
    expect(protocolTruth({ name: "Source", truth: () => boolean(value), length: () => { throw new Error("unexpected len"); } }, context, budget())).toBe(value);
  });
  it("rejects non-bool results without recursively testing or falling back", () => {
    expect(() => protocolTruth({ name: "Source", truth: () => int(1n), length: () => { throw new Error("unexpected len"); } }, context, budget()))
      .toThrow("__bool__ should return bool, returned int");
  });
  it("rejects explicitly disabled bool before len", () => {
    expect(() => protocolTruth({ name: "Source", truth: null, length: () => int(1n) }, context, budget()))
      .toThrow("'Source' cannot be interpreted as a boolean");
  });
  it.each([0n, 2n])("uses length %s only when bool is absent", length => {
    expect(protocolTruth({ name: "Source", length: () => ({ name: "Index", index: () => int(length) }) }, context, budget())).toBe(length !== 0n);
  });
  it.each([-1n, 1n << 100n])("propagates invalid length %s", length => {
    expect(() => protocolTruth({ name: "Source", length: () => int(length) }, context, budget()))
      .toThrow(expect.objectContaining({ name: length < 0n ? "ValueError" : "OverflowError" }));
  });
  it.each(["lookup", "call"])("propagates bool %s errors without fallback", phase => {
    const failure = new Error(phase);
    expect(() => protocolTruth({ name: "Source", truth: () => { throw failure; }, length: () => { throw new Error("unexpected len"); } }, {
      ...context, lookupBool: value => { if (phase === "lookup") throw failure; return value.truth; }
    }, budget())).toThrow(failure);
  });
  it("checks cancellation after bool callbacks before accepting their result", () => {
    let cancelled = false;
    expect(() => protocolTruth({ name: "Source", truth: () => { cancelled = true; return boolean(true); } }, context,
      { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
});
