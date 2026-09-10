import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { initializeRuntimeMethodDecorator } from "./runtime-method-decorator-initialization.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  return { meter, v, keywords };
}

it.each(["staticmethod", "classmethod"] as const)("initializes %s through ordinary attribute lookup and exposes copied metadata", kind => {
  const { meter, v, keywords } = fixture(), wrapper = v.methodDecorator(kind, v.none), payload = v.cell({}), metadata = v.list([]), names: string[] = [];
  expect(initializeRuntimeMethodDecorator(wrapper, [payload], keywords, v, meter, (value, name) => {
    expect(value).toBe(payload); names.push(name); return metadata;
  })).toBe(v.none);
  expect(names).toEqual(["__module__", "__name__", "__qualname__", "__doc__"]);
  for (const name of names) expect(runtimeNativeAttribute(wrapper, name, v, meter)).toBe(metadata);
  expect(runtimeNativeAttribute(wrapper, "__func__", v, meter)).toBe(payload);
  expect(runtimeNativeAttribute(wrapper, "__wrapped__", v, meter)).toBe(payload);
});

it.each(["staticmethod", "classmethod"] as const)("validates %s arguments before replacing state or reading metadata", kind => {
  const { meter, v, keywords } = fixture(), wrapper = v.methodDecorator(kind, v.true), attribute = () => { throw Error("must not read"); };
  for (const args of [[], [v.false, v.none]]) {
    expect(() => initializeRuntimeMethodDecorator(wrapper, args, keywords, v, meter, attribute)).toThrow(`${kind} expected 1 argument, got ${args.length}`);
    expect(wrapper.value).toBe(v.true);
  }
  keywords.items.set(v.string("x"), v.none);
  for (const args of [[], [v.false], [v.false, v.none]]) {
    expect(() => initializeRuntimeMethodDecorator(wrapper, args, keywords, v, meter, attribute)).toThrow(`${kind}() takes no keyword arguments`);
    expect(wrapper.value).toBe(v.true);
  }
});

it("keeps intrinsic wrapped-member descriptors ahead of the wrapper's own metadata", () => {
  const { meter, v } = fixture(), wrapper = v.methodDecorator("staticmethod", v.true);
  wrapper.state.attributes.set("__func__", v.false); wrapper.state.attributes.set("__wrapped__", v.false);
  wrapper.state.attributes.set("custom", v.none);
  expect(runtimeNativeAttribute(wrapper, "__func__", v, meter)).toBe(v.true);
  expect(runtimeNativeAttribute(wrapper, "__wrapped__", v, meter)).toBe(v.true);
  expect(runtimeNativeAttribute(wrapper, "custom", v, meter)).toBe(v.none);
});
