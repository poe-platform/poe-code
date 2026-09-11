import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { createSandboxBox } from "./boxed.js";
import { intrinsicDataRoots } from "./intrinsic-data-roots.js";
import { createIntrinsicObject, registerIntrinsicObject, releaseObjectPrototype } from "./object-model.js";

it("does not repeatedly delete projections that were never installed", () => {
  const budget = new Budget();
  registerIntrinsicObject(budget, createIntrinsicObject(), false);
  const remove = vi.spyOn(intrinsicDataRoots, "delete");
  try {
    expect([...budget.retainedValues()]).toEqual([]);
    expect([...budget.retainedValues()]).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  } finally { remove.mockRestore(); releaseObjectPrototype(budget); }
});

it("retires a boxed projection once and can install it again", () => {
  const budget = new Budget();
  const box = createSandboxBox(0);
  registerIntrinsicObject(budget, box, false);
  box.extra = "abc";
  const [root] = [...budget.retainedValues()] as object[];
  expect(intrinsicDataRoots.get(root)?.values).toContain("abc");
  delete box.extra;
  const remove = vi.spyOn(intrinsicDataRoots, "delete");
  try {
    expect([...budget.retainedValues()]).toEqual([]);
    expect(intrinsicDataRoots.has(root)).toBe(false);
    expect([...budget.retainedValues()]).toEqual([]);
    expect(remove).toHaveBeenCalledTimes(1);
    box.extra = "replacement";
    expect([...budget.retainedValues()]).toEqual([root]);
    expect(intrinsicDataRoots.get(root)?.values).toContain("replacement");
    delete box.extra;
    expect([...budget.retainedValues()]).toEqual([]);
    expect(remove).toHaveBeenCalledTimes(2);
  } finally { remove.mockRestore(); releaseObjectPrototype(budget); }
});
