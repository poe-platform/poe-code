import { describe, expect, it } from "vitest";
import { cleanDocstring } from "./docstring.js";
import { PythonEncodeError } from "./encode-error.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { analyzeModule } from "../analysis.js";
import { compileClassBody } from "./class-compilation.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

describe("compiler docstring encoding validation", () => {
  it.each([
    { points: [0xd800], expanded: [0xd800], start: 0, end: 1 },
    { points: [65, 0xd800, 0xdc00, 66], expanded: [65, 0xd800, 0xdc00, 66], start: 1, end: 3 },
    { points: [9, 0xd800], expanded: [...Array<number>(8).fill(32), 0xd800], start: 8, end: 9 },
    { points: [10, 32, 32, 0xd800], expanded: [10, 32, 32, 0xd800], start: 3, end: 4 },
    { points: [0xd800, 65, 0xdc00], expanded: [0xd800, 65, 0xdc00], start: 0, end: 1 },
    { points: [0x10000, 9, 0xdc00], expanded: [0x10000, ...Array<number>(7).fill(32), 0xdc00], start: 8, end: 9 },
    { points: [0, 0xd800, 13, 9, 66], expanded: [0, 0xd800, 13, ...Array<number>(8).fill(32), 66], start: 1, end: 2 }
  ])("reports the first surrogate run in expanded code-point coordinates: $points", ({ points, expanded, start, end }) => {
    const input = Uint32Array.from(points);
    let caught: unknown;
    try { cleanDocstring(input, budget()); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(PythonEncodeError);
    const error = caught as PythonEncodeError;
    expect(error).toMatchObject({ name: "UnicodeEncodeError", encoding: "utf-8", start, end, reason: "surrogates not allowed" });
    expect([...error.object]).toEqual(expanded);
    input.fill(0);
    expect([...error.object]).toEqual(expanded);
  });

  it("does not merge surrogate pairs into valid supplementary characters", () => {
    expect(() => cleanDocstring(Uint32Array.of(0xd800, 0xdc00), budget())).toThrow("'utf-8' codec can't encode characters in position 0-1: surrogates not allowed");
    expect(cleanDocstring(Uint32Array.of(0x10000), budget())).toBe("𐀀");
  });

  it("bypasses encoding validation when class docstrings are stripped", () => {
    const analysis = analyzeModule('class C:\n "\\ud800"');
    const constants = { string: (value: string) => value, integer: (value: number) => value, tuple: (values: readonly unknown[]) => values };
    expect(() => compileClassBody(analysis.scopes.children[0], analysis, { stripDocstring: false }, constants, budget())).toThrow("surrogates not allowed");
    expect(compileClassBody(analysis.scopes.children[0], analysis, { stripDocstring: true }, constants, budget()).docstring).toBeUndefined();
  });

  it("charges retained error text before allocation and preserves fatal limit priority", () => {
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0 });
    expect(() => cleanDocstring(Uint32Array.of(9, 0xd800), meter)).toThrow(ExecutionLimitError);
    expect(meter.usage.allocatedBytes).toBe(0);
    expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
  });
});
