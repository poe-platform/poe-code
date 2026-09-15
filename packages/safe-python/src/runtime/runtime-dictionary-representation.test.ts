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
  const keys = { hash: () => 1n, equal: (a: RuntimeValue,b: RuntimeValue) => a === b || (a.kind === "str" && b.kind === "str" && a.value.compare(b.value, meter) === 0) || (a.kind === "int" && b.kind === "int" && a.value === b.value) };
  const dictionary = () => constructRuntimeDictionary([], new Map(), v, keys, meter);
  return { meter, v, dictionary };
}
const text = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it("exposes dictionary str and repr with native argument checks", () => {
  const { meter, v, dictionary } = fixture(), value = dictionary(), keywords = dictionary();
  value.items.set(v.string("é"), v.list([v.none]));
  for (const name of ["__str__", "__repr__"]) {
    const method = runtimeNativeAttribute(value, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected method");
    expect(text(method.value.invoke([], keywords, meter))).toBe("{'é': [None]}");
    expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("expected 0 arguments, got 1");
    keywords.items.set(v.string("x"), v.none);
    expect(() => method.value.invoke([], keywords, meter)).toThrow(`wrapper ${name}() takes no keyword arguments`);
    keywords.items.clear();
  }
});
it("formats dictionary s/r/a and preserves mapping format lookup", () => {
  const { meter, v, dictionary } = fixture(), value = dictionary(), key = v.string("é");
  value.items.set(key, v.integer(2));
  for (const code of ["s", "r", "a"]) expect(text(runtimeBinary("%", v.string("%" + code), value, v, meter))).toBe(code === "a" ? "{'\\xe9': 2}" : "{'é': 2}");
  expect(text(runtimeBinary("%", v.string("%8.2r"), value, v, meter))).toBe("      {'");
  expect(text(runtimeBinary("%", v.string("%(é)r"), value, v, meter))).toBe("2");
});
it("shares recursion paths across dict, tuple and list representations", () => {
  const { meter, v, dictionary } = fixture(), value = dictionary();
  value.items.set(v.string("self"), value);
  value.items.set(v.string("nested"), v.tuple([v.list([value])]));
  expect(text(runtimeBinary("%", v.string("%r"), value, v, meter))).toBe("{'self': {...}, 'nested': ([{...}],)}");
});
it("captures a current pair before key repr and scans clear/refill at its saved position", () => {
  const { meter, v, dictionary } = fixture(), value = dictionary(), key = v.cell({});
  value.items.set(key, v.integer(10)); value.items.set(v.integer(2), v.integer(20));
  const context = createRuntimeRepresentationContext(v, meter, {
    lookupRepr: item => item === key ? () => {
      value.items.clear(); value.items.set(v.integer(3), v.integer(30)); value.items.set(v.integer(4), v.integer(40));
      return v.string("K");
    } : undefined,
    defaultRepr() { throw Error("unexpected default"); }
  });
  expect(text(representationObject(value, "repr", context, meter))).toBe("{K: 10, 4: 40}");
});
it("restores dictionary recursion state after guest errors and handles empty reentry", () => {
  const { meter, v, dictionary } = fixture(), value = dictionary(), key = v.cell({}), error = new Error("guest repr");
  let fail = true;
  value.items.set(key, v.integer(10));
  const context = createRuntimeRepresentationContext(v, meter, {
    lookupRepr: item => item === key ? () => { if (fail) throw error; value.items.clear(); return representationObject(value, "repr", context, meter); } : undefined,
    defaultRepr() { throw Error("unexpected default"); }
  });
  expect(() => representationObject(value, "repr", context, meter)).toThrow(error);
  fail = false;
  expect(text(representationObject(value, "str", context, meter))).toBe("{{...}: 10}");
  expect(text(representationObject(value, "repr", context, meter))).toBe("{}");
});
