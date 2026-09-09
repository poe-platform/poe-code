import { expect, it } from "vitest";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { runtimeBinary } from "./runtime-binary.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { representationObject } from "./representation-protocol.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue,b: RuntimeValue) => a === b };
  const dictionary = () => constructRuntimeDictionary([], new Map(), v, keys, meter);
  return { meter, v, dictionary };
}
const text = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it("distinguishes mapping proxy str and repr in native methods", () => {
  const { meter, v, dictionary } = fixture(), value = dictionary(), proxy = v.mappingProxy(value), keywords = dictionary();
  for (const name of ["__str__", "__repr__"]) {
    const method = runtimeNativeAttribute(proxy, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected method");
    expect(text(method.value.invoke([], keywords, meter))).toBe(name === "__str__" ? "{}" : "mappingproxy({})");
    expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("expected 0 arguments, got 1");
  }
});
it("formats s/r/a with live dictionary contents and field truncation", () => {
  const { meter, v, dictionary } = fixture(), value = dictionary(), proxy = v.mappingProxy(value);
  value.items.set(v.string("é"), v.integer(2));
  expect(text(runtimeBinary("%", v.string("%s"), proxy, v, meter))).toBe("{'é': 2}");
  expect(text(runtimeBinary("%", v.string("%r"), proxy, v, meter))).toBe("mappingproxy({'é': 2})");
  expect(text(runtimeBinary("%", v.string("%a"), proxy, v, meter))).toBe("mappingproxy({'\\xe9': 2})");
  expect(text(runtimeBinary("%", v.string("%8.3r"), proxy, v, meter))).toBe("     map");
  value.items.clear();
  expect(text(runtimeBinary("%", v.string("%r"), proxy, v, meter))).toBe("mappingproxy({})");
});
it("uses the underlying dictionary guard for proxy cycles", () => {
  const { meter, v, dictionary } = fixture(), value = dictionary(), proxy = v.mappingProxy(value);
  value.items.set(v.string("self"), proxy);
  expect(text(runtimeBinary("%", v.string("%s"), proxy, v, meter))).toBe("{'self': mappingproxy({...})}");
  expect(text(runtimeBinary("%", v.string("%r"), proxy, v, meter))).toBe("mappingproxy({'self': mappingproxy({...})})");
  expect(text(runtimeBinary("%", v.string("%r"), value, v, meter))).toBe("{'self': mappingproxy({...})}");
});
it("keeps guest hooks, mutation and exception cleanup through the proxy", () => {
  const { meter, v, dictionary } = fixture(), value = dictionary(), proxy = v.mappingProxy(value), key = v.cell({}), error = new Error("guest repr");
  let fail = true;
  value.items.set(key, v.integer(10));
  const context = createRuntimeRepresentationContext(v, meter, {
    lookupRepr: item => item === key ? () => { if (fail) throw error; value.items.clear(); return representationObject(proxy, "repr", context, meter); } : undefined,
    defaultRepr() { throw Error("unexpected default"); }
  });
  expect(() => representationObject(proxy, "repr", context, meter)).toThrow(error);
  fail = false;
  expect(text(representationObject(proxy, "repr", context, meter))).toBe("mappingproxy({mappingproxy({...}): 10})");
});
