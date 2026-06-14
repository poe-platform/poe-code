import { describe, expect, it } from "vitest";

import { parse } from "../../parse.js";
import { Budget } from "../budget.js";
import { interpret } from "../interpreter.js";
import type { SandboxClosure, SandboxObject } from "../values.js";
import { createMathGlobals, createSeededRandom } from "./math.js";

describe("createMathGlobals", () => {
  it("exposes supported Math constants and numeric helpers", async () => {
    const globals = createMathGlobals();

    expect(getProperty(globals.Math, "PI")).toBe(Math.PI);
    expect(getProperty(globals.Math, "E")).toBe(Math.E);
    expect(getProperty(globals.Math, "LN2")).toBe(Math.LN2);
    expect(getProperty(globals.Math, "LN10")).toBe(Math.LN10);
    expect(getProperty(globals.Math, "LOG2E")).toBe(Math.LOG2E);
    expect(getProperty(globals.Math, "LOG10E")).toBe(Math.LOG10E);
    expect(getProperty(globals.Math, "SQRT2")).toBe(Math.SQRT2);
    expect(getProperty(globals.Math, "SQRT1_2")).toBe(Math.SQRT1_2);
    expect(globals.Infinity).toBe(Infinity);
    expect(globals.NaN).toBeNaN();

    expect(getClosure(getProperty(globals.Math, "min")).call([5, -2, 9])).toBe(-2);
    expect(getClosure(getProperty(globals.Math, "max")).call([5, -2, 9])).toBe(9);
    expect(getClosure(getProperty(globals.Math, "abs")).call([-7])).toBe(7);
    expect(getClosure(getProperty(globals.Math, "floor")).call([2.9])).toBe(2);
    expect(getClosure(getProperty(globals.Math, "ceil")).call([2.1])).toBe(3);
    expect(getClosure(getProperty(globals.Math, "round")).call([2.5])).toBe(3);
    expect(getClosure(getProperty(globals.Math, "trunc")).call([-2.9])).toBe(-2);
    expect(getClosure(getProperty(globals.Math, "sign")).call([-4])).toBe(-1);
    expect(getClosure(getProperty(globals.Math, "pow")).call([2, 5])).toBe(32);
    expect(getClosure(getProperty(globals.Math, "sqrt")).call([81])).toBe(9);
    expect(getClosure(getProperty(globals.Math, "log")).call([Math.E ** 2])).toBe(2);
    expect(getClosure(getProperty(globals.Math, "log2")).call([8])).toBe(3);
    expect(getClosure(getProperty(globals.Math, "log10")).call([1_000])).toBe(3);
    expect(getClosure(getProperty(globals.Math, "hypot")).call([3, 4])).toBe(5);
    expect(getClosure(getProperty(globals.Math, "cbrt")).call([-8])).toBe(-2);
    expect(getClosure(getProperty(globals.Math, "exp")).call([2])).toBe(Math.exp(2));
    expect(getClosure(getProperty(globals.Math, "sin")).call([Math.PI / 2])).toBe(1);
    expect(getClosure(getProperty(globals.Math, "cos")).call([Math.PI])).toBe(-1);
    expect(getClosure(getProperty(globals.Math, "tan")).call([0])).toBe(0);
  });

  it.each([
    ["atan2", Math.atan2, [1, -1]],
    ["asin", Math.asin, [0.5]],
    ["acos", Math.acos, [0.5]],
    ["atan", Math.atan, [1]],
    ["sinh", Math.sinh, [1]],
    ["cosh", Math.cosh, [1]],
    ["tanh", Math.tanh, [1]],
    ["asinh", Math.asinh, [1]],
    ["acosh", Math.acosh, [2]],
    ["atanh", Math.atanh, [0.5]],
    ["clz32", Math.clz32, [1]],
    ["expm1", Math.expm1, [1]],
    ["log1p", Math.log1p, [1]],
    ["fround", Math.fround, [1.337]],
    ["imul", Math.imul, [0xffff_ffff, 5]]
  ] as const)("passes Math.%s through to the host", (name, method, args) => {
    const globals = createMathGlobals();

    expect(callMath(globals.Math, name, ...args)).toBe(method(...args));
  });

  it("matches JavaScript Math edge cases", () => {
    const globals = createMathGlobals();

    expect(callMath(globals.Math, "min")).toBe(Infinity);
    expect(callMath(globals.Math, "max")).toBe(-Infinity);
    expect(callMath(globals.Math, "min", 1, Number.NaN, 2)).toBeNaN();
    expect(callMath(globals.Math, "max", 1, Number.NaN, 2)).toBeNaN();
    expect(Object.is(callMath(globals.Math, "abs", -0), 0)).toBe(true);
    expect(Object.is(callMath(globals.Math, "sign", -0), -0)).toBe(true);
    expect(Object.is(callMath(globals.Math, "sign", 0), 0)).toBe(true);
    expect(callMath(globals.Math, "sign", Number.NaN)).toBeNaN();
    expect(callMath(globals.Math, "floor", -0.5)).toBe(-1);
    expect(Object.is(callMath(globals.Math, "ceil", -0.5), -0)).toBe(true);
    expect(callMath(globals.Math, "round", 0.5)).toBe(1);
    expect(Object.is(callMath(globals.Math, "round", -0.5), -0)).toBe(true);
    expect(callMath(globals.Math, "round", 2.5)).toBe(3);
    expect(callMath(globals.Math, "trunc", -1.9)).toBe(-1);
    expect(callMath(globals.Math, "pow", 0, -1)).toBe(Infinity);
    expect(callMath(globals.Math, "pow", 0, 0)).toBe(1);
    expect(callMath(globals.Math, "sqrt", -1)).toBeNaN();
    expect(callMath(globals.Math, "log", 0)).toBe(-Infinity);
    expect(callMath(globals.Math, "log", -1)).toBeNaN();
    expect(callMath(globals.Math, "log2", 8)).toBe(3);
    expect(callMath(globals.Math, "log10", 1_000)).toBe(3);
    expect(callMath(globals.Math, "acos", 2)).toBeNaN();
    expect(callMath(globals.Math, "acosh", 0)).toBeNaN();
    expect(callMath(globals.Math, "atanh", 1)).toBe(Infinity);
    expect(callMath(globals.Math, "log1p", -1)).toBe(-Infinity);
    expect(callMath(globals.Math, "sinh", Infinity)).toBe(Infinity);
    expect(callMath(globals.Math, "fround", Number.NaN)).toBeNaN();
  });

  it.each([
    ["atan2", "1, -1", Math.atan2(1, -1)],
    ["asin", "0.5", Math.asin(0.5)],
    ["acos", "0.5", Math.acos(0.5)],
    ["atan", "1", Math.atan(1)],
    ["sinh", "1", Math.sinh(1)],
    ["cosh", "1", Math.cosh(1)],
    ["tanh", "1", Math.tanh(1)],
    ["asinh", "1", Math.asinh(1)],
    ["acosh", "2", Math.acosh(2)],
    ["atanh", "0.5", Math.atanh(0.5)],
    ["clz32", "1", Math.clz32(1)],
    ["expm1", "1", Math.expm1(1)],
    ["log1p", "1", Math.log1p(1)],
    ["fround", "1.337", Math.fround(1.337)],
    ["imul", "4294967295, 5", Math.imul(0xffff_ffff, 5)]
  ])("keeps Math.%s budgeted and snapshot-safe", async (name, args, expected) => {
    const globals = createMathGlobals();

    await expect(
      interpret(parse(`return Math.${name}(${args})`), {
        bindings: globals,
        budget: new Budget({ maxSteps: 20 })
      })
    ).resolves.toEqual({
      ok: true,
      returnValue: expected,
      snapshot: {
        bindings: {
          Infinity,
          Math: expect.any(Object),
          NaN: Number.NaN
        }
      },
      stats: {
        nodeVisits: expect.any(Number)
      }
    });
  });

  it("uses host randomness by default", async () => {
    const globals = createMathGlobals();
    const value = await getClosure(getProperty(globals.Math, "random")).call([]);

    expect(typeof value).toBe("number");
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });

  it("keeps Math.random() samples inside the JavaScript range", () => {
    const globals = createMathGlobals();
    const random = getClosure(getProperty(globals.Math, "random"));

    for (let index = 0; index < 10_000; index += 1) {
      const value = random.call([]);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("produces deterministic random sequences for the same seed", async () => {
    const firstGlobals = createMathGlobals({ random: createSeededRandom(123).next });
    const secondGlobals = createMathGlobals({ random: createSeededRandom(123).next });
    const thirdGlobals = createMathGlobals({ random: createSeededRandom(456).next });
    const firstRandom = getClosure(getProperty(firstGlobals.Math, "random"));
    const secondRandom = getClosure(getProperty(secondGlobals.Math, "random"));
    const thirdRandom = getClosure(getProperty(thirdGlobals.Math, "random"));

    const firstSequence = [
      await firstRandom.call([]),
      await firstRandom.call([]),
      await firstRandom.call([])
    ];
    const secondSequence = [
      await secondRandom.call([]),
      await secondRandom.call([]),
      await secondRandom.call([])
    ];
    const thirdSequence = [
      await thirdRandom.call([]),
      await thirdRandom.call([]),
      await thirdRandom.call([])
    ];

    expect(firstSequence).toEqual(secondSequence);
    expect(firstSequence).not.toEqual(thirdSequence);
    expect(firstSequence[0]).toBeGreaterThanOrEqual(0);
    expect(firstSequence[0]).toBeLessThan(1);
  });

  it("replays the random sequence from a saved seeded state", () => {
    const random = createSeededRandom(123);

    const firstValue = random.next();
    const savedState = random.snapshot();
    const secondValue = random.next();
    const restored = createSeededRandom(savedState);

    expect(firstValue).toBeGreaterThanOrEqual(0);
    expect(firstValue).toBeLessThan(1);
    expect(savedState).not.toBe(123);
    expect(restored.next()).toBe(secondValue);
  });
});

function getProperty(value: SandboxObject, name: string) {
  return value[name];
}

function getClosure(value: unknown): SandboxClosure {
  return value as SandboxClosure;
}

function callMath(mathObject: SandboxObject, name: string, ...args: number[]) {
  return getClosure(getProperty(mathObject, name)).call(args);
}
