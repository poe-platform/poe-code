import { describe, expect, it } from "vitest";
import { createCallableBuiltin } from "./builtin-callable.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), values = new RuntimeValues(meter);
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  return { meter, values, keywords };
}

describe("callable builtin", () => {
  it("recognizes native callable families without invoking them or guest policy", () => {
    const { meter, values: v, keywords } = fixture();
    const builtin = createCallableBuiltin(v, meter, { callable: () => { throw Error("unexpected guest inspection"); } });
    expect(builtin.value.invoke([builtin], keywords, meter)).toBe(v.true);
  });
  it.each([false, true])("uses guest slot eligibility without invoking __call__: %s", answer => {
    const { meter, values: v, keywords } = fixture(), guest = v.cell({});
    let inspections = 0;
    const context = { callable(value: RuntimeValue) { expect(this).toBe(context); expect(value).toBe(guest); inspections++; return answer; } };
    const builtin = createCallableBuiltin(v, meter, context);
    expect(builtin.value.invoke([guest], keywords, meter)).toBe(v.boolean(answer));
    expect(inspections).toBe(1);
  });
  it("defaults noncallable values to false and checks arguments before inspection", () => {
    const { meter, values: v, keywords } = fixture(), builtin = createCallableBuiltin(v, meter);
    expect(builtin.value.invoke([v.none], keywords, meter)).toBe(v.false);
    expect(() => builtin.value.invoke([], keywords, meter)).toThrow("callable() takes exactly one argument (0 given)");
    expect(() => builtin.value.invoke([v.none, v.none], keywords, meter)).toThrow("callable() takes exactly one argument (2 given)");
    keywords.items.set(v.string("x"), v.none);
    expect(() => builtin.value.invoke([], keywords, meter)).toThrow("callable() takes no keyword arguments");
  });
});
