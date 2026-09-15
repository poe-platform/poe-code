import { describe, expect, it } from "vitest";
import { createIdBuiltin } from "./builtin-id.js";
import { ExecutionIdentity } from "./execution-identity.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";

describe("id builtin", () => {
  it("returns stable IDs without exposing the registry or conflating equal values", () => {
    const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 }), v = new RuntimeValues(meter);
    const identity = new ExecutionIdentity(meter), builtin = createIdBuiltin(v, meter, identity);
    const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
    const a = v.list([]), b = v.list([]);
    const first = builtin.value.invoke([a], keywords, meter), again = builtin.value.invoke([a], keywords, meter);
    expect(first).toEqual(again); expect(first).not.toBe(again);
    expect(first).not.toEqual(builtin.value.invoke([b], keywords, meter));
    expect(first).toEqual(v.integer(identity.id(a)));
    expect(() => builtin.value.invoke([], keywords, meter)).toThrow("id() takes exactly one argument (0 given)");
    keywords.items.set(v.string("x"), v.none);
    expect(() => builtin.value.invoke([], keywords, meter)).toThrow("id() takes no keyword arguments");
  });
});
