import { expect, it } from "vitest";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { runtimeBinary } from "./runtime-binary.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { representationObject } from "./representation-protocol.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  return { meter, v, keywords };
}
const text = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it("exposes native shortest float str and repr methods", () => {
  const { meter, v, keywords } = fixture();
  for (const [number, expected] of [[-0, "-0.0"], [0.1, "0.1"], [1e-5, "1e-05"], [1e16, "1e+16"], [Infinity, "inf"], [NaN, "nan"], [Number.MIN_VALUE, "5e-324"]] as const) for (const name of ["__str__", "__repr__"]) {
    const method = runtimeNativeAttribute(v.float(number), name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected method");
    expect(text(method.value.invoke([], keywords, meter))).toBe(expected);
  }
});
it("routes native float representation without guest fallback", () => {
  const { meter, v } = fixture();
  const context = createRuntimeRepresentationContext(v, meter, { lookupStr: () => { throw Error("guest lookup"); }, lookupRepr: () => { throw Error("guest lookup"); }, defaultRepr: () => { throw Error("fallback"); } });
  for (const mode of ["str", "repr", "ascii"] as const) expect(text(representationObject(v.float(2), mode, context, meter))).toBe("2.0");
});
it("formats floats through s/r/a with representation precision rather than numeric precision", () => {
  const { meter, v } = fixture();
  for (const code of ["s", "r", "a"]) {
    expect(text(runtimeBinary("%", v.string("%" + code), v.float(1e16), v, meter))).toBe("1e+16");
    expect(text(runtimeBinary("%", v.string("%8.3" + code), v.float(1.2345), v, meter))).toBe("     1.2");
  }
});
it("validates explicit slot arguments before producing digits", () => {
  const { meter, v, keywords } = fixture(), method = runtimeNativeAttribute(v.float(1), "__repr__", v, meter);
  if (method.kind !== "builtin_function_or_method") throw Error("expected method");
  expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("expected 0 arguments, got 1");
  keywords.items.set(v.string("x"), v.none);
  expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("wrapper __repr__() takes no keyword arguments");
});
