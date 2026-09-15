import { expect, it, vi } from "vitest";
import { Budget } from "../budget.js";
import { callStringMethod } from "./string.js";

it("rejects an oversized string split before visiting its output strings", () => {
  const budget = new Budget({ arrayLength: 2 });
  const strings = vi.spyOn(budget, "allocateString");
  expect(() => callStringMethod("a,b,c", "split", [","], budget)).toThrow(
    expect.objectContaining({ budget: "arrayLength", current: 3, limit: 2 })
  );
  // Separator coercion is required even when the output container is rejected.
  expect(strings.mock.calls).toEqual([[","]]);
  expect([...budget.retainedValues()]).toEqual([]);
  expect(budget.currentDataSize).toBe(0);
  expect(budget.currentCallDepth).toBe(0);
});

it("keeps exact-limit strings and UTF-16 empty-separator slots", () => {
  const budget = new Budget({ arrayLength: 2, stringLength: 1 });
  expect(callStringMethod("a,b,c", "split", [",", 2], budget)).toEqual(["a", "b"]);
  expect(callStringMethod("🧪", "split", [""], budget)).toEqual(["\ud83e", "\uddea"]);
  expect(() => callStringMethod("aa,b", "split", [","], budget)).toThrow(
    expect.objectContaining({ budget: "stringLength", current: 2, limit: 1 })
  );
  expect([...budget.retainedValues()]).toEqual([]);
});

it("preserves trusted check suspension without truncating the split", () => {
  const budget = new Budget({ arrayLength: 1, stringLength: 1 });
  const resume = budget.suspendChecks();
  try {
    expect(callStringMethod("aa,bb,cc", "split", [","], budget)).toEqual(["aa", "bb", "cc"]);
  } finally {
    resume();
  }
  expect(() => callStringMethod("a,b", "split", [","], budget)).toThrow(
    expect.objectContaining({ budget: "arrayLength" })
  );
});
