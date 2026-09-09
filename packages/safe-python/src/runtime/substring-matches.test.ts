import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { substringMatches } from "./substring-search.js";
import { CodePointString } from "./code-point-string.js";

const points = (text: string) => Uint32Array.from([...text].map(c => c.codePointAt(0)!));

describe("directional nonoverlapping substring matches", () => {
  it("resolves overlapping candidates in traversal order", () => {
    const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 });
    expect([...substringMatches(points("ababa"), points("aba"), false, meter)]).toEqual([0]);
    expect([...substringMatches(points("ababa"), points("aba"), true, meter)]).toEqual([2]);
  });
  it.each([false, true])("reuses one prefix table for many matches (reverse=%s)", reverse => {
    const meter = new ExecutionBudget({ maxSteps: 4000, maxAllocatedBytes: 76 });
    const matches = [...substringMatches(points("aba".repeat(1000)), points("aba"), reverse, meter)];
    expect(matches).toHaveLength(1000);
    expect(matches[0]).toBe(reverse ? 2997 : 0);
    expect(matches[999]).toBe(reverse ? 0 : 2997);
  });
  it.each([false, true])("bounds repetitive failed-prefix work (reverse=%s)", reverse => {
    const meter = new ExecutionBudget({ maxSteps: 5000, maxAllocatedBytes: 1000 });
    expect([...substringMatches(points("a".repeat(1000) + "b" + "a".repeat(1000)), points("a".repeat(100) + "b"), reverse, meter)]).toEqual([900]);
  });
  it("can stop a reverse scan immediately after its first match", () => {
    const meter = new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 72 });
    const iterator = substringMatches(points("x".repeat(10000) + "ab"), points("ab"), true, meter);
    expect(iterator.next().value).toBe(10000);
    iterator.return?.();
  });
  it("terminates unbounded scans through the execution budget", () => {
    const meter = new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 1000 });
    expect(() => [...substringMatches(points("a".repeat(1000)), points("b"), false, meter)]).toThrow(ExecutionLimitError);
  });
  it("does no separator search or copy for a zero explicit split limit", () => {
    const source = new CodePointString(points("payload")), separator = new CodePointString(points("load"));
    const meter = new ExecutionBudget({ maxSteps: 2, maxAllocatedBytes: 64 });
    const result = [...source.split(separator, 0n, false, meter)];
    expect(result).toHaveLength(1); expect(result[0]).toBe(source);
  });
});
