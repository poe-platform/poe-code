import { describe, expect, it } from "vitest";
import { runtimeTruth } from "./runtime-truth.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { createRange } from "./integer-sequence.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { parseExpression } from "../expression.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new RuntimeValues(meter) };
}

describe("exact runtime value truth", () => {
  it("observes current list size without inspecting members or cycles", () => {
    const { meter, values } = fixture(), list = values.list([]);
    expect(runtimeTruth(list, meter)).toBe(false);
    list.items.append(list); expect(runtimeTruth(list, meter)).toBe(true);
    list.items.clear(); list.items.append(values.notImplemented);
    expect(runtimeTruth(list, meter)).toBe(true);
    list.items.clear(); expect(runtimeTruth(list, meter)).toBe(false);
  });
  it("uses exact range length without signed-size conversion or iteration", () => {
    const { meter, values } = fixture();
    for (const [start, stop, step, expected] of [
      [0n, 0n, 1n, false], [3n, 0n, 1n, false], [0n, 3n, -1n, false],
      [3n, 0n, -1n, true], [0n, 1n << 200n, 1n, true]
    ] as const) expect(runtimeTruth(values.range(createRange(start, stop, step)), meter)).toBe(expected);
  });
  it("keeps both fresh and exhausted iterators truthy without advancing them", () => {
    const { meter, values } = fixture(); let calls = 0;
    const iterator = values.iterator({ next: () => { calls++; return { done: true, value: undefined }; } });
    expect(runtimeTruth(iterator, meter)).toBe(true); expect(calls).toBe(0);
    iterator.value.next(); expect(runtimeTruth(iterator, meter)).toBe(true); expect(calls).toBe(1);
  });
  it("preserves scalar truth and shallow tuple/slice behavior", () => {
    const { meter, values } = fixture(), list = values.list([]);
    const inputs: RuntimeValue[] = [values.none, values.false, values.integer(0n), values.float(NaN),
      values.tuple([list]), values.tuple([]), values.slice({ lower: list })];
    expect(inputs.map(value => runtimeTruth(value, meter))).toEqual([false, false, false, true, true, false, true]);
    expect(() => runtimeTruth(values.notImplemented, meter)).toThrow(expect.objectContaining({ name: "TypeError" }));
  });
  it("does not allocate while checking mutable or large values", () => {
    const { meter, values } = fixture(), list = values.list([values.none]);
    const range = values.range(createRange(0n, 1n << 200n)), before = meter.usage;
    runtimeTruth(list, meter); runtimeTruth(range, meter);
    expect(meter.usage.allocatedBytes).toBe(before.allocatedBytes);
    expect(meter.usage.steps - before.steps).toBeLessThan(10);
  });
  it("honors fatal limits before returning iterator truth", () => {
    const { values } = fixture(), iterator = values.iterator({ next: () => { throw new Error("advanced"); } });
    const meter = new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 });
    expect(runtimeTruth(iterator, meter)).toBe(true);
    expect(() => runtimeTruth(iterator, meter)).toThrow(ExecutionLimitError);
  });
  it("connects parsed mutable literals to short-circuit and branch evaluation", () => {
    const { meter, values } = fixture();
    const context = {
      literal: node => values.literal(node), list: items => values.list(items),
      truth: value => runtimeTruth(value, meter), boolean: value => values.boolean(value)
    } as ExpressionContext<RuntimeValue>;
    expect(evaluateExpression(parseExpression("[] or [0]"), context, meter)).toMatchObject({ kind: "list" });
    expect(evaluateExpression(parseExpression("[] or [0]"), context, meter, "branch")).toBe(true);
    expect(evaluateExpression(parseExpression("[] and missing"), context, meter, "branch")).toBe(false);
    expect(evaluateExpression(parseExpression("[False] or missing"), context, meter, "branch")).toBe(true);
    expect(evaluateExpression(parseExpression("not []"), context, meter, "branch")).toBe(true);
  });
});
