import { describe, expect, it } from "vitest";
import { functionSources } from "./function-source.js";
import { parse, parseExecutableModule, parseModule, type FunctionExpression } from "./parser.js";

describe("function source ranges", () => {
  it("records the function range before grouping expands the ordinary span", () => {
    const source = "((function f (x) { /* keep */ return x; }))";
    const node = parse(source) as FunctionExpression;
    const range = functionSources.get(node)!;
    expect(range.text).toBe(source);
    expect(source.slice(range.start, range.end)).toBe("function f (x) { /* keep */ return x; }");
    expect(node.span.start.offset).toBe(0);
    expect(range.start).toBe(2);
    expect(Object.keys(node)).not.toContain("sourceRange");
  });

  it.each([parseModule, parseExecutableModule])(
    "shares the original source between nested ranges",
    (parseSource) => {
      const source = "function outer(){return function inner(){return 1}}";
      const module = parseSource(source);
      const outer = module.body[0];
      if (outer?.type !== "FunctionDeclaration") throw new Error("Expected outer function.");
      const statement = outer.body.body[0];
      if (
        statement?.type !== "ReturnStatement" ||
        statement.argument?.type !== "FunctionExpression"
      )
        throw new Error("Expected inner function.");
      const outerRange = functionSources.get(outer)!;
      const innerRange = functionSources.get(statement.argument)!;
      expect(outerRange.text).toBe(source);
      expect(innerRange.text).toBe(source);
      expect(innerRange.text.slice(innerRange.start, innerRange.end)).toBe(
        "function inner(){return 1}"
      );
    }
  );
});
