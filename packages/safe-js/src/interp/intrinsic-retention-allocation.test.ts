import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { accessorAdapter } from "./accessors.js";
import { materializeFunctionProperties, registerIntrinsicObject, releaseObjectPrototype, setSandboxPrototype } from "./object-model.js";
import { createSandboxClosure, measureSandboxData, type SandboxObject } from "./values.js";

it("reuses unchanged function descriptor captures and observes native table writes", () => {
  const budget = new Budget();
  const method = createSandboxClosure({ guest: true, name: "method", call: () => undefined });
  const properties = materializeFunctionProperties(method);
  registerIntrinsicObject(budget, { method });
  properties.extra = { nested: "initial" };
  const first = measureSandboxData(budget.retainedValues());
  const descriptor = vi.spyOn(Object, "getOwnPropertyDescriptor");
  try {
    expect(measureSandboxData(budget.retainedValues())).toBe(first);
    const tableReads = descriptor.mock.calls.filter(([target]) => target === properties).length;
    expect(tableReads).toBe(0);
    (properties.extra as SandboxObject).nested = "x".repeat(100);
    expect(measureSandboxData(budget.retainedValues())).toBe(first + 93);
    properties.extra = "replacement";
    expect([...budget.retainedValues()]).toEqual(["extra", "replacement"]);
    Object.defineProperty(properties, "extra", { value: "defined" });
    expect([...budget.retainedValues()]).toEqual(["extra", "defined"]);
    delete properties.extra;
    expect([...budget.retainedValues()]).toEqual([]);
    const key = Symbol("host");
    properties[key] = "symbol";
    expect([...budget.retainedValues()]).toEqual([key, "symbol"]);
    Object.freeze(properties);
    expect([...budget.retainedValues()]).toContain("symbol");
  } finally {
    descriptor.mockRestore();
    releaseObjectPrototype(budget);
  }
});

it("captures intrinsic changes without nested flattening allocations", () => {
  const budget = new Budget();
  const method = createSandboxClosure({ guest: true, name: "method", call: () => undefined });
  const root: SandboxObject = { method };
  registerIntrinsicObject(budget, root);
  root.extra = "retained";
  const flatten = vi.spyOn(Array.prototype, "flatMap");
  try {
    const retained = [...budget.retainedValues()];
    const calls = flatten.mock.calls.length;
    flatten.mockRestore();
    expect(retained).toEqual(["extra", "retained"]);
    expect(calls).toBe(0);
  } finally {
    flatten.mockRestore();
    releaseObjectPrototype(budget);
  }
});

it("invalidates native accessor and flag changes without invoking accessors", () => {
  const budget = new Budget();
  const method = createSandboxClosure({ guest: true, name: "method", call: () => undefined });
  const properties = materializeFunctionProperties(method);
  registerIntrinsicObject(budget, { method });
  const call = vi.fn(() => undefined);
  const getter = createSandboxClosure({ guest: true, call, retainedValues: () => ["captured"] });
  try {
    expect([...budget.retainedValues()]).toEqual([]);
    Object.defineProperty(properties, "name", { enumerable: true });
    expect([...budget.retainedValues()]).toEqual(["name", "method"]);
    Object.defineProperty(properties, "name", { enumerable: false });
    expect([...budget.retainedValues()]).toEqual([]);
    Object.defineProperty(properties, "extra", { get: accessorAdapter(getter, "get"), configurable: true });
    expect([...budget.retainedValues()]).toEqual(["extra", undefined, getter]);
    expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(7);
    const parent = { retained: "parent" };
    setSandboxPrototype(method, parent, budget);
    expect([...budget.retainedValues()]).toContain(parent);
    Object.preventExtensions(properties);
    expect(Reflect.defineProperty(properties, "missing", { value: "not retained" })).toBe(false);
    expect([...budget.retainedValues()]).not.toContain("not retained");
    expect(call).not.toHaveBeenCalled();
  } finally { releaseObjectPrototype(budget); }
});

it("captures cached function mutations before callbacks and refreshes on the next measurement", () => {
  const budget = new Budget();
  const method = createSandboxClosure({ guest: true, name: "method", call: () => undefined });
  const properties = materializeFunctionProperties(method);
  const root: SandboxObject = { method };
  registerIntrinsicObject(budget, root);
  properties.later = "initial";
  // Populate the descriptor capture before another retained value mutates it.
  expect([...budget.retainedValues()]).toEqual(["later", "initial"]);
  root.first = createSandboxClosure({ call: () => undefined, retainedValues: () => {
    properties.later = "z".repeat(100);
    return [];
  } });
  try {
    expect(measureSandboxData(budget.retainedValues())).toBe(18);
    expect(measureSandboxData(budget.retainedValues())).toBe(111);
  } finally { releaseObjectPrototype(budget); }
});

it("captures all intrinsic changes before retained callbacks mutate later values", () => {
  const budget = new Budget();
  const root: SandboxObject = {};
  registerIntrinsicObject(budget, root);
  root.first = createSandboxClosure({call: () => undefined, retainedValues: () => {
    root.later = "z".repeat(100);
    return [];
  }});
  root.later = "initial";
  try {
    expect(measureSandboxData(budget.retainedValues())).toBe(18);
    expect(root.later).toHaveLength(100);
  } finally { releaseObjectPrototype(budget); }
});

it("retains changed descriptors, accessor captures and prototype roots without invoking getters", () => {
  const budget = new Budget();
  const method = createSandboxClosure({ guest: true, name: "method", call: () => undefined });
  const root: SandboxObject = { method };
  registerIntrinsicObject(budget, root);
  const getterCall = vi.fn(() => undefined);
  const getter = createSandboxClosure({ guest: true, call: getterCall, retainedValues: () => ["x".repeat(100)] });
  const key = Symbol("extra");
  const parent = { parent: "kept" };
  try {
    expect([...budget.retainedValues()]).toEqual([]);
    root[key] = "symbol value";
    Object.defineProperty(root, "hidden", { get: accessorAdapter(getter, "get"), configurable: true });
    materializeFunctionProperties(method).label = "method value";
    setSandboxPrototype(root, parent, budget);
    const retained = [...budget.retainedValues()];
    expect(retained).toContain(parent);
    expect(retained).toContain(key);
    expect(retained).toContain("symbol value");
    expect(retained).toContain(getter);
    expect(retained).toContain("method value");
    expect(measureSandboxData(retained)).toBeGreaterThan(100);
    expect(getterCall).not.toHaveBeenCalled();
  } finally { releaseObjectPrototype(budget); }
});
