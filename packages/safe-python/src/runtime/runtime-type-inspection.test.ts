import { expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { callRuntimeType } from "./runtime-type-call.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const registry = new RuntimeTypeRegistry(v, keys, meter), keywords = dictionary();
  const cls = registry.publish(new RuntimeTypeLayout("C", [registry.object.value], dictionary(), meter), registry.type);
  const classifications: RuntimeValue[] = [];
  const special = { typeOf(value: RuntimeValue) { classifications.push(value); return cls; }, slots: () => undefined };
  const inspect = (...args: RuntimeValue[]) => callRuntimeType(registry.type, args, keywords, special, v, meter, () => { throw Error("inspection must not invoke new or init"); });
  return { v, meter, registry, cls, dictionary, keywords, classifications, special, inspect };
}

it("returns canonical actual types of instances and types without external classification", () => {
  const { v, registry, cls, classifications, inspect } = fixture();
  expect(inspect(v.instance(cls))).toBe(cls); expect(inspect(cls)).toBe(registry.type);
  expect(inspect(registry.type)).toBe(registry.type); expect(classifications).toEqual([]);
});

it("uses the supplied actual-type policy for native and opaque values", () => {
  const { v, cls, classifications, inspect } = fixture(), values = [v.integer(1), v.none, v.list([]), v.cell({})];
  for (const value of values) expect(inspect(value)).toBe(cls);
  expect(classifications).toEqual(values);
});

it("returns a class's actual custom metaclass", () => {
  const { v, meter, registry, dictionary, inspect } = fixture();
  const meta = registry.publish(new RuntimeTypeLayout("Meta", [registry.type.value], dictionary(), meter), registry.type);
  const cls = registry.publish(new RuntimeTypeLayout("C", [registry.object.value], dictionary(), meter), meta);
  expect(inspect(cls)).toBe(meta); expect(inspect(v.instance(cls))).toBe(cls);
});

it("ignores shadow __class__ attributes", () => {
  const { v, cls, dictionary, inspect } = fixture(), storage = dictionary(); storage.items.set(v.string("__class__"), v.none);
  expect(inspect(v.instance(cls, storage))).toBe(cls);
});

it.each([0, 2, 4])("rejects canonical type call arity %s", count => {
  const { v, inspect } = fixture();
  expect(() => inspect(...Array.from({ length: count }, () => v.none))).toThrow("type() takes 1 or 3 arguments");
});

it("rejects inspection keywords before classification", () => {
  const { v, keywords, classifications, inspect } = fixture(); keywords.items.set(v.string("x"), v.true);
  expect(() => inspect(v.none)).toThrow("type() takes no keyword arguments");
  expect(classifications).toEqual([]);
});

it("observes cancellation after native type classification", () => {
  const controller = new AbortController(), { v, cls, special, inspect } = fixture(controller.signal);
  special.typeOf = () => { controller.abort(); return cls; };
  expect(() => inspect(v.none)).toThrow("execution cancelled");
});
