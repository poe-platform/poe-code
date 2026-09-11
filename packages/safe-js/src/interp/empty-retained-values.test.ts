import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { registerIntrinsicObject, releaseObjectPrototype } from "./object-model.js";
import type { SandboxObject } from "./values.js";

it("does not allocate a result collection for unchanged intrinsic retention", () => {
  const budget = new Budget();
  const root: SandboxObject = {};
  const register = vi.spyOn(budget, "setRetainedValues");
  registerIntrinsicObject(budget, root);
  const capture = register.mock.calls.find(([owner]) => owner === root)?.[1];
  if (capture === undefined) throw new Error("Missing intrinsic retention source.");
  try {
    expect(capture()).toBeUndefined();
    expect(capture()).toBeUndefined();
    root.extra = "kept";
    expect(capture()).toEqual(["extra", "kept"]);
    delete root.extra;
    expect(capture()).toBeUndefined();
  } finally {
    register.mockRestore();
    releaseObjectPrototype(budget);
  }
});

it("rechecks empty sources on every measurement and can remove them", () => {
  const budget = new Budget();
  const owner = {};
  let values: unknown[] | undefined;
  const capture = vi.fn(() => values);
  budget.setRetainedValues(owner, capture);
  expect([...budget.retainedValues()]).toEqual([]);
  values = ["later"];
  expect([...budget.retainedValues()]).toEqual(["later"]);
  values = undefined;
  expect([...budget.retainedValues()]).toEqual([]);
  expect(capture).toHaveBeenCalledTimes(3);
  budget.setRetainedValues(owner, undefined);
  expect([...budget.retainedValues()]).toEqual([]);
  expect(capture).toHaveBeenCalledTimes(3);
});

it("still consumes custom iterators on empty arrays", () => {
  const budget = new Budget();
  const values: unknown[] = [];
  const iterate = vi.fn(function* () { yield "retained"; });
  values[Symbol.iterator] = iterate;
  budget.setRetainedValues({}, () => values);
  expect([...budget.retainedValues()]).toEqual(["retained"]);
  expect(iterate).toHaveBeenCalledOnce();
});

it("preserves source ordering and mutations during empty captures", () => {
  const budget = new Budget();
  const removed = {};
  const added = {};
  const later = vi.fn(() => ["removed"]);
  budget.setRetainedValues({}, () => {
    budget.setRetainedValues(removed, undefined);
    budget.setRetainedValues(added, () => ["added"]);
    return undefined;
  });
  budget.setRetainedValues(removed, later);
  expect([...budget.retainedValues()]).toEqual(["added"]);
  expect(later).not.toHaveBeenCalled();
});
