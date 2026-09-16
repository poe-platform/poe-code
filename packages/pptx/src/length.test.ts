import { expect, it } from "vitest";
import { Length, Pt, Emu, Cm, Mm, Inches, Centipoints } from "./length.js";
it.each([
  [Inches, 1, 914400],
  [Cm, 2.53, 910800],
  [Mm, 1, 36000],
  [Pt, 1, 12700],
  [Centipoints, 12.5, 1588],
  [Emu, 9144.9, 9145],
  [Emu, -1.5, -2]
] as const)("stores converted lengths independently %s", (Constructor, value, expected) =>
  expect(new Constructor(value).emu).toBe(expected)
);
it("provides neutral length conversions and floor centipoints", () => {
  const value = new Length(914400);
  expect(value.inches).toBe(1);
  expect(value.cm).toBe(2.54);
  expect(value.mm).toBe(25.4);
  expect(value.pt).toBe(72);
  expect(value.centipoints).toBe(7200);
  expect(new Length(-128).centipoints).toBe(-2);
  expect(Object.isFrozen(value)).toBe(true);
});
it.each([NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe length %s", (value) =>
  expect(() => new Emu(value)).toThrow()
);
it.each([
  [Length, 914400, 914400],
  [Inches, 1.1, 1005840],
  [Mm, 13.8, 496800],
  [Pt, 24.5, 311150]
] as const)("converts fractional authored length %s", (Constructor, value, expected) =>
  expect(new Constructor(value).emu).toBe(expected)
);
it.each([
  [Length, 914400],
  [Emu, 914400],
  [Inches, 1],
  [Cm, 2.54],
  [Mm, 25.4],
  [Pt, 72],
  [Centipoints, 7200]
] as const)("inherits every unit accessor %s", (Constructor, input) => {
  const value = new Constructor(input);
  expect([value.emu, value.inches, value.cm, value.mm, value.pt, value.centipoints]).toEqual([
    914400, 1, 2.54, 25.4, 72, 7200
  ]);
});
it.each([Inches, Cm, Mm, Pt, Centipoints])("rejects implicit scalar coercion %s", (Constructor) =>
  expect(() => new Constructor("1" as never)).toThrow()
);
