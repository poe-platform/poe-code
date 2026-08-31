import { describe, expect, it } from "vitest";

import { parse } from "../../parse.js";
import { Budget } from "../budget.js";
import { interpret } from "../interpreter.js";
import type { SandboxClosure, SandboxValue } from "../values.js";
import { createMathGlobals } from "./math.js";

const nativeF16round = (Math as Math & { f16round?: (value: number) => number }).f16round;

describe("Math.f16round", () => {
  const globals = createMathGlobals();
  const f16round = globals.Math.f16round as SandboxClosure;

  it("is a named sandbox closure", () => {
    expect(f16round).toMatchObject({ sandbox: true, name: "f16round" });
  });

  it.each<[string, number, number]>([
    ["positive zero", 0, 0],
    ["negative zero", -0, -0],
    ["NaN", NaN, NaN],
    ["positive infinity", Infinity, Infinity],
    ["negative infinity", -Infinity, -Infinity],
    ["smallest binary64", Number.MIN_VALUE, 0],
    ["negative smallest binary64", -Number.MIN_VALUE, -0],
    ["largest binary64", Number.MAX_VALUE, Infinity],
    ["negative largest binary64", -Number.MAX_VALUE, -Infinity],
    ["smallest subnormal", 2 ** -24, 2 ** -24],
    ["half smallest subnormal", 2 ** -25, 0],
    ["negative half smallest subnormal", -(2 ** -25), -0],
    ["odd subnormal tie", 3 * 2 ** -25, 2 ** -23],
    ["even subnormal tie", 5 * 2 ** -25, 2 ** -23],
    ["largest subnormal", 1023 * 2 ** -24, 1023 * 2 ** -24],
    ["smallest normal", 2 ** -14, 2 ** -14],
    ["subnormal-normal tie", 2 ** -14 - 2 ** -25, 2 ** -14],
    ["even normal tie", 1 + 2 ** -11, 1],
    ["odd normal tie", 1 + 3 * 2 ** -11, 1 + 2 ** -9],
    ["exponent carry tie", 2 - 2 ** -11, 2],
    ["fraction", 1.337, 1.3369140625],
    ["largest finite", 65504, 65504],
    ["below overflow", 65519, 65504],
    ["overflow tie", 65520, Infinity],
    ["negative overflow tie", -65520, -Infinity],
    ["above overflow", 65521, Infinity],
    ["double-rounding upward", 1 + 2 ** -11 + 2 ** -52, 1 + 2 ** -10],
    ["double-rounding downward", 1 + 3 * 2 ** -11 - 2 ** -52, 1 + 2 ** -10],
    ["negative double-rounding", -(1 + 2 ** -11 + 2 ** -52), -(1 + 2 ** -10)]
  ])("rounds %s", (_name, value, expected) => {
    expect(f16round.call([value])).toBe(expected);
  });

  it.each<{ name: string; args: SandboxValue[]; expected: number }>([
    { name: "missing argument", args: [], expected: NaN },
    { name: "undefined", args: [undefined], expected: NaN },
    { name: "null", args: [null], expected: 0 },
    { name: "true", args: [true], expected: 1 },
    { name: "false", args: [false], expected: 0 },
    { name: "empty string", args: [""], expected: 0 },
    { name: "whitespace", args: ["  "], expected: 0 },
    { name: "numeric string", args: ["1.337"], expected: 1.3369140625 },
    { name: "negative zero string", args: ["-0"], expected: -0 },
    { name: "hex string", args: ["0x10"], expected: 16 },
    { name: "infinity string", args: ["Infinity"], expected: Infinity },
    { name: "invalid string", args: ["invalid"], expected: NaN },
    { name: "empty array", args: [[]], expected: 0 },
    { name: "singleton array", args: [[1.337]], expected: 1.3369140625 },
    { name: "plain object", args: [{}], expected: NaN },
    {
      name: "ignored extra argument",
      args: [1.337, { valueOf: null, toString: null }],
      expected: 1.3369140625
    }
  ])("coerces $name like existing Math methods", ({ args, expected }) => {
    expect(f16round.call(args)).toBe(expected);
  });

  it("propagates failed numeric coercion", () => {
    expect(f16round).toBeDefined();
    expect(() => f16round.call([{ valueOf: null, toString: null }])).toThrow(TypeError);
  });

  it.each([1n, Symbol("number")])("rejects non-ToNumber host input %s", (value) => {
    expect(f16round).toBeDefined();
    expect(() => f16round.call([value as unknown as SandboxValue])).toThrow(TypeError);
  });

  it("coerces its first argument exactly once", () => {
    let conversions = 0;
    const value = {
      valueOf() {
        conversions += 1;
        return 1.337;
      }
    };
    expect(f16round.call([value as unknown as SandboxValue])).toBe(1.3369140625);
    expect(conversions).toBe(1);
  });

  it("preserves all 63,488 signed finite binary16 values", () => {
    for (let encoding = 0; encoding < 0x7c00; encoding += 1) {
      const value = binary16Magnitude(encoding);
      assertRounded(f16round, value, value);
      assertRounded(f16round, -value, -value);
    }
  });

  it("rounds all 190,464 signed midpoint and adjacent-binary64 cases", () => {
    const storage = new DataView(new ArrayBuffer(8));
    for (let encoding = 0; encoding < 0x7c00; encoding += 1) {
      const lower = binary16Magnitude(encoding);
      const upper = binary16Magnitude(encoding + 1);
      const midpoint = (lower + upper) / 2;
      const roundedUpper = encoding === 0x7bff ? Infinity : upper;
      const tied = encoding % 2 === 0 ? lower : roundedUpper;
      storage.setFloat64(0, midpoint);
      const bits = storage.getBigUint64(0);
      storage.setBigUint64(0, bits - 1n);
      const below = storage.getFloat64(0);
      storage.setBigUint64(0, bits + 1n);
      const above = storage.getFloat64(0);

      assertRounded(f16round, below, lower);
      assertRounded(f16round, midpoint, tied);
      assertRounded(f16round, above, roundedUpper);
      assertRounded(f16round, -below, -lower);
      assertRounded(f16round, -midpoint, -tied);
      assertRounded(f16round, -above, -roundedUpper);
    }
  });

  it.skipIf(!nativeF16round)(
    "matches native f16round for 16,384 deterministic binary64 inputs",
    () => {
      const storage = new DataView(new ArrayBuffer(8));
      let state = 0x12345678;
      for (let index = 0; index < 8192; index += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        storage.setUint32(0, state);
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        storage.setUint32(4, state);
        const arbitrary = storage.getFloat64(0);
        const nearBinary16 = (state / 2 ** 31 - 1) * 2 ** ((index % 64) - 40);
        assertRounded(f16round, arbitrary, nativeF16round!(arbitrary));
        assertRounded(f16round, nearBinary16, nativeF16round!(nearBinary16));
      }
    }
  );

  it.each<[string, number]>([
    ["return Math.f16round(1.337)", 1.3369140625],
    ["return Math.f16round('-0')", -0],
    ["return Math.f16round()", NaN],
    ["return ((round) => round(1.337))(Math.f16round)", 1.3369140625],
    ["return Math.f16round(65520)", Infinity]
  ])("uses the existing budgeted snapshot-safe call path: %s", async (source, expected) => {
    await expect(
      interpret(parse(source), { bindings: globals, budget: new Budget({ maxSteps: 20 }) })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: expected,
      snapshot: { bindings: { Math: expect.any(Object) } },
      stats: { nodeVisits: expect.any(Number) }
    });
  });

  it("cannot bypass the interpreter step budget", async () => {
    await expect(
      interpret(parse("while (true) { Math.f16round(1.337); }"), {
        bindings: globals,
        budget: new Budget({ maxSteps: 40 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });
});

function binary16Magnitude(encoding: number): number {
  const exponent = Math.floor(encoding / 1024);
  const fraction = encoding % 1024;
  return exponent === 0 ? fraction * 2 ** -24 : (1024 + fraction) * 2 ** (exponent - 25);
}

function assertRounded(closure: SandboxClosure, value: number, expected: number): void {
  const actual = closure.call([value]);
  if (!Object.is(actual, expected)) {
    throw new Error(
      `f16round(${Object.is(value, -0) ? "-0" : value}): expected ${expected}, got ${actual}`
    );
  }
}
