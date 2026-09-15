import { expect, it } from "vitest";
import { finalizeRuntimeType } from "./runtime-type-finalization.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { PythonRuntimeError } from "./error.js";
import type { DescriptorSlots } from "./instance-attributes.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000, signal }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter), dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const type = (name: string, bases = [registry.object]) => registry.publish(new RuntimeTypeLayout(name, bases.map(base => base.value), dictionary(), meter), registry.type);
  const base = type("Base"), cls = type("C", [base]), descriptorType = type("Descriptor"), events: string[] = [];
  const slots = new Map<RuntimeValue, DescriptorSlots<RuntimeValue, RuntimeValue, RuntimeValue>>(), keywords = dictionary();
  const special = { typeOf: () => registry.object, slots: (value: RuntimeValue) => slots.get(value) };
  const call = (callee: RuntimeValue, args: readonly RuntimeValue[], named = dictionary()) => { if (callee.kind !== "builtin_function_or_method") throw new PythonRuntimeError("TypeError", "not callable"); return callee.value.invoke(args, named, meter); };
  const context = { call, repr(value: RuntimeValue) { if (value.kind !== "str") throw Error("unexpected repr"); return `'${String.fromCodePoint(...value.value)}'`; } };
  const finish = () => finalizeRuntimeType(cls, keywords, special, v, meter, context);
  return { v, meter, registry, dictionary, type, base, cls, descriptorType, events, slots, keywords, special, context, finish };
}

it("calls set-name on the original own namespace snapshot before inherited subclass initialization", () => {
  const s = fixture(), first = s.v.instance(s.descriptorType), second = s.v.instance(s.descriptorType), late = s.v.instance(s.descriptorType);
  const method = s.v.cell({}); s.descriptorType.value.namespace.items.set(s.v.string("__set_name__"), method);
  s.slots.set(method, { get(receiver) { return s.v.builtinFunction({ name: "set_name", invoke(args) {
    expect(args[0]).toBe(s.cls); const name = args[1]; if (name.kind !== "str") throw Error("expected name"); s.events.push(String.fromCodePoint(...name.value));
    if (receiver === first) { s.cls.value.namespace.items.delete(s.v.string("second")); s.cls.value.namespace.items.set(s.v.string("late"), late); } return s.v.true;
  } }); } });
  s.cls.value.namespace.items.set(s.v.string("first"), first); s.cls.value.namespace.items.set(s.v.string("second"), second);
  s.base.value.namespace.items.set(s.v.string("inherited"), late);
  s.base.value.namespace.items.set(s.v.string("__init_subclass__"), s.v.builtinFunction({ name: "subclass", invoke(args, keywords) { expect(args).toEqual([]); expect(keywords).toBe(s.keywords); s.events.push("subclass"); return s.v.true; } }));
  s.finish(); expect(s.events).toEqual(["first", "second", "subclass"]);
});

it("looks up init-subclass after descriptor effects, skipping the new class's own hook", () => {
  const s = fixture(), descriptor = s.v.instance(s.descriptorType), slot = s.v.builtinFunction({ name: "set_name", invoke() {
    s.base.value.namespace.items.set(s.v.string("__init_subclass__"), s.v.builtinFunction({ name: "late", invoke() { s.events.push("late"); return s.v.none; } })); return s.v.none;
  } });
  s.descriptorType.value.namespace.items.set(s.v.string("__set_name__"), slot); s.cls.value.namespace.items.set(s.v.string("x"), descriptor);
  s.cls.value.namespace.items.set(s.v.string("__init_subclass__"), s.v.none); s.finish(); expect(s.events).toEqual(["late"]);
});

it("binds inherited class descriptors with the new class as owner and preserves keywords", () => {
  const s = fixture(), slot = s.v.cell({}); s.base.value.namespace.items.set(s.v.string("__init_subclass__"), slot); s.keywords.items.set(s.v.string("flag"), s.v.true);
  s.slots.set(slot, { get(instance, owner) { expect(instance).toBeNull(); expect(owner).toBe(s.cls); return s.v.builtinFunction({ name: "subclass", invoke(args, keywords) { expect(args).toEqual([]); expect(keywords).toBe(s.keywords); s.events.push("called"); return s.v.none; } }); } });
  s.finish(); expect(s.events).toEqual(["called"]);
});

it("preserves hook errors and appends the CPython set-name note", () => {
  const s = fixture(), error = new PythonRuntimeError("ValueError", "bad"), descriptor = s.v.instance(s.descriptorType);
  s.descriptorType.value.namespace.items.set(s.v.string("__set_name__"), s.v.builtinFunction({ name: "set_name", invoke() { throw error; } }));
  s.cls.value.namespace.items.set(s.v.string("x"), descriptor); expect(s.finish).toThrow(error);
  expect(error.notes).toEqual(["Error calling __set_name__ on 'Descriptor' instance 'x' in 'C'"]);
});

it("propagates descriptor-binding failures without adding call-failure notes", () => {
  const s = fixture(), error = new PythonRuntimeError("AttributeError", "binding"), slot = s.v.cell({});
  s.descriptorType.value.namespace.items.set(s.v.string("__set_name__"), slot); s.slots.set(slot, { get() { throw error; } });
  s.cls.value.namespace.items.set(s.v.string("x"), s.v.instance(s.descriptorType));
  expect(s.finish).toThrow(error); expect(error.notes).toBeUndefined();
});

it("propagates note-formatting failures in place of the pending hook exception", () => {
  const s = fixture(), error = new PythonRuntimeError("ValueError", "hook"), replacement = new PythonRuntimeError("ValueError", "repr");
  s.descriptorType.value.namespace.items.set(s.v.string("__set_name__"), s.v.builtinFunction({ name: "set_name", invoke() { throw error; } }));
  s.cls.value.namespace.items.set(s.v.string("x"), s.v.instance(s.descriptorType)); s.context.repr = () => { throw replacement; };
  expect(s.finish).toThrow(replacement); expect(error.notes).toBeUndefined();
});

it("does not annotate host termination errors", () => {
  const s = fixture(), error = Error("host fault");
  s.descriptorType.value.namespace.items.set(s.v.string("__set_name__"), s.v.builtinFunction({ name: "set_name", invoke() { throw error; } }));
  s.cls.value.namespace.items.set(s.v.string("x"), s.v.instance(s.descriptorType)); s.context.repr = () => { throw Error("must not format host faults"); };
  expect(s.finish).toThrow(error);
});

it("applies the default subclass keyword rejection only after descriptor hooks", () => {
  const s = fixture(); s.keywords.items.set(s.v.string("flag"), s.v.true);
  s.descriptorType.value.namespace.items.set(s.v.string("__set_name__"), s.v.builtinFunction({ name: "set_name", invoke() { s.events.push("set_name"); return s.v.none; } }));
  s.cls.value.namespace.items.set(s.v.string("x"), s.v.instance(s.descriptorType));
  expect(s.finish).toThrow("C.__init_subclass__() takes no keyword arguments"); expect(s.events).toEqual(["set_name"]);
});

it("observes cancellation after a descriptor hook without invoking subclass initialization", () => {
  const controller = new AbortController(), s = fixture(controller.signal);
  s.descriptorType.value.namespace.items.set(s.v.string("__set_name__"), s.v.builtinFunction({ name: "set_name", invoke() { controller.abort(); return s.v.none; } }));
  s.cls.value.namespace.items.set(s.v.string("x"), s.v.instance(s.descriptorType));
  expect(s.finish).toThrow("execution cancelled");
});

it("resolves each captured descriptor's set-name method live", () => {
  const s = fixture(), descriptor = s.v.instance(s.descriptorType);
  s.descriptorType.value.namespace.items.set(s.v.string("__set_name__"), s.v.builtinFunction({ name: "first", invoke() {
    s.events.push("first"); s.descriptorType.value.namespace.items.set(s.v.string("__set_name__"), s.v.builtinFunction({ name: "second", invoke() { s.events.push("second"); return s.v.none; } })); return s.v.none;
  } }));
  s.cls.value.namespace.items.set(s.v.string("x"), descriptor); s.cls.value.namespace.items.set(s.v.string("y"), descriptor);
  s.finish(); expect(s.events).toEqual(["first", "second"]);
});

it("preserves existing notes and truncates diagnostic type names at 100 UTF-8 bytes", () => {
  const s = fixture(), error = new PythonRuntimeError("ValueError", "bad"); error.addNote("earlier", s.meter);
  s.descriptorType.value.names.set("__name__", s.v.string("é".repeat(100)), s.meter); s.cls.value.names.set("__name__", s.v.string("𐀀".repeat(100)), s.meter);
  s.descriptorType.value.namespace.items.set(s.v.string("__set_name__"), s.v.builtinFunction({ name: "set_name", invoke() { throw error; } }));
  s.cls.value.namespace.items.set(s.v.string("x"), s.v.instance(s.descriptorType)); expect(s.finish).toThrow(error);
  expect(error.notes).toEqual(["earlier", `Error calling __set_name__ on '${"é".repeat(50)}' instance 'x' in '${"𐀀".repeat(25)}'`]);
});

it("uses the complete qualified class name for default subclass keyword diagnostics", () => {
  const s = fixture(), name = `Outer.${"C".repeat(300)}`; s.cls.value.names.set("__qualname__", s.v.string(name), s.meter); s.keywords.items.set(s.v.string("flag"), s.v.true);
  expect(s.finish).toThrow(`${name}.__init_subclass__() takes no keyword arguments`);
});

it("does not add set-name notes to subclass initialization errors", () => {
  const s = fixture(), error = new PythonRuntimeError("ValueError", "subclass");
  s.base.value.namespace.items.set(s.v.string("__init_subclass__"), s.v.builtinFunction({ name: "subclass", invoke() { throw error; } }));
  expect(s.finish).toThrow(error); expect(error.notes).toBeUndefined();
});

it("treats an explicitly disabled inherited subclass hook as a call error", () => {
  const s = fixture(); s.base.value.namespace.items.set(s.v.string("__init_subclass__"), s.v.none); expect(s.finish).toThrow("not callable");
});
