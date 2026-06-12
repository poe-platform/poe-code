import { describe, expect, it } from "vitest";

import { parse, type SwitchStatement } from "../parse.js";

describe("switch parsing", () => {
  it("parses cases and default in source order", () => {
    const node = parse("switch (value) { default: fallback(); case 1: match(); break; }");

    expect(node.type).toBe("SwitchStatement");
    const statement = node as SwitchStatement;
    expect(statement.discriminant.type).toBe("Identifier");
    expect(statement.cases.map((switchCase) => switchCase.test?.type)).toEqual([
      undefined,
      "NumericLiteral"
    ]);
    expect(statement.cases.map((switchCase) => switchCase.consequent.length)).toEqual([1, 2]);
  });

  it("assigns node ids to switch statements and cases", () => {
    const node = parse("switch (value) { case 1: run(); break; default: fallback(); }");

    expect(node.type).toBe("SwitchStatement");
    const statement = node as SwitchStatement;
    expect(statement.nodeId).toEqual(expect.any(Number));
    expect(statement.cases.map((switchCase) => switchCase.nodeId)).toEqual([
      expect.any(Number),
      expect.any(Number)
    ]);
  });

  it("rejects duplicate default clauses", () => {
    expect(() => parse("switch (value) { default: first(); default: second(); }")).toThrowError(
      /duplicate default/i
    );
  });
});
