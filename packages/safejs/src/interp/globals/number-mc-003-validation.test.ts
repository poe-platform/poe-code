import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";

const numericConstants = [
  ["EPSILON", 2 ** -52],
  ["MAX_SAFE_INTEGER", 2 ** 53 - 1],
  ["MIN_SAFE_INTEGER", -(2 ** 53 - 1)],
  ["MAX_VALUE", 1.7976931348623157e308],
  ["MIN_VALUE", 5e-324],
  ["NaN", NaN],
  ["NEGATIVE_INFINITY", -Infinity],
  ["POSITIVE_INFINITY", Infinity]
] as const;

const expressions: ReadonlyArray<readonly [string, number | boolean | string]> = [
  ["typeof Number.NaN", "number"],
  ["Number.NaN === Number.NaN", false],
  ["Number.NaN == Number.NaN", false],
  ["Number.NaN !== Number.NaN", true],
  ["Number.NaN != Number.NaN", true],
  ["Number.NaN === undefined", false],
  ["Number.NaN < 0", false],
  ["Number.NaN >= 0", false],
  ["Object.is(Number.NaN, Number.NaN)", true],
  ["Object.is(Number.NaN, NaN)", true],
  ["Number.isNaN(Number.NaN)", true],
  ["Number.isNaN(undefined)", false],
  ["Number.NaN + 5", NaN],
  ["Number.NaN * 0", NaN],
  ["Number.POSITIVE_INFINITY === Infinity", true],
  ["Number.NEGATIVE_INFINITY === -Infinity", true],
  ["Number.POSITIVE_INFINITY + 17", Infinity],
  ["Number.NEGATIVE_INFINITY - 17", -Infinity],
  ["Number.POSITIVE_INFINITY * -2", -Infinity],
  ["Number.NEGATIVE_INFINITY * -2", Infinity],
  ["Number.POSITIVE_INFINITY / -2", -Infinity],
  ["Number.NEGATIVE_INFINITY / -2", Infinity],
  ["Number.POSITIVE_INFINITY + Number.NEGATIVE_INFINITY", NaN],
  ["Number.POSITIVE_INFINITY - Number.POSITIVE_INFINITY", NaN],
  ["Number.NEGATIVE_INFINITY / Number.NEGATIVE_INFINITY", NaN],
  ["Number.POSITIVE_INFINITY * 0", NaN],
  ["1 / Number.POSITIVE_INFINITY", 0],
  ["1 / Number.NEGATIVE_INFINITY", -0],
  ["Object.is(1 / Number.NEGATIVE_INFINITY, -0)", true],
  ["Number.MAX_VALUE * 2 === Number.POSITIVE_INFINITY", true],
  ["-Number.MAX_VALUE * 2 === Number.NEGATIVE_INFINITY", true],
  ["Number.MIN_VALUE / 2", 0],
  ["Number.NEGATIVE_INFINITY < -Number.MAX_VALUE", true],
  ["Number.POSITIVE_INFINITY > Number.MAX_VALUE", true],
  ["Number.isFinite(Number.POSITIVE_INFINITY)", false],
  ["Number.isFinite(Number.NEGATIVE_INFINITY)", false],
  ["Number.isFinite(Number.NaN)", false],
  ["Number.isInteger(Number.NaN)", false],
  ["Number.isSafeInteger(Number.POSITIVE_INFINITY)", false]
];

describe("MC-003 independent standard numeric constants", () => {
  it("covers every native Number numeric constant", () => {
    const nativeNames = Object.getOwnPropertyNames(Number).filter(
      (name) => name !== "length" && typeof Reflect.get(Number, name) === "number"
    );

    expect(nativeNames.sort()).toEqual(numericConstants.map(([name]) => name).sort());
  });

  describe.each(["dot", "computed"] as const)("%s property access", (access) => {
    it.each(numericConstants)("preserves Number.%s", async (name, expected) => {
      const expression = access === "dot" ? `Number.${name}` : `Number[${JSON.stringify(name)}]`;
      const native = runInNewContext(expression, {}, { timeout: 1_000 });

      expect(native).toBe(expected);

      const result = await run(`return ${expression};`, {
        budget: new Budget({ maxSteps: 100 })
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toBe(native);
    });
  });

  it.each(expressions)("matches native %s", async (expression, expected) => {
    const native = runInNewContext(expression, {}, { timeout: 1_000 });

    expect(native).toBe(expected);

    const result = await run(`return ${expression};`, {
      budget: new Budget({ maxSteps: 1_000 })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toBe(native);
  });
});
