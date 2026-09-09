import { describe, expect, it, vi } from "vitest";
import { dispatchInPlaceOperation } from "./inplace-dispatch.js";
import { dispatchBinaryOperation } from "./binary-dispatch.js";
import { ExecutionBudget } from "./execution-budget.js";

const notImplemented = Symbol("NotImplemented");

describe("in-place operation negotiation", () => {
  it("accepts results distinct from self and arbitrary false-like values", () => {
    for (const value of [null, undefined, false, 0, "", {}]) {
      const fallback = vi.fn();
      expect(dispatchInPlaceOperation<unknown>(() => value, fallback, notImplemented)).toBe(value);
      expect(fallback).not.toHaveBeenCalled();
    }
  });

  it("falls back to ordinary binary negotiation after NotImplemented", () => {
    const events: string[] = [];
    const value = dispatchInPlaceOperation<unknown>(
      () => { events.push("inplace"); return notImplemented; },
      () => dispatchBinaryOperation<unknown>({ relation: "right-subtype", notImplemented,
        reflectedIsOverridden: () => true,
        reflected: () => { events.push("reflected"); return "right"; },
        forward: () => { events.push("forward"); return "left"; }
      }), notImplemented);
    expect(value).toBe("right");
    expect(events).toEqual(["inplace", "reflected"]);
  });

  it("preserves mutations before a declined operation or an exception", () => {
    const items: string[] = [], fault = new Error("failed"), fallback = vi.fn();
    expect(dispatchInPlaceOperation<unknown>(() => { items.push("mutation"); return notImplemented; }, () => items.length, notImplemented)).toBe(1);
    expect(() => dispatchInPlaceOperation(() => { items.push("before error"); throw fault; }, fallback, notImplemented)).toThrow(fault);
    expect(items).toEqual(["mutation", "before error"]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("passes through a declined fallback for caller diagnostics", () => {
    expect(dispatchInPlaceOperation(() => notImplemented, () => notImplemented, notImplemented)).toBe(notImplemented);
  });

  it("does not run fallback after non-callable method errors", () => {
    const fallback = vi.fn(), fault = new TypeError("not callable");
    expect(() => dispatchInPlaceOperation(() => { throw fault; }, fallback, notImplemented)).toThrow(fault);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("meters dispatch before callbacks without rolling back earlier mutation", () => {
    for (let maxSteps = 0; maxSteps < 3; maxSteps++) {
      const method = vi.fn(() => notImplemented), fallback = vi.fn();
      expect(() => dispatchInPlaceOperation(method, fallback, notImplemented,
        new ExecutionBudget({ maxSteps, maxAllocatedBytes: 0 }))).toThrow("execution step limit exceeded");
      expect(method).toHaveBeenCalledTimes(maxSteps === 2 ? 1 : 0);
      expect(fallback).not.toHaveBeenCalled();
    }
  });
});
