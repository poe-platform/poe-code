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
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => a === b };
  const dictionary = () => constructRuntimeDictionary([], new Map(), v, keys, meter);
  return { meter, v, dictionary };
}
const text = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it("provides str and repr methods for all three dictionary views", () => {
  const { meter, v, dictionary } = fixture(), d = dictionary(), keywords = dictionary();
  for (const kind of ["dict_keys", "dict_values", "dict_items"] as const) {
    const view = v.dictionaryView(d, kind);
    for (const name of ["__str__", "__repr__"]) {
      const method = runtimeNativeAttribute(view, name, v, meter);
      if (method.kind !== "builtin_function_or_method") throw Error("expected method");
      expect(text(method.value.invoke([], keywords, meter))).toBe(`${kind}([])`);
      expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("expected 0 arguments, got 1");
      keywords.items.set(v.string("x"), v.none);
      expect(() => method.value.invoke([], keywords, meter)).toThrow(`wrapper ${name}() takes no keyword arguments`);
      keywords.items.clear();
    }
  }
});
it("formats live Unicode views through s/r/a and field precision", () => {
  const { meter, v, dictionary } = fixture(), d = dictionary();
  d.items.set(v.string("é"), v.integer(2));
  for (const [kind, expected] of [["dict_keys", "dict_keys(['é'])"], ["dict_values", "dict_values([2])"], ["dict_items", "dict_items([('é', 2)])"]] as const) {
    const view = v.dictionaryView(d, kind);
    for (const format of ["%s", "%r"]) expect(text(runtimeBinary("%", v.string(format), view, v, meter))).toBe(expected);
    expect(text(runtimeBinary("%", v.string("%a"), view, v, meter))).toBe(expected.replace("é", "\\xe9"));
    expect(text(runtimeBinary("%", v.string("%8.3r"), view, v, meter))).toBe("     dic");
  }
  const view = v.dictionaryView(d, "dict_values");
  d.items.clear();
  expect(text(runtimeBinary("%", v.string("%r"), view, v, meter))).toBe("dict_values([])");
});
it("uses a bare ellipsis for recursive views", () => {
  const { meter, v, dictionary } = fixture();
  for (const kind of ["dict_values", "dict_items"] as const) {
    const d = dictionary(), view = v.dictionaryView(d, kind);
    d.items.set(v.string("self"), view);
    expect(text(runtimeBinary("%", v.string("%r"), view, v, meter))).toBe(kind === "dict_values" ? "dict_values([...])" : "dict_items([('self', ...)])");
  }
});
it("snapshots every entry before invoking any element repr", () => {
  const { meter, v, dictionary } = fixture();
  for (const kind of ["dict_keys", "dict_values", "dict_items"] as const) {
    const d = dictionary(), guest = v.cell({}), view = v.dictionaryView(d, kind);
    d.items.set(kind === "dict_keys" ? guest : v.string("a"), guest);
    d.items.set(v.string("b"), v.integer(2));
    const context = createRuntimeRepresentationContext(v, meter, {
      lookupRepr: item => item === guest ? () => { d.items.clear(); d.items.set(v.string("new"), v.integer(3)); return v.string("C"); } : undefined,
      defaultRepr() { throw Error("unexpected default"); }
    });
    expect(text(representationObject(view, "repr", context, meter))).toBe(kind === "dict_keys" ? "dict_keys([C, 'b'])" : kind === "dict_values" ? "dict_values([C, 2])" : "dict_items([('a', C), ('b', 2)])");
  }
});
it("restores guards after errors and guards even an emptied active view", () => {
  const { meter, v, dictionary } = fixture(), d = dictionary(), guest = v.cell({}), view = v.dictionaryView(d, "dict_values"), error = Error("guest repr");
  let fail = true;
  d.items.set(v.string("a"), guest);
  const context = createRuntimeRepresentationContext(v, meter, {
    lookupRepr: item => item === guest ? () => { if (fail) throw error; d.items.clear(); return representationObject(view, "repr", context, meter); } : undefined,
    defaultRepr() { throw Error("unexpected default"); }
  });
  expect(() => representationObject(view, "repr", context, meter)).toThrow(error);
  fail = false;
  expect(text(representationObject(view, "repr", context, meter))).toBe("dict_values([...])");
  expect(text(representationObject(view, "repr", context, meter))).toBe("dict_values([])");
});
