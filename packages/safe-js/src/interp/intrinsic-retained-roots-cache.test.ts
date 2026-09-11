import { expect, it, vi } from "vitest";
import { Budget, SandboxError } from "./budget.js";
import { accessorAdapter } from "./accessors.js";
import { completeIntrinsicObjectInitialization, createIntrinsicObject, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, releaseObjectPrototype, setSandboxPrototype } from "./object-model.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues, type SandboxObject } from "./values.js";

it("reuses the collected roots while still rejecting nested growth above the memory limit", () => {
  const budget = new Budget({ dataSize: 100 });
  const registration = vi.spyOn(budget, "setRetainedValues");
  const root = createIntrinsicObject();
  registerIntrinsicObject(budget, root);
  const collect = registration.mock.calls.at(-1)![1]!;
  const nested = { payload: "small" };
  root.extra = nested;
  try {
    const roots = collect();
    expect([...roots]).toEqual(["extra", nested]);
    expect(collect()).toBe(roots);
    reconcileCompiledValues(budget, []);
    nested.payload = "x".repeat(200);
    expect(collect()).toBe(roots);
    expect(() => reconcileCompiledValues(budget, [])).toThrow(SandboxError);
  } finally { registration.mockRestore(); releaseObjectPrototype(budget); }
});

it("refreshes collected roots after define, delete, accessors, prototype changes and baseline completion", () => {
  const budget = new Budget();
  const root = createIntrinsicObject();
  registerIntrinsicObject(budget, root);
  const read = vi.fn(() => undefined);
  const getter = createSandboxClosure({ guest: true, call: read, retainedValues: () => ["captured"] });
  const parent = { payload: "parent" };
  try {
    expect([...budget.retainedValues()]).toEqual([]);
    Object.defineProperty(root, "extra", { value: "defined", configurable: true });
    expect([...budget.retainedValues()]).toEqual(["extra", "defined"]);
    delete root.extra;
    expect([...budget.retainedValues()]).toEqual([]);
    Object.defineProperty(root, "extra", { get: accessorAdapter(getter, "get"), configurable: true });
    expect([...budget.retainedValues()]).toEqual(["extra", undefined, getter]);
    setSandboxPrototype(root, parent, budget);
    expect([...budget.retainedValues()]).toEqual([parent, "extra", undefined, getter]);
    completeIntrinsicObjectInitialization(budget, root);
    expect([...budget.retainedValues()]).toEqual([]);
    delete root.extra;
    setSandboxPrototype(root, null, budget);
    expect([...budget.retainedValues()]).toEqual([null]);
    expect(read).not.toHaveBeenCalled();
  } finally { releaseObjectPrototype(budget); }
});

it("remeasures mutations through an untracked restored property-table alias", () => {
  const budget = new Budget();
  const method = createSandboxClosure({ guest: true, name: "restored", call: () => undefined });
  const restored: SandboxObject = { name: "restored" };
  expect(materializeFunctionProperties(method, restored)).toBe(restored);
  registerIntrinsicFunction(budget, method);
  try {
    expect([...budget.retainedValues()]).toEqual([]);
    restored.extra = "first";
    expect([...budget.retainedValues()]).toEqual(["extra", "first"]);
    restored.extra = "longer";
    expect(measureSandboxData(budget.retainedValues())).toBe(11);
    delete restored.extra;
    expect([...budget.retainedValues()]).toEqual([]);
  } finally { releaseObjectPrototype(budget); }
});

it("keeps committed roots after failed definitions and deletions", () => {
  const budget = new Budget();
  const root = createIntrinsicObject();
  registerIntrinsicObject(budget, root);
  try {
    Object.defineProperty(root, "locked", { value: "retained", configurable: false, writable: false });
    expect([...budget.retainedValues()]).toEqual(["locked", "retained"]);
    expect(Reflect.defineProperty(root, "locked", { value: "replacement" })).toBe(false);
    expect(Reflect.deleteProperty(root, "locked")).toBe(false);
    Object.preventExtensions(root);
    expect(Reflect.defineProperty(root, "new", { value: "uncommitted" })).toBe(false);
    expect([...budget.retainedValues()]).toEqual(["locked", "retained"]);
  } finally { releaseObjectPrototype(budget); }
});

it("keeps both budgets current and ignores rejected prototype mutations", () => {
  const first = new Budget();
  const second = new Budget();
  const root = createIntrinsicObject();
  registerIntrinsicObject(first, root);
  registerIntrinsicObject(second, root);
  const parent = { retained: "parent" };
  try {
    expect([...first.retainedValues()]).toEqual([]);
    expect([...second.retainedValues()]).toEqual([]);
    setSandboxPrototype(root, parent);
    expect([...first.retainedValues()]).toEqual([parent]);
    expect([...second.retainedValues()]).toEqual([parent]);
    expect(setSandboxPrototype(parent, root, undefined, false)).toBe(false);
    Object.preventExtensions(root);
    expect(setSandboxPrototype(root, {}, undefined, false)).toBe(false);
    expect([...first.retainedValues()]).toEqual([parent]);
    releaseObjectPrototype(first);
    expect([...second.retainedValues()]).toEqual([parent]);
  } finally { releaseObjectPrototype(first); releaseObjectPrototype(second); }
});

it("keeps root snapshots stable when a retained callback mutates the next collection", () => {
  const budget = new Budget();
  const root = createIntrinsicObject();
  registerIntrinsicObject(budget, root);
  root.first = createSandboxClosure({ call: () => undefined, retainedValues: () => {
    root.later = "z".repeat(100);
    return [];
  } });
  root.later = "initial";
  try {
    expect(measureSandboxData(budget.retainedValues())).toBe(18);
    expect(measureSandboxData(budget.retainedValues())).toBe(111);
  } finally { releaseObjectPrototype(budget); }
});
