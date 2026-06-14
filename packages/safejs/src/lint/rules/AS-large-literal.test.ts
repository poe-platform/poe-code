import { describe, expect, it } from "vitest";

import { AS_LARGE_LITERAL } from "./AS-large-literal.js";

function arrayLiteral(size: number): string {
  return `[${Array.from({ length: size }, (_, index) => String(index)).join(", ")}]`;
}

function objectLiteral(size: number): string {
  return `{ ${Array.from({ length: size }, (_, index) => `k${index}: ${index}`).join(", ")} }`;
}

function codes(
  source: string,
  options: { filename?: string; largeLiteralThreshold?: number } = {}
): string[] {
  return AS_LARGE_LITERAL(source, { filename: "rule.js", ...options }).map(
    (diagnostic) => diagnostic.code
  );
}

describe("AS_LARGE_LITERAL", () => {
  it("allows array literals at the default threshold boundary", () => {
    expect(codes(`const value = ${arrayLiteral(1000)};`)).toEqual([]);
  });

  it("reports array literals above the default threshold", () => {
    const source = `const value = ${arrayLiteral(1001)};`;

    expect(AS_LARGE_LITERAL(source, { filename: "rule.js" })).toEqual([
      expect.objectContaining({
        code: "AS-LARGE-LITERAL",
        severity: "warning",
        filename: "rule.js",
        line: 1,
        column: 15,
        span: {
          start: { line: 1, column: 15, offset: source.indexOf("[") },
          end: { line: 1, column: source.length, offset: source.indexOf("]") + 1 }
        }
      })
    ]);
  });

  it("reports object literals above the default threshold", () => {
    expect(codes(`const value = ${objectLiteral(1001)};`)).toEqual(["AS-LARGE-LITERAL"]);
  });

  it("honors threshold overrides", () => {
    expect(codes(`const value = ${arrayLiteral(11)};`, { largeLiteralThreshold: 10 })).toEqual([
      "AS-LARGE-LITERAL"
    ]);
    expect(codes(`const value = ${arrayLiteral(10)};`, { largeLiteralThreshold: 10 })).toEqual([]);
  });

  it("reports nested array literals on the array span", () => {
    const source = `const value = { a: ${arrayLiteral(1001)} };`;
    const diagnostics = AS_LARGE_LITERAL(source, { filename: "rule.js" });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "AS-LARGE-LITERAL",
        span: {
          start: { line: 1, column: 20, offset: source.indexOf("[") },
          end: { line: 1, column: source.indexOf("]") + 2, offset: source.indexOf("]") + 1 }
        }
      })
    ]);
  });

  it("does not count spread elements toward the static element count", () => {
    expect(codes(`const value = [${"1, ".repeat(1000)}...extra];`)).toEqual([]);
  });

  it("reports array literals in catch parameter defaults", () => {
    expect(codes(`try {} catch ({ items = ${arrayLiteral(1001)} }) {}`)).toEqual([
      "AS-LARGE-LITERAL"
    ]);
  });
});
