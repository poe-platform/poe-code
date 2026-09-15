import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";
import * as safePython from "./index.js";

describe("Python expression parsing", () => {
  it("preserves inner expression spans independently of grouping delimiters",()=>{
    for(const source of ["(\n value\n)","((\n value\n))","(\n yield value\n)"]){
      const node=parseExpression(source);
      expect(node.start.line).toBe(1);expect(node.end.offset).toBe(source.length);
      expect(node.contentSpan?.start.line).toBe(2);expect(node.contentSpan?.end.line).toBe(2);
    }
    expect(parseExpression("(\n value,\n)").contentSpan).toBeUndefined();
  });
  it("is exposed through the package entry point", () => {
    expect(safePython).toHaveProperty("parseExpression", parseExpression);
  });
  it("gives multiplication precedence over addition", () => {
    expect(parseExpression("1 + 2 * 3")).toMatchObject({
      kind: "binary", operator: "+", left: { kind: "literal", value: 1n },
      right: { kind: "binary", operator: "*", left: { value: 2n }, right: { value: 3n } }
    });
  });
  it("makes exponentiation right associative and asymmetric with unary signs", () => {
    expect(parseExpression("-2 ** 3 ** -4")).toMatchObject({
      kind: "unary", operator: "-", operand: {
        kind: "binary", operator: "**", left: { value: 2n }, right: {
          kind: "binary", operator: "**", left: { value: 3n }, right: { kind: "unary", operator: "-", operand: { value: 4n } }
        }
      }
    });
  });
  it("keeps comparisons as a chain for single evaluation of intermediate operands", () => {
    expect(parseExpression("a < b <= c is not d not in e")).toMatchObject({
      kind: "comparison", operands: [
        { spelling: "a" }, { spelling: "b" }, { spelling: "c" }, { spelling: "d" }, { spelling: "e" }
      ], operators: ["<", "<=", "is not", "not in"]
    });
  });
  it("places not below comparisons and above and/or", () => {
    expect(parseExpression("not a == b and c or d")).toMatchObject({
      kind: "boolean", operator: "or", left: {
        kind: "boolean", operator: "and", left: { kind: "unary", operator: "not", operand: { kind: "comparison" } },
        right: { spelling: "c" }
      }, right: { spelling: "d" }
    });
  });
  it("makes conditional expressions right associative", () => {
    expect(parseExpression("a if b else c if d else e")).toMatchObject({
      kind: "conditional", consequent: { spelling: "a" }, condition: { spelling: "b" },
      alternate: { kind: "conditional", consequent: { spelling: "c" }, condition: { spelling: "d" }, alternate: { spelling: "e" } }
    });
  });
  it("honors grouping and left associativity", () => {
    expect(parseExpression("(1 + 2) * 3 - 4 - 5")).toMatchObject({
      kind: "binary", operator: "-", left: { kind: "binary", operator: "-", left: {
        kind: "binary", operator: "*", left: { operator: "+" }
      } }, right: { value: 5n }
    });
  });
  it.each(["True", "False", "None", "..."])("recognizes %s as a literal, not a variable", (text) => {
    expect(parseExpression(text).kind).toBe("literal");
  });
  it("preserves Python numeric and string representations", () => {
    expect(parseExpression("1j")).toMatchObject({ kind: "literal", literalKind: "imaginary", value: 1 });
    expect(parseExpression("'🙂'" )).toMatchObject({ kind: "literal", literalKind: "string", value: Uint32Array.from([0x1f642]) });
  });
  it("includes source spans and original name spelling for binding", () => {
    expect(parseExpression("𝒙 + 1")).toMatchObject({
      start: { offset: 0, line: 1, column: 0 }, end: { offset: 6, line: 1, column: 5 },
      left: { spelling: "𝒙" }
    });
  });
  it.each(["", "1 +", "a b", "1\n2", "a not b", "a is not", "a if b", "1 + not x", "not", "if", "return", "1 and", "(1 + 2"])(
    "rejects malformed expression %j", (text) => { expect(() => parseExpression(text)).toThrow(SyntaxError); }
  );
  it("reports the filename and unexpected token location", () => {
    expect(() => parseExpression("1 + )", { filename: "math.py" })).toThrow(expect.objectContaining({
      filename: "math.py", position: { offset: 4, line: 1, column: 4 }
    }));
  });
});
