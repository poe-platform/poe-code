import { describe, expect, it, vi } from "vitest";
import { dispatchBinaryOperation, type BinaryDispatch } from "./binary-dispatch.js";
import { ExecutionBudget } from "./execution-budget.js";

const notImplemented = Symbol("NotImplemented");

describe("binary special-method dispatch", () => {
  it.each([
    ["same", "forward"], ["other", "forward"],
    ["other", "reflected"], ["right-subtype", "reflected"]
  ] as const)("observes cancellation after %s %s returns", (relation, stage) => {
    for (const result of ["accepted", notImplemented]) {
      const controller = new AbortController();
      const events: string[] = [];
      const run = (name: string) => {
        events.push(name);
        if (name === stage) { controller.abort(); return result; }
        return notImplemented;
      };
      expect(() => dispatchBinaryOperation<unknown>({
        relation, notImplemented,
        forward: () => run("forward"), reflected: () => run("reflected"),
        reflectedIsOverridden: () => true
      }, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0, signal: controller.signal }))).toThrow("execution cancelled");
      expect(events).toEqual(stage === "forward" ? ["forward"] : relation === "other" ? ["forward", "reflected"] : ["reflected"]);
    }
  });

  it.each(["same", "other", "right-subtype"] as const)("orders methods for %s operand types", relation => {
    const events: string[] = [];
    const options: BinaryDispatch<unknown> = {
      relation, notImplemented,
      forward: () => { events.push("forward"); return notImplemented; },
      reflected: () => { events.push("reflected"); return notImplemented; },
      reflectedIsOverridden: () => { events.push("override"); return true; }
    };
    expect(dispatchBinaryOperation(options)).toBe(notImplemented);
    expect(events).toEqual(relation === "same" ? ["forward"] : relation === "other" ? ["forward", "reflected"] : ["override", "reflected", "forward"]);
  });

  it("does not prioritize an inherited reflected method", () => {
    const forward = vi.fn(() => "forward"), reflected = vi.fn();
    expect(dispatchBinaryOperation({ relation: "right-subtype", notImplemented, forward, reflected, reflectedIsOverridden: () => false })).toBe("forward");
    expect(reflected).not.toHaveBeenCalled();
  });

  it("accepts every result other than the exact NotImplemented singleton", () => {
    for (const value of [undefined, null, false, 0, "", {}, Symbol("NotImplemented")]) {
      const reflected = vi.fn();
      expect(dispatchBinaryOperation<unknown>({ relation: "other", notImplemented, forward: () => value, reflected, reflectedIsOverridden: () => true })).toBe(value);
      expect(reflected).not.toHaveBeenCalled();
    }
  });

  it("stops when the prioritized reflected method succeeds", () => {
    const forward = vi.fn();
    expect(dispatchBinaryOperation<unknown>({ relation: "right-subtype", notImplemented, forward, reflected: () => "reflected", reflectedIsOverridden: () => true })).toBe("reflected");
    expect(forward).not.toHaveBeenCalled();
  });

  it("propagates override, forward and reflected exceptions without fallback", () => {
    for (const stage of ["override", "forward", "reflected"]) {
      const events: string[] = [], fault = new Error(stage);
      const run = (name: string) => { events.push(name); if (name === stage) throw fault; };
      expect(() => dispatchBinaryOperation({ relation: "right-subtype", notImplemented,
        reflectedIsOverridden: () => { run("override"); return false; },
        forward: () => { run("forward"); return notImplemented; },
        reflected: () => { run("reflected"); return notImplemented; }
      })).toThrow(fault);
      expect(events).toEqual(["override", "forward", "reflected"].slice(0, ["override", "forward", "reflected"].indexOf(stage) + 1));
    }
  });

  it("allows late special-method lookup after the forward method mutates a type", () => {
    let result = "old";
    expect(dispatchBinaryOperation<unknown>({ relation: "other", notImplemented,
      forward: () => { result = "new"; return notImplemented; },
      reflected: () => result, reflectedIsOverridden: () => false
    })).toBe("new");
  });

  it("does not accept a result after a callback swallows an exhausted budget", () => {
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0 });
    const reflected = vi.fn();
    expect(() => dispatchBinaryOperation<unknown>({
      relation: "other", notImplemented, reflected,
      reflectedIsOverridden: () => false,
      forward() {
        try { meter.checkpoint(0, 1); } catch { /* Guest adapters cannot recover the meter. */ }
        return "accepted";
      }
    }, meter)).toThrow("execution allocation limit exceeded");
    expect(reflected).not.toHaveBeenCalled();
  });

  it("checks budgets before each potentially guest-executing callback", () => {
    for (let maxSteps = 0; maxSteps < 4; maxSteps++) {
      const events: string[] = [];
      expect(() => dispatchBinaryOperation({ relation: "right-subtype", notImplemented,
        reflectedIsOverridden: () => { events.push("override"); return true; },
        reflected: () => { events.push("reflected"); return notImplemented; },
        forward: () => { events.push("forward"); return notImplemented; }
      }, new ExecutionBudget({ maxSteps, maxAllocatedBytes: 0 }))).toThrow("execution step limit exceeded");
      expect(events).toEqual(["override", "reflected", "forward"].slice(0, Math.max(0, maxSteps - 1)));
    }
  });
});
