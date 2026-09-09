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
it("renders empty, singleton and nested tuples with native bound methods", () => {
  const { meter, v, keywords } = fixture();
  for (const [value, expected] of [[v.tuple([]), "()"], [v.tuple([v.none]), "(None,)"], [v.tuple([v.integer(1), v.tuple([v.true])]), "(1, (True,))"]] as const) {
    for (const name of ["__str__", "__repr__"]) {
      const method = runtimeNativeAttribute(value, name, v, meter);
      if (method.kind !== "builtin_function_or_method") throw Error("expected method");
      expect(text(method.value.invoke([], keywords, meter))).toBe(expected);
      expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("expected 0 arguments, got 1");
    }
  }
});
it("distinguishes tuple and list cycle markers and repeated siblings", () => {
  const { meter, v } = fixture(), list = v.list([]), tuple = v.tuple([list]);
  list.items.append(tuple);
  const format = (value: RuntimeValue) => text(runtimeBinary("%", v.string("%r"), v.tuple([value]), v, meter));
  expect(format(tuple)).toBe("([(...)],)");
  expect(format(list)).toBe("[([...],)]");
  const child = v.tuple([v.integer(1)]);
  expect(format(v.tuple([child, child]))).toBe("((1,), (1,))");
});
it("formats tuple s/r/a fields without changing tuple argument unpacking", () => {
  const { meter, v } = fixture(), tuple = v.tuple([v.string("é")]);
  for (const code of ["s", "r", "a"]) {
    expect(text(runtimeBinary("%", v.string("%" + code), v.tuple([tuple]), v, meter))).toBe(code === "a" ? "('\\xe9',)" : "('é',)");
    expect(text(runtimeBinary("%", v.string("%9.3" + code), v.tuple([tuple]), v, meter))).toBe(code === "a" ? "      ('\\" : "      ('é");
  }
  expect(text(runtimeBinary("%", v.string("%s"), tuple, v, meter))).toBe("é");
  expect(() => runtimeBinary("%", v.string("%r"), v.tuple([]), v, meter)).toThrow("not enough arguments for format string");
});
it("shares guest repr hooks and restores tuple recursion state after failure", () => {
  const { meter, v } = fixture(), guest = v.cell({}), tuple = v.tuple([guest]), failure = new Error("guest repr");
  let fail = true;
  const context = createRuntimeRepresentationContext(v, meter, {
    lookupRepr: value => value === guest ? () => { if (fail) throw failure; return representationObject(tuple, "repr", context, meter); } : undefined,
    defaultRepr() { throw Error("unexpected default"); }
  });
  expect(() => representationObject(tuple, "repr", context, meter)).toThrow(failure);
  fail = false;
  expect(text(representationObject(tuple, "str", context, meter))).toBe("((...),)");
});
it("observes mutations of later mutable elements and preserves surrogate points", () => {
  const { meter, v } = fixture(), guest = v.cell({}), list = v.list([v.integer(1)]), tuple = v.tuple([guest, list]);
  const context = createRuntimeRepresentationContext(v, meter, {
    lookupRepr: value => value === guest ? () => { list.items.append(v.integer(2)); return v.stringPoints(Uint32Array.of(0xd800, 0xdc00)); } : undefined,
    defaultRepr() { throw Error("unexpected default"); }
  });
  const result = representationObject(tuple, "repr", context, meter);
  if (result.kind !== "str") throw Error("expected str");
  expect([...result.value]).toEqual([40, 0xd800, 0xdc00, 44, 32, 91, 49, 44, 32, 50, 93, 41]);
});
