import { describe, expect, it, vi } from "vitest";
import { dispatchRichComparison } from "./comparison-dispatch.js";
import { ExecutionBudget } from "./execution-budget.js";

const notImplemented = Symbol("NotImplemented");

describe("rich comparison negotiation", () => {
  it.each([
    [false, "forward"], [false, "reflected"],
    [true, "forward"], [true, "reflected"]
  ] as const)("observes callback cancellation with subtype=%s at %s", (rightIsStrictSubtype, stage) => {
    for (const result of ["accepted", notImplemented]) {
      const controller = new AbortController(), events: string[] = [];
      const run = (name: string) => {
        events.push(name);
        if (name === stage) { controller.abort(); return result; }
        return notImplemented;
      };
      expect(() => dispatchRichComparison<unknown>({
        rightIsStrictSubtype, notImplemented,
        forward: () => run("forward"), reflected: () => run("reflected")
      }, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0, signal: controller.signal }))).toThrow("execution cancelled");
      const order = rightIsStrictSubtype ? ["reflected", "forward"] : ["forward", "reflected"];
      expect(events).toEqual(order.slice(0, order.indexOf(stage) + 1));
    }
  });

  it.each([false, true])("orders methods with strict right subtype=%s", rightIsStrictSubtype => {
    const events: string[] = [];
    expect(dispatchRichComparison({ rightIsStrictSubtype, notImplemented,
      forward: () => { events.push("forward"); return notImplemented; },
      reflected: () => { events.push("reflected"); return notImplemented; }
    })).toBe(notImplemented);
    expect(events).toEqual(rightIsStrictSubtype ? ["reflected", "forward"] : ["forward", "reflected"]);
  });

  it("tries the reflected method for same-type operands, even the same object", () => {
    const method = vi.fn().mockReturnValueOnce(notImplemented).mockReturnValueOnce("second call");
    expect(dispatchRichComparison({ rightIsStrictSubtype: false, notImplemented, forward: method, reflected: method })).toBe("second call");
    expect(method).toHaveBeenCalledTimes(2);
  });

  it("does not require a subtype to override the inherited reflected method", () => {
    const forward = vi.fn(() => "left");
    expect(dispatchRichComparison<unknown>({ rightIsStrictSubtype: true, notImplemented, forward, reflected: () => "inherited right" })).toBe("inherited right");
    expect(forward).not.toHaveBeenCalled();
  });

  it("returns arbitrary comparison values without boolean coercion", () => {
    for (const value of [null, undefined, false, 0, "", {}, Symbol("NotImplemented")]) {
      const reflected = vi.fn();
      expect(dispatchRichComparison<unknown>({ rightIsStrictSubtype: false, notImplemented, forward: () => value, reflected })).toBe(value);
      expect(reflected).not.toHaveBeenCalled();
    }
  });

  it.each([false, true])("propagates first-method errors without fallback, subtype=%s", rightIsStrictSubtype => {
    const fault = new TypeError("non-callable method"), later = vi.fn();
    const first = () => { throw fault; };
    expect(() => dispatchRichComparison({ rightIsStrictSubtype, notImplemented,
      forward: rightIsStrictSubtype ? later : first,
      reflected: rightIsStrictSubtype ? first : later
    })).toThrow(fault);
    expect(later).not.toHaveBeenCalled();
  });

  it("checkpoints before both callbacks", () => {
    for (const rightIsStrictSubtype of [false, true]) {
      for (let maxSteps = 0; maxSteps < 3; maxSteps++) {
        const method = vi.fn(() => notImplemented);
        expect(() => dispatchRichComparison({ rightIsStrictSubtype, notImplemented, forward: method, reflected: method },
          new ExecutionBudget({ maxSteps, maxAllocatedBytes: 0 }))).toThrow("execution step limit exceeded");
        expect(method).toHaveBeenCalledTimes(Math.max(0, maxSteps - 1));
      }
    }
  });
});
