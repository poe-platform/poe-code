import { expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { ExecutionBudget } from "./execution-budget.js";
import { runtimeInstanceAttribute, runtimeMutateInstanceAttribute } from "./runtime-instance-attributes.js";
import type { DescriptorSlots } from "./instance-attributes.js";

function fixture(dictionary = true, signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dict = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const registry = new RuntimeTypeRegistry(v, keys, meter), type = registry.publish(new RuntimeTypeLayout("C", [registry.object.value], dict(), meter), registry.type);
  const instance = v.instance(type, dictionary ? dict() : undefined), descriptor = v.cell({}), slots: DescriptorSlots<RuntimeValue, RuntimeValue, RuntimeValue> = {};
  const special = { typeOf(): never { throw Error("must use intrinsic owner"); }, slots: (value: RuntimeValue) => value === descriptor ? slots : undefined };
  const read = (name = "x") => runtimeInstanceAttribute(instance, name, v, meter, special);
  const set = (name = "x") => runtimeMutateInstanceAttribute(instance, name, { kind: "set", value: v.false }, v, meter, special);
  const remove = (name = "x") => runtimeMutateInstanceAttribute(instance, name, { kind: "delete" }, v, meter, special);
  return { meter, v, type, instance, descriptor, slots, read, set, remove };
}

it.each(Array.from({ length: 8 }, (_, mask) => mask))("preserves descriptor/dictionary precedence for slot mask %s", mask => {
  const { v, type, instance, descriptor, slots, read, set, remove } = fixture(), events: string[] = [];
  const get = (mask & 1) !== 0, write = (mask & 2) !== 0, del = (mask & 4) !== 0;
  if (get) Object.assign(slots, { get(receiver: RuntimeValue, owner: RuntimeValue) { expect(receiver).toBe(instance); expect(owner).toBe(type); events.push("get"); return v.false; } });
  if (write) Object.assign(slots, { set(receiver: RuntimeValue, value: RuntimeValue) { expect(receiver).toBe(instance); expect(value).toBe(v.false); events.push("set"); } });
  if (del) Object.assign(slots, { delete(receiver: RuntimeValue) { expect(receiver).toBe(instance); events.push("delete"); } });
  type.value.namespace.items.set(v.string("x"), descriptor); instance.dictionary!.items.set(v.string("x"), v.true);
  expect(read()).toBe(get && (write || del) ? v.false : v.true);
  if (!write && del) expect(set).toThrow("__set__"); else set();
  if (!del && write) expect(remove).toThrow("__delete__"); else remove();
  expect(events).toEqual([...(get && (write || del) ? ["get"] : []), ...(write ? ["set"] : []), ...(del ? ["delete"] : [])]);
  expect(instance.dictionary!.items.lookup(v.string("x"))?.value).toBe(write || del ? v.true : undefined);
});

it.each(["set", "delete"])("distinguishes dictionary-less missing and read-only attributes during %s", operation => {
  const { v, type, read, set, remove } = fixture(false), mutate = operation === "set" ? set : remove;
  type.value.namespace.items.set(v.string("present"), v.true);
  expect(read("present")).toBe(v.true);
  expect(() => mutate("present")).toThrow("'C' object attribute 'present' is read-only");
  expect(() => mutate("missing")).toThrow("'C' object has no attribute 'missing' and no __dict__ for setting new attributes");
  expect(() => read("missing")).toThrow("'C' object has no attribute 'missing'");
});

it("never deletes class attributes through a dictionary-backed instance", () => {
  const { v, type, instance, read, set, remove } = fixture();
  type.value.namespace.items.set(v.string("x"), v.true);
  expect(remove).toThrow("'C' object has no attribute 'x'");
  set(); expect(read()).toBe(v.false); remove(); expect(read()).toBe(v.true);
  expect(instance.dictionary!.items.size).toBe(0); expect(type.value.namespace.items.lookup(v.string("x"))!.value).toBe(v.true);
});

it.each(["get", "set", "delete"])("checks cancellation after descriptor %s effects", operation => {
  const controller = new AbortController(), { v, type, descriptor, slots, read, set, remove } = fixture(true, controller.signal); let effect = false;
  Object.assign(slots, { [operation]: () => { effect = true; controller.abort(); return v.true; } });
  type.value.namespace.items.set(v.string("x"), descriptor);
  expect(() => (operation === "get" ? read : operation === "set" ? set : remove)()).toThrow("execution cancelled");
  expect(effect).toBe(true);
});
