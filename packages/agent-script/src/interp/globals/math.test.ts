import { describe, expect, it } from "vitest";

import type { SandboxClosure, SandboxObject } from "../values.js";
import { createMathGlobals, createSeededRandom } from "./math.js";

describe("createMathGlobals", () => {
  it("exposes supported Math constants and numeric helpers", async () => {
    const globals = createMathGlobals();

    expect(getProperty(globals.Math, "PI")).toBe(Math.PI);
    expect(getProperty(globals.Math, "E")).toBe(Math.E);

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
    expect(getClosure(getProperty(globals.Math, "exp")).call([2])).toBe(Math.exp(2));
    expect(getClosure(getProperty(globals.Math, "sin")).call([Math.PI / 2])).toBe(1);
    expect(getClosure(getProperty(globals.Math, "cos")).call([Math.PI])).toBe(-1);
    expect(getClosure(getProperty(globals.Math, "tan")).call([0])).toBe(0);
  });

  it("uses host randomness by default", async () => {
    const globals = createMathGlobals();
    const value = await getClosure(getProperty(globals.Math, "random")).call([]);

    expect(typeof value).toBe("number");
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });

  it("produces deterministic random sequences for the same seed", async () => {
    const firstGlobals = createMathGlobals({ random: createSeededRandom(123).next });
    const secondGlobals = createMathGlobals({ random: createSeededRandom(123).next });
    const thirdGlobals = createMathGlobals({ random: createSeededRandom(456).next });
    const firstRandom = getClosure(getProperty(firstGlobals.Math, "random"));
    const secondRandom = getClosure(getProperty(secondGlobals.Math, "random"));
    const thirdRandom = getClosure(getProperty(thirdGlobals.Math, "random"));

    const firstSequence = [await firstRandom.call([]), await firstRandom.call([]), await firstRandom.call([])];
    const secondSequence = [await secondRandom.call([]), await secondRandom.call([]), await secondRandom.call([])];
    const thirdSequence = [await thirdRandom.call([]), await thirdRandom.call([]), await thirdRandom.call([])];

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
