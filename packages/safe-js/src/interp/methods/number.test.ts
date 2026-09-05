import { describe, expect, it } from "vitest";

import { Budget } from "../budget.js";
import type { SandboxValue } from "../values.js";
import { isSandboxClosure } from "../values.js";
import { callNumberMethod, getNumberMember } from "./number.js";

describe("number methods", () => {
  it("exposes intercepted number members", () => {
    const budget = new Budget();

    expect(isSandboxClosure(getNumberMember("toString", budget))).toBe(true);
    expect(isSandboxClosure(getNumberMember("toExponential", budget))).toBe(true);
    expect(getNumberMember("missing", budget)).toBeUndefined();
  });

  it("supports toString with ECMAScript radix coercion", () => {
    const budget = new Budget();

    expect(callNumberMethod(255, "toString", [], budget)).toBe("255");
    expect(callNumberMethod(255, "toString", [16], budget)).toBe("ff");
    expect(callNumberMethod(10, "toString", [2.9], budget)).toBe("1010");
  });

  it("supports requested Number formatting edges", () => {
    const budget = new Budget();

    expect(callNumberMethod(1, "toString", [], budget)).toBe("1");
    expect(callNumberMethod(255, "toString", [16], budget)).toBe("ff");
    expect(callNumberMethod(8, "toString", [2], budget)).toBe("1000");
    expect(callNumberMethod(0.1, "toString", [], budget)).toBe((0.1).toString());
    expect(callNumberMethod(1, "toString", [36], budget)).toBe("1");
    expect(callNumberMethod(-0, "toString", [], budget)).toBe("0");
    expect(callNumberMethod(Infinity, "toString", [], budget)).toBe("Infinity");
    expect(callNumberMethod(-Infinity, "toString", [], budget)).toBe("-Infinity");
    expect(callNumberMethod(NaN, "toString", [], budget)).toBe("NaN");
    expect(callNumberMethod(1.005, "toFixed", [2], budget)).toBe((1.005).toFixed(2));
    expect(callNumberMethod(1, "toFixed", [100], budget)).toBe((1).toFixed(100));
    expect(callNumberMethod(1, "toPrecision", [], budget)).toBe("1");
    expect(callNumberMethod(1234.5, "toPrecision", [3], budget)).toBe("1.23e+3");
    expect(callNumberMethod(1e21, "toString", [], budget)).toBe("1e+21");
    expect(callNumberMethod(0.0000001, "toString", [], budget)).toBe("1e-7");
    expect(callNumberMethod(1, "toExponential", [2], budget)).toBe("1.00e+0");
  });

  it("throws RangeError for requested toString radix edges", () => {
    const budget = new Budget();

    expect(() => callNumberMethod(1, "toString", [0], budget)).toThrow(RangeError);
    expect(() => callNumberMethod(1, "toString", [1], budget)).toThrow(RangeError);
    expect(() => callNumberMethod(1, "toString", [37], budget)).toThrow(RangeError);
  });

  it("supports toFixed, toPrecision, and toExponential formatting", () => {
    const budget = new Budget();

    expect(callNumberMethod(12.3456, "toFixed", [2], budget)).toBe("12.35");
    expect(callNumberMethod(12.3456, "toFixed", [2.9], budget)).toBe("12.35");
    expect(callNumberMethod(12.3456, "toPrecision", [4], budget)).toBe("12.35");
    expect(callNumberMethod(12.3456, "toPrecision", [], budget)).toBe("12.3456");
    expect(callNumberMethod(12.3456, "toExponential", [2], budget)).toBe("1.23e+1");
  });

  it("matches native toString coercion and radix validation", () => {
    const cases: readonly (readonly SandboxValue[])[] = [
      [],
      [undefined],
      [2],
      [16],
      [36],
      [2.9],
      ["16"],
      ["2.9"],
      [null],
      [false],
      [true],
      ["foo"],
      [Number.NaN],
      [-0],
      [1],
      [37],
      [Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY],
      [[2]],
      [[]],
      [[37]],
      [{}]
    ];

    for (const args of cases) {
      expectNumberMethodToMatchNative(10, "toString", args);
    }
  });

  it("matches native toFixed coercion and digits validation", () => {
    const cases: readonly (readonly SandboxValue[])[] = [
      [],
      [undefined],
      [0],
      [2],
      [2.9],
      ["2"],
      ["2.9"],
      [null],
      [false],
      [true],
      ["foo"],
      [Number.NaN],
      [-0],
      [100],
      [100.9],
      [-1],
      [101],
      [Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY],
      [[2]],
      [[]],
      [[101]],
      [{}]
    ];

    for (const args of cases) {
      expectNumberMethodToMatchNative(12.3456, "toFixed", args);
    }
  });

  it("matches native toPrecision coercion and precision validation", () => {
    const cases: readonly (readonly SandboxValue[])[] = [
      [],
      [undefined],
      [1],
      [2],
      [2.9],
      ["2"],
      ["2.9"],
      [null],
      [false],
      [true],
      ["foo"],
      [Number.NaN],
      [-0],
      [100],
      [100.9],
      [0],
      [101],
      [Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY],
      [[2]],
      [[]],
      [[101]],
      [{}]
    ];

    for (const args of cases) {
      expectNumberMethodToMatchNative(12.3456, "toPrecision", args);
    }
  });

  it("matches native toExponential coercion and fraction digit validation", () => {
    const cases: readonly (readonly SandboxValue[])[] = [
      [],
      [undefined],
      [0],
      [2],
      [2.9],
      ["2"],
      ["2.9"],
      [null],
      [false],
      [true],
      ["foo"],
      [Number.NaN],
      [-0],
      [100],
      [100.9],
      [-1],
      [101],
      [Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY],
      [[2]],
      [[]],
      [[101]],
      [{}]
    ];

    for (const args of cases) {
      expectNumberMethodToMatchNative(12.3456, "toExponential", args);
    }
  });
});

function expectNumberMethodToMatchNative(
  value: number,
  methodName: "toExponential" | "toFixed" | "toPrecision" | "toString",
  args: readonly SandboxValue[]
): void {
  const nativeResult = getNativeNumberMethodResult(value, methodName, args);
  const budget = new Budget();

  if (nativeResult.ok) {
    expect(callNumberMethod(value, methodName, args, budget)).toBe(nativeResult.value);
    return;
  }

  expect(() => callNumberMethod(value, methodName, args, budget)).toThrow(
    nativeResult.error.constructor as new () => Error
  );
}

function getNativeNumberMethodResult(
  value: number,
  methodName: "toExponential" | "toFixed" | "toPrecision" | "toString",
  args: readonly SandboxValue[]
): { ok: true; value: string } | { ok: false; error: Error } {
  try {
    switch (methodName) {
      case "toString":
        return { ok: true, value: value.toString(args[0] as number | undefined) };
      case "toExponential":
        return args[0] === undefined
          ? { ok: true, value: value.toExponential() }
          : { ok: true, value: value.toExponential(args[0] as number) };
      case "toFixed":
        return { ok: true, value: value.toFixed(args[0] as number | undefined) };
      case "toPrecision":
        return args[0] === undefined
          ? { ok: true, value: value.toPrecision() }
          : { ok: true, value: value.toPrecision(args[0] as number) };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
