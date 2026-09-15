import { describe, expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { translateString } from "./string-translation.js";

const points = (value: string) => new CodePointString(Uint32Array.from(value, character => character.codePointAt(0)!));
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

describe("string translation kernel", () => {
  it.each([
    ["ababa", undefined, "ababa", [97,98]],
    ["ababa", 98, "bbbbb", [97,98]],
    ["ababa", "x", "xbxbx", [97,98]],
    ["ababa", "xy", "xybxybxy", [97,97,98,97,98,97]],
    ["ababa", 233, "ébébé", [97,97,98,97,98,97]],
    ["ababa", null, "bb", [97,98]],
    ["aéa", null, "é", [97,233,233,97]],
    ["éaa", null, "é", [233,97,97]],
    ["aaa", "", "", [97,97,97,97]]
  ] as const)("translates %s with %s preserving lookup schedule", (source, replacement, expected, trace) => {
    const calls: number[] = [];
    const result = translateString(points(source), point => {
      calls.push(point);
      return point === 97 ? typeof replacement === "string" ? points(replacement) : replacement : undefined;
    }, budget());
    expect([...result]).toEqual([...points(expected)]);
    expect(calls).toEqual(trace);
  });
  it("does not inspect the mapping for empty input", () => {
    const source = points("");
    expect(translateString(source, () => { throw Error("unexpected lookup"); }, budget())).toBe(source);
  });
  it("propagates lookup failures", () => {
    const failure = new Error("lookup failed");
    expect(() => translateString(points("a"), () => { throw failure; }, budget())).toThrow(failure);
  });
  it("checks cancellation immediately after mapping callbacks", () => {
    let cancelled = false;
    expect(() => translateString(points("a"), () => { cancelled = true; return 98; }, {
      checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); }
    })).toThrow(ExecutionLimitError);
  });
});
