import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type BuiltinInvocationContext, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const allocator = registry.type.value.namespace.items.lookup(v.string("__new__"))!.value;
  if (allocator.kind !== "builtin_function_or_method") throw Error("expected native allocator");
  const call = (args: readonly RuntimeValue[], context?: BuiltinInvocationContext) => allocator.value.invoke(args, dictionary(), meter, context);
  return { v, meter, registry, dictionary, call };
}

it("validates the native metaclass receiver before arity and class arguments", () => {
  const { v, registry, call } = fixture();
  expect(() => call([])).toThrow("type.__new__(): not enough arguments");
  expect(() => call([v.none])).toThrow("type.__new__(X): X is not a type object (NoneType)");
  expect(() => call([registry.object])).toThrow("type.__new__(object): object is not a subtype of type");
  for (let count = 0; count <= 4; count++) if (count !== 3) expect(() => call([registry.type, ...Array.from({ length: count }, () => v.none)])).toThrow(`type.__new__() takes exactly 3 arguments (${count} given)`);
});

it("checks class arguments from left to right", () => {
  const { v, registry, call } = fixture();
  expect(() => call([registry.type, v.integer(1), v.none, v.none])).toThrow("type.__new__() argument 1 must be str, not int");
  expect(() => call([registry.type, v.string("C"), v.list([]), v.none])).toThrow("type.__new__() argument 2 must be tuple, not list");
  expect(() => call([registry.type, v.string("C"), v.tuple([]), v.list([])])).toThrow("type.__new__() argument 3 must be dict, not list");
});

it("keeps full receiver names but limits class-argument type diagnostics to 50 UTF-8 bytes", () => {
  const { v, meter, registry, dictionary, call } = fixture(), name = "X".repeat(300);
  const owner = registry.publish(new RuntimeTypeLayout(name, [registry.object.value], dictionary(), meter), registry.type), instance = v.instance(owner);
  expect(() => call([instance])).toThrow(`type.__new__(X): X is not a type object (${name})`);
  expect(() => call([registry.type, instance, v.tuple([]), dictionary()])).toThrow(`type.__new__() argument 1 must be str, not ${"X".repeat(50)}`);
  try { call([registry.type, instance, v.tuple([]), dictionary()]); } catch (error) { expect((error as Error).message).toHaveLength(93); }
});

it("rejects foreign bases and metaclasses before allocation", () => {
  const { v, registry, dictionary, call } = fixture(), foreign = fixture();
  expect(() => call([foreign.registry.type, v.string("C"), v.tuple([]), dictionary()])).toThrow("type layout is not published in this registry");
  expect(() => call([registry.type, v.string("C"), v.tuple([foreign.registry.object]), dictionary()])).toThrow("type layout is not published in this registry");
});

it("requires finalization before publishing a class cell and retains effects after cancellation", () => {
  const controller = new AbortController(), { v, registry, dictionary, call } = fixture(controller.signal), source = dictionary(), cell = v.cell({});
  source.items.set(v.string("__classcell__"), cell);
  const args = [registry.type, v.string("C"), v.tuple([]), source];
  expect(() => call(args)).toThrow("native type allocation requires class finalization"); expect(cell.value.content).toBeUndefined();
  let finalized = false;
  expect(() => call(args, { call: () => v.none, isStopIteration: () => false, finalizeType(type) {
    expect(cell.value.content?.value).toBe(type); finalized = true; controller.abort();
  } })).toThrow("execution cancelled");
  expect(finalized).toBe(true); expect(cell.value.content?.value.kind).toBe("type");
});
