import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { runtimeSliceBounds } from "./runtime-slice-bounds.js";
import type { IntegerIndexContext } from "./index-protocol.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const start = v.cell({}), stop = v.cell({}), step = v.cell({}), events: RuntimeValue[] = [];
  const context: IntegerIndexContext<RuntimeValue> = {
    integer: value => value.kind === "int" ? value.value : value.kind === "bool" ? BigInt(value.value) : undefined,
    isExactInteger: value => value.kind === "int", typeName: value => value.kind, warn() {},
    lookupIndex: value => () => { events.push(value); return v.integer(1n << 100n); }
  };
  return { meter, v, start, stop, step, events, context, slice: v.slice({ lower: start, upper: stop, step }) };
}

describe("guest slice-bound conversion", () => {
  it("preserves arbitrary-precision components in step/start/stop order", () => {
    const { slice, meter, context, events, start, stop, step } = fixture();
    expect(runtimeSliceBounds(slice, meter, context)).toEqual({ start: 1n << 100n, stop: 1n << 100n, step: 1n << 100n });
    expect(events).toEqual([step, start, stop]);
  });
  it("rejects zero step before invoking start or stop", () => {
    const { slice, meter, context, events, step, v } = fixture();
    context.lookupIndex = value => () => { events.push(value); return v.integer(0); };
    expect(() => runtimeSliceBounds(slice, meter, context)).toThrow("slice step cannot be zero");
    expect(events).toEqual([step]);
  });
  it("stops at guest failures without rewriting them", () => {
    const { slice, meter, context, events, start, step, v } = fixture(), failure = new Error("index failed");
    context.lookupIndex = value => () => { events.push(value); if (value === start) throw failure; return v.integer(1); };
    expect(() => runtimeSliceBounds(slice, meter, context)).toThrow(failure);
    expect(events).toEqual([step, start]);
  });
  it("checks cancellation before warning or converting later components", () => {
    const { slice, context, events, step, v } = fixture(); let cancelled = false;
    context.lookupIndex = value => () => { events.push(value); cancelled = true; return v.true; };
    context.warn = () => { throw Error("unexpected warning"); };
    expect(() => runtimeSliceBounds(slice, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } }, context)).toThrow(ExecutionLimitError);
    expect(events).toEqual([step]);
  });
});
