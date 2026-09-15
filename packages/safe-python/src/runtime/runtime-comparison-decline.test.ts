import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeRichComparison } from "./runtime-rich-comparison.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  return { meter, v };
}

it.each(["==", "!=", "<", "<=", ">", ">="])("declines unsupported root %s pairs before final fallback", operator => {
  const { v, meter } = fixture();
  expect(runtimeComparison(operator, v.integer(7), v.cell({}), v, meter, 1000, { declineUnsupported: true })).toBe(v.notImplemented);
  expect(runtimeComparison(operator, v.list([]), v.tuple([]), v, meter, 1000, { declineUnsupported: true })).toBe(v.notImplemented);
});

it("declines unsupported native ordering without weakening supported comparisons", () => {
  const { v, meter } = fixture(), context = { declineUnsupported: true };
  expect(runtimeComparison("<", v.complex(1, 2), v.integer(3), v, meter, 1000, context)).toBe(v.notImplemented);
  expect(runtimeComparison("==", v.integer(3), v.float(3), v, meter, 1000, context)).toBe(v.true);
  const nan = v.float(NaN);
  expect(runtimeComparison("==", nan, nan, v, meter, 1000, context)).toBe(v.false);
});

it("retains object identity results for supported default equality", () => {
  const { v, meter } = fixture(), value = v.iterator({ next: () => ({ done: true, value: v.none }) }), context = { declineUnsupported: true };
  expect(runtimeComparison("==", value, value, v, meter, 1000, context)).toBe(v.true);
  expect(runtimeComparison("!=", value, value, v, meter, 1000, context)).toBe(v.false);
});

it("fully resolves nested equality and ordering rather than leaking a decline", () => {
  const { v, meter } = fixture(), left = v.list([v.none]), right = v.list([v.integer(1)]), context = { declineUnsupported: true };
  expect(runtimeComparison("==", left, right, v, meter, 1000, context)).toBe(v.false);
  expect(runtimeComparison("!=", left, right, v, meter, 1000, context)).toBe(v.true);
  expect(() => runtimeComparison("<", left, right, v, meter, 1000, context)).toThrow("'<' not supported between instances of 'NoneType' and 'int'");
});

it("retains final comparison semantics when no decline policy is supplied", () => {
  const { v, meter } = fixture(), guest = v.cell({});
  expect(runtimeComparison("==", v.integer(7), guest, v, meter)).toBe(v.false);
  expect(runtimeComparison("!=", v.integer(7), guest, v, meter)).toBe(v.true);
  expect(() => runtimeComparison("<", v.integer(7), guest, v, meter)).toThrow("'<' not supported between instances of 'int' and 'cell'");
});

it("lets the rich dispatcher reflect after a native kernel declines", () => {
  const { v, meter } = fixture(), left = v.integer(7), right = v.cell({}), events: string[] = [];
  const result = runtimeRichComparison("==", left, right, v, meter, { slots: {
    rightIsStrictSubtype: false, notImplemented: v.notImplemented,
    forward() { events.push("native"); return runtimeComparison("==", left, right, v, meter, 1000, { declineUnsupported: true }); },
    reflected() { events.push("guest"); return v.none; }
  } });
  expect(result).toBe(v.none); expect(events).toEqual(["native", "guest"]);
});

it("preserves raw mapping-proxy delegation through the member policy", () => {
  const { v, meter } = fixture(), dictionary = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const guest = v.cell({});
  expect(runtimeComparison("==", v.mappingProxy(dictionary), guest, v, meter, 1000, {
    declineUnsupported: true,
    comparison(operator, left, right) { expect(operator).toBe("=="); expect(left).toBe(dictionary); expect(right).toBe(guest); return v.none; }
  })).toBe(v.none);
});

it("resolves native cell contents even when the root may decline", () => {
  const { v, meter } = fixture(), left = v.cell({ content: { value: v.none } }), right = v.cell({ content: { value: v.integer(1) } });
  expect(runtimeComparison("==", left, right, v, meter, 1000, { declineUnsupported: true })).toBe(v.false);
  expect(() => runtimeComparison("<", left, right, v, meter, 1000, { declineUnsupported: true })).toThrow("'<' not supported between instances of 'NoneType' and 'int'");
});

it("observes cancellation when reading the root decline policy", () => {
  const controller = new AbortController(), meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal });
  const v = new RuntimeValues(meter);
  expect(() => runtimeComparison("==", v.none, v.integer(1), v, meter, 1000, {
    get declineUnsupported() { controller.abort(); return true; }
  })).toThrow("execution cancelled");
});
