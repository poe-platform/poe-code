import { describe, expect, it } from "vitest";

import { Budget } from "../budget.js";
import type { SandboxValue } from "../values.js";
import { isSandboxClosure } from "../values.js";
import { callNumberMethod, getNumberMember } from "./number.js";

describe("number methods", () => {
  it("exposes intercepted number members", () => {
    const budget = new Budget();

    expect(isSandboxClosure(getNumberMember(255, "toString", budget))).toBe(true);
    expect(getNumberMember(255, "missing", budget)).toBeUndefined();
  });

  it("supports toString with ECMAScript radix coercion", () => {
    const budget = new Budget();

    expect(callNumberMethod(255, "toString", [], budget)).toBe("255");
    expect(callNumberMethod(255, "toString", [16], budget)).toBe("ff");
    expect(callNumberMethod(10, "toString", [2.9], budget)).toBe("1010");
  });

  it("supports toFixed and toPrecision formatting", () => {
    const budget = new Budget();

    expect(callNumberMethod(12.3456, "toFixed", [2], budget)).toBe("12.35");
    expect(callNumberMethod(12.3456, "toFixed", [2.9], budget)).toBe("12.35");
    expect(callNumberMethod(12.3456, "toPrecision", [4], budget)).toBe("12.35");
    expect(callNumberMethod(12.3456, "toPrecision", [], budget)).toBe("12.3456");
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
});

function expectNumberMethodToMatchNative(
  value: number,
  methodName: "toFixed" | "toPrecision" | "toString",
  args: readonly SandboxValue[]
): void {
  const nativeResult = getNativeNumberMethodResult(value, methodName, args);
  const budget = new Budget();

  if (nativeResult.ok) {
    expect(callNumberMethod(value, methodName, args, budget)).toBe(nativeResult.value);
    return;
  }

  expect(() => callNumberMethod(value, methodName, args, budget)).toThrow(nativeResult.error.constructor as new () => Error);
}

function getNativeNumberMethodResult(
  value: number,
  methodName: "toFixed" | "toPrecision" | "toString",
  args: readonly SandboxValue[]
): { ok: true; value: string } | { ok: false; error: Error } {
  try {
    switch (methodName) {
      case "toString":
        return { ok: true, value: value.toString(args[0] as number | undefined) };
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
