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
it("exposes native list str and repr including cycles and repeated siblings", () => {
  const { meter, v, keywords } = fixture(), child = v.list([v.integer(1)]), list = v.list([child, child]);
  list.items.append(list);
  for (const name of ["__str__", "__repr__"]) {
    const method = runtimeNativeAttribute(list, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected method");
    expect(text(method.value.invoke([], keywords, meter))).toBe("[[1], [1], [...]]");
    expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("expected 0 arguments, got 1");
    keywords.items.set(v.string("x"), v.none);
    expect(() => method.value.invoke([v.none], keywords, meter)).toThrow(`wrapper ${name}() takes no keyword arguments`);
    keywords.items.clear();
  }
});
it("formats native nested lists through s/r/a with precision and padding", () => {
  const { meter, v } = fixture(), list = v.list([v.string("é"), v.list([v.none])]);
  for (const code of ["s", "r", "a"]) {
    expect(text(runtimeBinary("%", v.string("%" + code), list, v, meter))).toBe(code === "a" ? "['\\xe9', [None]]" : "['é', [None]]");
    expect(text(runtimeBinary("%", v.string("%8.2" + code), list, v, meter))).toBe("      ['");
  }
});
it("shares guest hooks and active paths through nested native list slots", () => {
  const { meter, v } = fixture(), guest = v.cell({}), list = v.list([guest]);
  const context = createRuntimeRepresentationContext(v, meter, {
    lookupRepr: value => value === guest ? () => representationObject(list, "repr", context, meter) : undefined,
    defaultRepr() { throw Error("unexpected default"); }
  });
  expect(text(representationObject(list, "str", context, meter))).toBe("[[...]]");
  list.items.append(v.integer(2));
  expect(text(representationObject(list, "repr", context, meter))).toBe("[[...], 2]");
});
it("bounds deep native lists with a guest recursion error", () => {
  const { meter, v } = fixture();
  let list = v.list([v.none]);
  for (let i = 0; i < 110; i++) list = v.list([list]);
  expect(() => runtimeBinary("%", v.string("%r"), list, v, meter)).toThrow("maximum recursion depth exceeded while getting the repr of an object");
});
it("retains live mutation and restores the shared path after guest failure", () => {
  const { meter, v } = fixture(), guest = v.cell({}), list = v.list([guest, v.integer(2)]), failure = new Error("guest failure");
  let fail = true;
  const context = createRuntimeRepresentationContext(v, meter, {
    lookupRepr: value => value === guest ? () => {
      if (fail) throw failure;
      list.items.clear();
      return representationObject(list, "repr", context, meter);
    } : undefined,
    defaultRepr() { throw Error("unexpected default"); }
  });
  expect(() => representationObject(list, "repr", context, meter)).toThrow(failure);
  fail = false;
  expect(text(representationObject(list, "repr", context, meter))).toBe("[[]]");
});
