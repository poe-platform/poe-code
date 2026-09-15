import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import { runtimeSearchBound } from "./runtime-search-bound.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const v = new RuntimeValues(meter), guest = v.cell({});
  const context: IntegerIndexContext<RuntimeValue> = {
    integer: value => value.kind === "int" ? value.value : value.kind === "bool" ? BigInt(value.value) : undefined,
    isExactInteger: value => value.kind === "int", typeName: value => value.kind,
    lookupIndex: () => undefined, warn() {}
  };
  return { meter, v, guest, context };
}

describe("runtime search-bound index conversion", () => {
  it.each([false, true])("retains the missing-slot diagnostic (None accepted: %s)", acceptNone => {
    const { guest, context, meter } = fixture();
    expect(() => runtimeSearchBound(guest, 0n, meter, acceptNone, context)).toThrow(
      acceptNone ? "slice indices must be integers or None or have an __index__ method" : "slice indices must be integers or have an __index__ method"
    );
  });
  it.each([-1n, 1n])("saturates guest results with sign %s", sign => {
    const { guest, context, meter, v } = fixture();
    context.lookupIndex = () => () => v.integer(sign * (1n << 100n));
    expect(runtimeSearchBound(guest, 0n, meter, false, context)).toBe(sign < 0n ? -(1n << 63n) : (1n << 63n) - 1n);
  });
  it("does not rewrite a guest TypeError", () => {
    const { guest, context, meter } = fixture(), failure = new PythonRuntimeError("TypeError", "guest failure");
    context.lookupIndex = () => () => { throw failure; };
    expect(() => runtimeSearchBound(guest, 0n, meter, false, context)).toThrow(failure);
  });
  it("validates results without recursively invoking index", () => {
    const { guest, context, meter } = fixture(); let calls = 0;
    context.lookupIndex = () => () => { calls++; return guest; };
    expect(() => runtimeSearchBound(guest, 0n, meter, false, context)).toThrow("__index__ returned non-int (type cell)");
    expect(calls).toBe(1);
  });
  it("warns for a returned bool but bypasses index for a direct integer subclass", () => {
    const { guest, context, meter, v } = fixture(); const warnings: string[] = [];
    context.lookupIndex = () => () => v.true;
    context.warn = category => { warnings.push(category); };
    expect(runtimeSearchBound(guest, 0n, meter, false, context)).toBe(1n);
    expect(warnings).toEqual(["DeprecationWarning"]);
    context.integer = value => value === guest ? 3n : undefined;
    context.lookupIndex = () => { throw new Error("unexpected lookup"); };
    expect(runtimeSearchBound(guest, 0n, meter, false, context)).toBe(3n);
  });
  it.each(["lookup", "call", "warning"])("checks cancellation after %s", phase => {
    const { guest, context, v } = fixture(); let cancelled = false;
    context.lookupIndex = () => {
      if (phase === "lookup") cancelled = true;
      return () => { if (phase === "call") cancelled = true; return v.true; };
    };
    context.warn = () => { if (phase === "warning") cancelled = true; };
    const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
    expect(() => runtimeSearchBound(guest, 0n, meter, false, context)).toThrow(ExecutionLimitError);
  });
});
