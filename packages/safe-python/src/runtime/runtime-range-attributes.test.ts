import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { createRange } from "./integer-sequence.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(start = 2n, stop = 12n, step = 2n, maxSteps = 10000) {
  const meter = new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const range = v.range(createRange(start, stop, step)), keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const get = (name: string) => runtimeNativeAttribute(range, name, v, meter);
  const call = (name: string, args: RuntimeValue[]) => { const method = get(name); if (method.kind !== "builtin_function_or_method") throw new Error("expected method"); return method.value.invoke(args, keywords, meter); };
  return { v, range, keywords, get, call };
}

describe("native range attributes", () => {
  it("reads exact start, stop and step even for empty descending ranges", () => {
    const { v, get } = fixture(2n, 12n, -3n);
    expect(get("start")).toEqual(v.integer(2)); expect(get("stop")).toEqual(v.integer(12)); expect(get("step")).toEqual(v.integer(-3));
  });
  it("finds huge integer positions without iterating or converting to machine indices", () => {
    const { v, call } = fixture(0n, 1n << 100n, 1n, 100);
    expect(call("index", [v.integer(1n << 80n)])).toEqual(v.integer(1n << 80n));
    expect(call("count", [v.integer(1n << 80n)])).toEqual(v.integer(1));
  });
  it("searches descending ranges and distinguishes integer and generic missing errors", () => {
    const { v, call } = fixture(9n, -2n, -2n);
    expect(call("index", [v.true])).toEqual(v.integer(4));
    expect(call("index", [v.float(3)])).toEqual(v.integer(3));
    expect(() => call("index", [v.integer(2)])).toThrow("range.index(x): x not in range");
    expect(() => call("index", [v.float(2)])).toThrow("sequence.index(x): x not in sequence");
  });
  it("counts noninteger numeric equality through metered iteration", () => {
    const { v, call } = fixture();
    expect(call("count", [v.float(4)])).toEqual(v.integer(1));
    expect(call("count", [v.complex(6, 0)])).toEqual(v.integer(1));
    expect(call("count", [v.none])).toEqual(v.integer(0));
  });
  it("bounds exhaustive generic search instead of treating it as integer arithmetic", () => {
    const { v, call } = fixture(0n, 1n << 100n, 1n, 100);
    expect(() => call("count", [v.float(0)])).toThrow(ExecutionLimitError);
  });
  it("validates method arity and keywords", () => {
    const { v, call, keywords } = fixture();
    expect(() => call("index", [])).toThrow("range.index() takes exactly one argument (0 given)");
    expect(() => call("count", [v.true, v.false])).toThrow("range.count() takes exactly one argument (2 given)");
    keywords.items.set(v.string("x"), v.true);
    expect(() => call("count", [v.true])).toThrow("range.count() takes no keyword arguments");
  });
});
