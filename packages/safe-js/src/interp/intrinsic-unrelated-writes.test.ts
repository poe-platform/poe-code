import { expect, it, vi } from "vitest";
import { Budget, SandboxError } from "./budget.js";
import {
  createIntrinsicObject,
  materializeFunctionProperties,
  registerIntrinsicObject,
  releaseObjectPrototype
} from "./object-model.js";
import { createSandboxClosure, reconcileCompiledValues } from "./values.js";

it("keeps intrinsic roots cached across unrelated function-table writes", () => {
  const budget = new Budget();
  const registration = vi.spyOn(budget, "setRetainedValues");
  const root = createIntrinsicObject();
  registerIntrinsicObject(budget, root);
  const collect = registration.mock.calls.at(-1)![1]!;
  const unrelated = materializeFunctionProperties(
    createSandboxClosure({ guest: true, call: () => undefined })
  );
  root.extra = "retained";
  try {
    const captured = collect();
    unrelated.extra = "written";
    expect(collect()).toBe(captured);
    delete unrelated.extra;
    expect(collect()).toBe(captured);
    Object.defineProperty(unrelated, Symbol("custom"), { value: "symbol" });
    expect(collect()).toBe(captured);
    root.extra = "changed";
    expect(collect()).not.toBe(captured);
    expect([...collect()!]).toEqual(["extra", "changed"]);
  } finally {
    registration.mockRestore();
    releaseObjectPrototype(budget);
  }
});

it("starts invalidating a function table when it becomes a registered method", () => {
  const budget = new Budget();
  const root = createIntrinsicObject();
  const method = createSandboxClosure({ guest: true, call: () => undefined });
  const properties = materializeFunctionProperties(method);
  properties.extra = "baseline";
  root.method = method;
  registerIntrinsicObject(budget, root);
  try {
    expect([...budget.retainedValues()]).toEqual([]);
    properties.extra = "updated";
    expect([...budget.retainedValues()]).toEqual(["extra", "updated"]);
    delete properties.extra;
    expect([...budget.retainedValues()]).toEqual([]);
  } finally {
    releaseObjectPrototype(budget);
  }
});

it("remeasures unrelated function properties retained below cached roots", () => {
  const budget = new Budget({ dataSize: 100 });
  const root = createIntrinsicObject();
  registerIntrinsicObject(budget, root);
  const method = createSandboxClosure({ guest: true, call: () => undefined });
  root.extra = method;
  try {
    reconcileCompiledValues(budget, []);
    materializeFunctionProperties(method).payload = "x".repeat(200);
    expect(() => reconcileCompiledValues(budget, [])).toThrow(SandboxError);
  } finally {
    releaseObjectPrototype(budget);
  }
});

it("keeps shared registered tables current after one budget closes", () => {
  const first = new Budget();
  const second = new Budget();
  const root = createIntrinsicObject();
  registerIntrinsicObject(first, root);
  registerIntrinsicObject(second, root);
  try {
    expect([...first.retainedValues()]).toEqual([]);
    expect([...second.retainedValues()]).toEqual([]);
    releaseObjectPrototype(first);
    root.extra = "still live";
    expect([...second.retainedValues()]).toEqual(["extra", "still live"]);
  } finally {
    releaseObjectPrototype(first);
    releaseObjectPrototype(second);
  }
});
