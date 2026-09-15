import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";

describe("adjacent Python literal concatenation", () => {
  it("concatenates different quote styles and text prefixes", () => {
    expect(parseExpression(String.raw`'a' "b" u'c' r'\n'`)).toMatchObject({
      kind: "literal", literalKind: "string", value: Uint32Array.from([97, 98, 99, 92, 110])
    });
  });
  it("concatenates bytes without decoding them as text", () => {
    expect(parseExpression(String.raw`b'\xff' B'\0' br'\n'`)).toMatchObject({
      literalKind: "bytes", value: Uint8Array.from([255, 0, 92, 110])
    });
  });
  it("preserves surrogate boundaries across literals", () => {
    expect(parseExpression(String.raw`'\ud800' '\udc00' '𐀀'`)).toMatchObject({
      value: Uint32Array.from([0xd800, 0xdc00, 0x10000])
    });
  });
  it("crosses comments only within a joined logical line", () => {
    expect(parseExpression("('a' # comment\n'b')")).toMatchObject({ value: Uint32Array.from([97, 98]) });
    expect(parseExpression("'a' \\\n'b'")).toMatchObject({ value: Uint32Array.from([97, 98]) });
    expect(() => parseExpression("'a' # comment\n'b'")).toThrow(SyntaxError);
  });
  it.each(["'a' b'b'", "b'a' 'b'", "u'a' br'b'"])("rejects mixed text and bytes in %s", (text) => {
    expect(() => parseExpression(text)).toThrow("cannot mix bytes and nonbytes literals");
  });
  it("concatenates before applying primary trailers", () => {
    expect(parseExpression("'ab' 'cd'[1:]")).toMatchObject({
      kind: "subscript", object: { kind: "literal", value: Uint32Array.from([97, 98, 99, 100]) }
    });
  });
  it("retains the full source span", () => {
    expect(parseExpression("'a'  'b'")).toMatchObject({
      start: { offset: 0, line: 1, column: 0 }, end: { offset: 8, line: 1, column: 8 }
    });
  });
  it("handles long adjacent sequences without growing the parser call stack", () => {
    const expression = parseExpression(Array.from({ length: 1000 }, () => "'x'").join(" "));
    expect(expression).toMatchObject({ value: Uint32Array.from({ length: 1000 }, () => 120) });
  });
});
