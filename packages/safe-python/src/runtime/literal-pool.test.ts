import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { compileLiteralPool, type LiteralExpression } from "./literal-pool.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

describe("compiled scalar literal pools", () => {
  it("merges equal typed values but not different types", () => {
    let allocations = 0;
    const pool = compileLiteralPool(analyzeModule('a=1000\nb=1000\nc=1000.0\nd=True\ne=b"abc"\nf="abc"').module.body,
      node => { allocations++; return { node }; }, budget());
    expect(pool.size).toBe(6); expect(allocations).toBe(5);
    const integers = [...pool].filter(([node]) => node.literalKind === "integer");
    expect(integers[0][1]).toBe(integers[1][1]);
  });
  it("keeps astral points distinct from adjacent lone surrogates", () => {
    const pool = compileLiteralPool(analyzeModule('a="😀"\nb="\\ud83d\\ude00"\nc="😀"').module.body, node => ({ node }), budget());
    const entries = [...pool];
    expect(new Set(entries.map(([, value]) => value)).size).toBe(2);
    expect(entries.filter(([node]) => (node.value as Uint32Array).length === 1)).toHaveLength(2);
  });
  it("does not allocate stripped docstrings or annotation expressions", () => {
    const source = '"module doc"\ndef f(x: ignored("annotation") = "default") -> ignored("return annotation"):\n "function doc"\n y: ignored("variable annotation") = "default"\n return "body"\nclass C:\n "class doc"\n value="class body"\n';
    const allocated: string[] = [];
    compileLiteralPool(analyzeModule(source).module.body, node => {
      if (node.literalKind === "string") allocated.push(String.fromCodePoint(...node.value as Uint32Array));
      return { node };
    }, budget());
    expect(allocated.sort()).toEqual(["body", "class body", "default"]);
  });
  it("distinguishes an undefined pooled value from a missing entry", () => {
    let allocations = 0;
    const pool = compileLiteralPool(analyzeModule('a="value"\nb="value"').module.body, () => { allocations++; return undefined; }, budget());
    expect(pool.size).toBe(2); expect(allocations).toBe(1);
    for (const node of pool.keys()) { expect(pool.has(node)).toBe(true); expect(pool.get(node)).toBeUndefined(); }
  });
  it("does not share a compilation's pool with another compilation", () => {
    const body = analyzeModule('a="long literal!"').module.body, allocate = (node: LiteralExpression) => ({ node });
    const first = compileLiteralPool(body, allocate, budget()), second = compileLiteralPool(body, allocate, budget());
    expect(first.values().next().value === second.values().next().value).toBe(false);
  });
  it("copies parser buffers into immutable runtime literals", () => {
    const meter = budget(), values = new RuntimeValues(meter), pool = compileLiteralPool(analyzeModule('a="abc"').module.body, values.literal.bind(values), meter);
    const [node, value] = [...pool][0];
    (node.value as Uint32Array)[0] = 120;
    if (value.kind !== "str") throw new Error("expected string");
    expect([...value.value]).toEqual([97, 98, 99]);
  });
  it("checks compilation budgets before allocating literal values", () => {
    let allocations = 0;
    expect(() => compileLiteralPool(analyzeModule('a="value"').module.body, () => { allocations++; return {}; }, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 100000 }))).toThrow(ExecutionLimitError);
    expect(allocations).toBe(0);
  });
  it("keeps signed zero and distinct synthetic NaN constants separate", () => {
    const numbers = [0, -0, NaN, NaN];
    const body = analyzeModule('a=0.0\nb=0.0\nc=0.0\nd=0.0').module.body.map((statement, index) => {
      if (statement.kind !== "assignment" || statement.value.kind !== "literal") throw new Error("expected literal assignment");
      return { ...statement, value: { ...statement.value, value: numbers[index] } };
    });
    const pool = compileLiteralPool(body, node => ({ node }), budget());
    expect(new Set(pool.values()).size).toBe(4);
  });
});
