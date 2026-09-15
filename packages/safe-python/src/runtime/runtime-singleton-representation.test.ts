import { expect, it } from "vitest";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { runtimeBinary } from "./runtime-binary.js";
import { representationObject } from "./representation-protocol.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const cases = [[v.none, "None"], [v.ellipsis, "Ellipsis"], [v.notImplemented, "NotImplemented"]] as const;
  const context = createRuntimeRepresentationContext(v, meter, { defaultRepr: () => { throw Error("unexpected fallback"); } });
  return { meter, v, keywords, cases, context };
}
const text = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it("exposes native singleton str and repr methods", () => {
  const { meter, v, keywords, cases } = fixture();
  for (const [value, expected] of cases) for (const name of ["__str__", "__repr__"]) {
    const method = runtimeNativeAttribute(value, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected method");
    expect(text(method.value.invoke([], keywords, meter))).toBe(expected);
  }
});
it("uses singleton slots through str, repr and ascii protocols without fallback", () => {
  const { meter, context, cases } = fixture();
  for (const [value, expected] of cases) for (const mode of ["str", "repr", "ascii"] as const) expect(text(representationObject(value, mode, context, meter))).toBe(expected);
});
it("formats singleton names with representation precision and width", () => {
  const { meter, v, cases } = fixture();
  for (const [value, expected] of cases) for (const code of ["s", "r", "a"]) {
    expect(text(runtimeBinary("%", v.string("%" + code), value, v, meter))).toBe(expected);
    expect(text(runtimeBinary("%", v.string("%8.3" + code), value, v, meter))).toBe("     " + expected.slice(0, 3));
  }
});
it("checks keyword arguments before positional counts", () => {
  const { meter, v, keywords, cases } = fixture();
  for (const [value] of cases) for (const name of ["__str__", "__repr__"]) {
    const method = runtimeNativeAttribute(value, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected method");
    expect(() => method.value.invoke([v.true], keywords, meter)).toThrow("expected 0 arguments, got 1");
  }
  keywords.items.set(v.string("x"), v.true);
  for (const [value] of cases) for (const name of ["__str__", "__repr__"]) {
    const method = runtimeNativeAttribute(value, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected method");
    expect(() => method.value.invoke([v.true], keywords, meter)).toThrow(`wrapper ${name}() takes no keyword arguments`);
  }
});
it("checks cancellation at singleton slot invocation", () => {
  const { meter, v, keywords } = fixture(), method = runtimeNativeAttribute(v.none, "__repr__", v, meter);
  if (method.kind !== "builtin_function_or_method") throw Error("expected method");
  const controller = new AbortController(); controller.abort();
  expect(() => method.value.invoke([], keywords, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000, signal: controller.signal }))).toThrow(ExecutionLimitError);
});
