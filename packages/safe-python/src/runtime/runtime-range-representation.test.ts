import { expect, it } from "vitest";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { runtimeBinary } from "./runtime-binary.js";
import { createRange } from "./integer-sequence.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  return { meter, v, keywords };
}
const text = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it("renders stored bounds and omits only a unit step", () => {
  const { meter, v, keywords } = fixture();
  for (const [start, stop, step, expected] of [[0n, 5n, 1n, "range(0, 5)"], [10n, 0n, 1n, "range(10, 0)"], [10n, -5n, -2n, "range(10, -5, -2)"], [1n, 2n, 9n, "range(1, 2, 9)"]] as const) for (const name of ["__str__", "__repr__"]) {
    const method = runtimeNativeAttribute(v.range(createRange(start, stop, step)), name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected method");
    expect(text(method.value.invoke([], keywords, meter))).toBe(expected);
  }
});
it("formats range representations through s/r/a", () => {
  const { meter, v } = fixture(), value = v.range(createRange(1n, 9n, 2n));
  for (const code of ["s", "r", "a"]) {
    expect(text(runtimeBinary("%", v.string("%" + code), value, v, meter))).toBe("range(1, 9, 2)");
    expect(text(runtimeBinary("%", v.string("%10.5" + code), value, v, meter))).toBe("     range");
  }
});
it("represents enormous cardinalities without iterating or calling len", () => {
  const meter = new ExecutionBudget({ maxSteps: 5000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), stop = 10n ** 100n;
  expect(text(runtimeBinary("%", v.string("%r"), v.range(createRange(0n, stop)), v, meter))).toBe("range(0, " + stop.toString() + ")");
});
it("enforces integer digit limits even for empty ranges", () => {
  const { meter, v } = fixture(), bound = 10n ** 4300n;
  expect(() => runtimeBinary("%", v.string("%r"), v.range(createRange(bound, 0n)), v, meter)).toThrow("Exceeds the limit (4300 digits)");
});
it("preserves explicit method argument validation", () => {
  const { meter, v, keywords } = fixture(), method = runtimeNativeAttribute(v.range(createRange(0n, 1n)), "__repr__", v, meter);
  if (method.kind !== "builtin_function_or_method") throw Error("expected method");
  expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("expected 0 arguments, got 1");
  keywords.items.set(v.string("x"), v.none);
  expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("wrapper __repr__() takes no keyword arguments");
});
