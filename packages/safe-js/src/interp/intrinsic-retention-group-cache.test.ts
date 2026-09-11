import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { completeIntrinsicObjectInitialization, createIntrinsicObject, materializeFunctionProperties, registerIntrinsicObject, releaseObjectPrototype, setSandboxPrototype } from "./object-model.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";

it("reuses an unchanged tracked group's captured data while remeasuring nested values", () => {
  const budget = new Budget();
  const root = createIntrinsicObject();
  const register = vi.spyOn(budget, "setRetainedValues");
  registerIntrinsicObject(budget, root);
  const capture = register.mock.calls.find(([owner]) => owner === root)?.[1];
  if (capture === undefined) throw new Error("Missing retention source");
  try {
    const nested = { text: "a" };
    root.extra = nested;
    const first = capture();
    expect(first).toBeDefined();
    expect(capture()).toBe(first);
    const before = measureSandboxData(first!);
    nested.text = "longer";
    expect(capture()).toBe(first);
    expect(measureSandboxData(capture()!)).toBe(before + 5);
    root.extra = "replacement";
    expect(capture()).not.toBe(first);
    expect([...capture()!]).toContain("replacement");
  } finally { register.mockRestore(); releaseObjectPrototype(budget); }
});

it("invalidates tracked groups after prototype changes and baseline completion", () => {
  const budget = new Budget();
  const root = createIntrinsicObject();
  registerIntrinsicObject(budget, root);
  try {
    expect([...budget.retainedValues()]).toEqual([]);
    const parent = { text: "parent" };
    setSandboxPrototype(root, parent, budget);
    expect([...budget.retainedValues()]).toEqual([parent]);
    root.extra = "initialized";
    expect([...budget.retainedValues()]).toContain("initialized");
    completeIntrinsicObjectInitialization(budget, root);
    expect([...budget.retainedValues()]).toEqual([]);
    root.extra = "changed";
    expect([...budget.retainedValues()]).toEqual(["extra", "changed"]);
    delete root.extra;
    expect([...budget.retainedValues()]).toEqual([]);
  } finally { releaseObjectPrototype(budget); }
});

it("includes methods registered after an empty group was captured", () => {
  const budget = new Budget();
  const root = createIntrinsicObject();
  registerIntrinsicObject(budget, root);
  try {
    expect([...budget.retainedValues()]).toEqual([]);
    const method = createSandboxClosure({ guest: true, call: () => undefined });
    root.method = method;
    registerIntrinsicObject(budget, root);
    expect([...budget.retainedValues()]).toContain(method);
    materializeFunctionProperties(method).extra = "new capture";
    expect([...budget.retainedValues()]).toContain("new capture");
  } finally { releaseObjectPrototype(budget); }
});

it("captures tracked writes before callbacks and observes them on the next measurement", () => {
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
