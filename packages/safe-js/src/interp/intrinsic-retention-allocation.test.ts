import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { accessorAdapter } from "./accessors.js";
import { materializeFunctionProperties, registerIntrinsicObject, releaseObjectPrototype, setSandboxPrototype } from "./object-model.js";
import { createSandboxClosure, measureSandboxData, type SandboxObject } from "./values.js";

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
