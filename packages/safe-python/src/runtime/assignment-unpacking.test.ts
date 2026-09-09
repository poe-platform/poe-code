import { describe, expect, it, vi } from "vitest";
import { unpackAssignment } from "./assignment-unpacking.js";
import { ExecutionBudget } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });

describe("iterator-driven assignment unpacking", () => {
  it("collects exact-count values, retaining undefined and identity", () => {
    const value = {};
    expect(unpackAssignment([value, undefined][Symbol.iterator](), 2, null, budget())).toEqual({ leading: [value, undefined], starred: undefined, trailing: [] });
  });

  it("consumes only one excess item before raising", () => {
    const iterator = [1, 2, 3, 4][Symbol.iterator]();
    expect(() => unpackAssignment(iterator, 2, null, budget())).toThrow("too many values to unpack (expected 2)");
    expect(iterator.next()).toEqual({ value: 4, done: false });
  });

  it("reports exact-count shortages", () => {
    expect(() => unpackAssignment([1][Symbol.iterator](), 3, null, budget())).toThrow("not enough values to unpack (expected 3, got 1)");
    expect(unpackAssignment([][Symbol.iterator](), 0, null, budget()).leading).toEqual([]);
    expect(() => unpackAssignment([1][Symbol.iterator](), 0, null, budget())).toThrow("too many values to unpack (expected 0)");
  });

  it.each([[0, 0], [0, 2], [2, 0], [2, 2]])("splits a star with %i leading and %i trailing values", (before, after) => {
    const input = [0, 1, 2, 3, 4];
    expect(unpackAssignment(input[Symbol.iterator](), before, after, budget())).toEqual({ leading: input.slice(0, before), starred: input.slice(before, input.length - after), trailing: input.slice(input.length - after) });
  });

  it("allows an empty starred list and reports minimum-count shortages", () => {
    expect(unpackAssignment([1, 2][Symbol.iterator](), 1, 1, budget())).toEqual({ leading: [1], starred: [], trailing: [2] });
    expect(() => unpackAssignment([1][Symbol.iterator](), 2, 1, budget())).toThrow("not enough values to unpack (expected at least 3, got 1)");
    expect(() => unpackAssignment([1, 2][Symbol.iterator](), 1, 2, budget())).toThrow("not enough values to unpack (expected at least 3, got 2)");
  });

  it("prepares remainder iteration only after the leading values have been obtained", () => {
    const iterator = [1, 2][Symbol.iterator]();
    const prepare = vi.fn(() => [8, 9][Symbol.iterator]());
    expect(unpackAssignment(iterator, 1, 1, budget(), prepare)).toEqual({ leading: [1], starred: [8], trailing: [9] });
    expect(prepare).toHaveBeenCalledOnce();
    expect(iterator.next().value).toBe(2);
    prepare.mockClear();
    expect(() => unpackAssignment([][Symbol.iterator](), 1, 0, budget(), prepare)).toThrow();
    expect(prepare).not.toHaveBeenCalled();
    unpackAssignment([][Symbol.iterator](), 0, null, budget(), prepare);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("propagates iterator errors without closing or restarting it", () => {
    const fault = new Error("iteration failed"), close = vi.fn();
    const iterator = { next: () => { throw fault; }, return: close };
    expect(() => unpackAssignment(iterator, 1, null, budget())).toThrow(fault);
    expect(close).not.toHaveBeenCalled();
  });

  it("checks budgets before every next and remainder-preparation call", () => {
    const next = vi.fn(() => ({ done: false, value: 1 })), prepare = vi.fn();
    expect(() => unpackAssignment({ next }, 0, 0, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 1000 }), prepare)).toThrow("execution step limit exceeded");
    expect(prepare).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(() => unpackAssignment({ next }, 0, 0, new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 1000 }))).toThrow("execution step limit exceeded");
    expect(next.mock.calls.length).toBeGreaterThan(0);
    expect(next.mock.calls.length).toBeLessThan(20);
  });

  it("rejects invalid host target counts before consuming input", () => {
    const next = vi.fn();
    for (const count of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => unpackAssignment({ next }, count, null, budget())).toThrow(RangeError);
      expect(() => unpackAssignment({ next }, 0, count, budget())).toThrow(RangeError);
    }
    expect(next).not.toHaveBeenCalled();
  });
});
