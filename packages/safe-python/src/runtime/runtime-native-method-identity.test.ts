import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeHash } from "./runtime-hash.js";
import { getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), receiver = v.list([]);
  const invoke = () => v.none;
  const descriptor = v.methodDescriptor({ owner: registry.object, name: "method", accepts: () => true, invoke });
  const bind = (instance = receiver, method = descriptor) => getRuntimeMethodDescriptor(method, instance, v.none, v, meter);
  const identities = new Map<RuntimeValue, bigint>();
  const hash = (value: RuntimeValue) => runtimeHash(value, { none: v.none, identity(item) { let id = identities.get(item); if (id === undefined) identities.set(item, id = BigInt(identities.size + 17)); return id; }, string: () => 1n, bytes: () => 1n }, meter);
  return { v, meter, registry, receiver, descriptor, invoke, bind, hash, keys };
}

it("compares repeated native bindings by function and receiver identity", () => {
  const { v, meter, bind } = fixture(), first = bind(), second = bind(), other = bind(v.list([]));
  expect(first === second).toBe(false);
  expect(runtimeComparison("==", first, second, v, meter)).toBe(v.true);
  expect(runtimeComparison("!=", first, second, v, meter)).toBe(v.false);
  expect(runtimeComparison("==", first, other, v, meter)).toBe(v.false);
});

it("hashes equal bindings equally without hashing their unhashable receiver", () => {
  const { bind, hash } = fixture();
  expect(hash(bind())).toBe(hash(bind()));
});

it("preserves native implementation identity across distinct descriptor aliases", () => {
  const { v, meter, registry, invoke, bind, receiver, hash } = fixture();
  const alias = v.methodDescriptor({ owner: registry.object, name: "alias", accepts: () => true, invoke });
  const first = bind(), second = bind(receiver, alias);
  expect(runtimeComparison("==", first, second, v, meter)).toBe(v.true);
  expect(hash(first)).toBe(hash(second));
});

it("distinguishes different native implementations and ordinary builtin functions", () => {
  const { v, meter, registry, bind, receiver } = fixture();
  const other = v.methodDescriptor({ owner: registry.object, name: "method", accepts: () => true, invoke: () => v.none });
  const first = bind(), ordinary = v.builtinFunction({ name: "method", invoke: () => v.none });
  expect(runtimeComparison("==", first, bind(receiver, other), v, meter)).toBe(v.false);
  expect(runtimeComparison("==", first, ordinary, v, meter)).toBe(v.false);
  expect(runtimeComparison("==", ordinary, ordinary, v, meter)).toBe(v.true);
});

it("deduplicates repeated native method keys in ordered dictionaries", () => {
  const { v, meter, bind, hash, keys } = fixture();
  const items = new OrderedKeyMap<RuntimeValue, RuntimeValue>({ ...keys, hash }, meter);
  items.set(bind(), v.true); items.set(bind(), v.false);
  expect(items.size).toBe(1); expect(items.lookup(bind())?.value).toBe(v.false);
});

it("normalizes the combined native identity hash only after XOR", () => {
  const { v, meter, bind, receiver } = fixture();
  expect(runtimeHash(bind(), { none: v.none, identity: item => item === receiver ? 0n : -1n, string: () => 1n, bytes: () => 1n }, meter)).toBe(-2n);
});

it("does not expose mutable native binding records", () => {
  const { bind } = fixture(), method = bind();
  if (method.kind !== "builtin_function_or_method") throw Error("expected native method");
  expect(Object.isFrozen(method)).toBe(true); expect(Object.isFrozen(method.binding)).toBe(true);
});

it.each(["<", "<=", ">", ">="])("declines native method ordering %s", operator => {
  const { v, meter, bind } = fixture();
  expect(() => runtimeComparison(operator, bind(), bind(), v, meter)).toThrow("not supported between instances");
  expect(runtimeComparison(operator, bind(), bind(), v, meter, 1000, { declineUnsupported: true })).toBe(v.notImplemented);
});
