import { expect, it } from "vitest";
import { runtimeRichComparison } from "./runtime-rich-comparison.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, v: new RuntimeValues(meter) };
}
it("keeps native comparisons when no guest slots are supplied", () => {
  const { v, meter } = fixture();
  expect(runtimeRichComparison("<", v.integer(1), v.integer(2), v, meter)).toBe(v.true);
  expect(runtimeRichComparison("==", v.list([v.true]), v.list([v.true]), v, meter)).toBe(v.true);
});
it("preserves arbitrary comparison results and prioritizes strict subtype reflection", () => {
  const { v, meter } = fixture(), value = v.cell({}), result = v.list([]), events: string[] = [];
  expect(runtimeRichComparison("<", value, value, v, meter, { slots: {
    rightIsStrictSubtype: true, notImplemented: v.notImplemented,
    forward() { events.push("forward"); return v.true; }, reflected() { events.push("reflected"); return result; }
  } })).toBe(result);
  expect(events).toEqual(["reflected"]);
});
it("uses identity equality only after both slots decline and rejects ordering", () => {
  const { v, meter } = fixture(), a = v.cell({}), b = v.cell({}), events: string[] = [];
  const context = { slots: { rightIsStrictSubtype: false, notImplemented: v.notImplemented,
    forward() { events.push("forward"); return v.notImplemented; }, reflected() { events.push("reflected"); return v.notImplemented; } }, typeName: () => "Guest" };
  expect(runtimeRichComparison("==", a, a, v, meter, context)).toBe(v.true);
  expect(events).toEqual(["forward", "reflected"]);
  expect(runtimeRichComparison("!=", a, b, v, meter, context)).toBe(v.true);
  expect(() => runtimeRichComparison("<", a, a, v, meter, context)).toThrow("'<' not supported between instances of 'Guest' and 'Guest'");
});
it("does not swallow slot errors and observes cancellation on successful results", () => {
  const { v, meter } = fixture(), failure = Error("comparison failed"); let cancelled = false;
  const slots = { rightIsStrictSubtype: false, notImplemented: v.notImplemented,
    forward() { throw failure; }, reflected: () => v.true };
  expect(() => runtimeRichComparison("==", v.none, v.none, v, meter, { slots })).toThrow(failure);
  expect(() => runtimeRichComparison("==", v.none, v.none, v, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } }, {
    slots: { ...slots, forward() { cancelled = true; return v.true; } }
  })).toThrow(ExecutionLimitError);
});
