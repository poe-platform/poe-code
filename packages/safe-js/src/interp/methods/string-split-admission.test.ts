import { expect, it, vi } from "vitest";
import { Budget } from "../budget.js";
import { callStringMethod } from "./string.js";

it.each(["", ",", "aa"])("rejects large splits on %j before native allocation", separator => {
  const value = separator === "" ? "a".repeat(100000) : (`b${separator}`).repeat(50000);
  const nativeSplit = vi.spyOn(String.prototype, "split");
  let calls: number;
  try {
    expect(() => callStringMethod(value, "split", [separator], new Budget({ arrayLength: 2 })))
      .toThrow(expect.objectContaining({ budget: "arrayLength", current: expect.any(Number), limit: 2 }));
    calls = nativeSplit.mock.calls.length;
  } finally {
    nativeSplit.mockRestore();
  }
  expect(calls).toBe(0);
});

it("preserves native literal split semantics at every host and guest limit boundary", () => {
  for (const value of ["", "a", "a,b,", ",,", "aaaa", "🧪"]) {
    for (const separator of [undefined, "", ",", "aa", "missing"]) {
      for (const limit of [0, 1, 2, 3, undefined]) {
        const expected = value.split(separator as string, limit);
        for (const arrayLength of [0, 1, 2, 3, 6]) {
          const split = () => callStringMethod(value, "split", [separator, limit], new Budget({ arrayLength }));
          if (expected.length > arrayLength) {
            expect(split).toThrow(expect.objectContaining({ budget: "arrayLength" }));
          } else {
            expect(split()).toEqual(expected);
          }
        }
      }
    }
  }
});

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
