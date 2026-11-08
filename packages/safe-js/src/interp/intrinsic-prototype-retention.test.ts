import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { registerIntrinsicObject, setSandboxPrototype, releaseObjectPrototype } from "./object-model.js";

it("does not repeatedly look up tracked intrinsic prototypes when retaining data", () => {
  const budget = new Budget();
  const root = {};
  registerIntrinsicObject(budget, root);
  const get = vi.spyOn(WeakMap.prototype, "get");
  try {
    const values = [...budget.retainedValues()];
    const reads = get.mock.calls.filter(([key]) => key === root).length;
    get.mockRestore();
    expect(values).toEqual([]);
    expect(reads).toBe(0);
  } finally {
    get.mockRestore();
    releaseObjectPrototype(budget);
  }
});

it("observes prototype replacement and removal across multiple tracking owners", () => {
  const first = new Budget();
  const second = new Budget();
  const root = {};
  registerIntrinsicObject(first, root);
  registerIntrinsicObject(second, root);
  try {
    for (const parent of [{data: "first"}, {data: "second"}, null]) {
      setSandboxPrototype(root, parent);
      expect([...first.retainedValues()]).toEqual(parent === null ? [] : [parent]);
      expect([...second.retainedValues()]).toEqual(parent === null ? [] : [parent]);
    }
  } finally {
    releaseObjectPrototype(first);
    releaseObjectPrototype(second);
  }
});

it("does not retain prototypes from rejected cyclic or non-extensible writes", () => {
  const budget = new Budget();
  const root = {};
  const parent = {data: "kept"};
  registerIntrinsicObject(budget, root);
  try {
    setSandboxPrototype(root, parent);
    expect(setSandboxPrototype(parent, root, undefined, false)).toBe(false);
    expect([...budget.retainedValues()]).toEqual([parent]);
    Object.preventExtensions(root);
    expect(setSandboxPrototype(root, {data: "rejected"}, undefined, false)).toBe(false);
    expect([...budget.retainedValues()]).toEqual([parent]);
    expect(() => setSandboxPrototype(root, null)).toThrow();
    expect([...budget.retainedValues()]).toEqual([parent]);
  } finally {
    releaseObjectPrototype(budget);
  }
});
