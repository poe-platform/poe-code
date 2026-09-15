import { expect, it } from "vitest";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { runtimeBinary } from "./runtime-binary.js";
import { representationObject } from "./representation-protocol.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  return { meter, v, keywords };
}
const text = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it("exposes complex str and repr slots with signed-zero behavior", () => {
  const { meter, v, keywords } = fixture();
  for (const name of ["__str__", "__repr__"]) {
    const method = runtimeNativeAttribute(v.complex(-0, -0), name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected method");
    expect(text(method.value.invoke([], keywords, meter))).toBe("(-0-0j)");
  }
});
it("uses native complex representations through protocols and percent formats", () => {
  const { meter, v } = fixture(), value = v.complex(1.25, -2);
  const context = createRuntimeRepresentationContext(v, meter, { defaultRepr: () => { throw Error("fallback"); } });
  for (const mode of ["str", "repr", "ascii"] as const) expect(text(representationObject(value, mode, context, meter))).toBe("(1.25-2j)");
  for (const code of ["s", "r", "a"]) expect(text(runtimeBinary("%", v.string("%10.4" + code), value, v, meter))).toBe("      (1.2");
});
it("retains numeric format rejection for complex values", () => {
  const { meter, v } = fixture();
  expect(() => runtimeBinary("%", v.string("%f"), v.complex(1, 0), v, meter)).toThrow("must be real number, not complex");
  expect(() => runtimeBinary("%", v.string("%d"), v.complex(1, 0), v, meter)).toThrow("%d format: a real number is required, not complex");
});
it("validates explicit slot arguments before rendering", () => {
  const { meter, v, keywords } = fixture(), method = runtimeNativeAttribute(v.complex(1, 2), "__repr__", v, meter);
  if (method.kind !== "builtin_function_or_method") throw Error("expected method");
  expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("expected 0 arguments, got 1");
  keywords.items.set(v.string("x"), v.none);
  expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("wrapper __repr__() takes no keyword arguments");
});
