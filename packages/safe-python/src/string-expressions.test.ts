import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";

describe("adjacent interpolated literals", () => {
  it.each(['"a" f"{x}" "b"', 'f"a{x}" "b"', '"a" f"{x}b"'])("combines %s", text => {
    expect(parseExpression(text)).toMatchObject({ kind: "interpolated-string", flavor: "formatted", parts: [
      { kind: "text", value: Uint32Array.from([97]) }, { kind: "field", expression: { spelling: "x" } }, { kind: "text", value: Uint32Array.from([98]) }
    ] });
  });

  it("coalesces contiguous text and keeps field order", () => {
    expect(parseExpression('f"a" "b" f"{x}" f"{y}" "c" f"d"')).toMatchObject({ parts: [
      { value: Uint32Array.from([97, 98]) }, { expression: { spelling: "x" } }, { expression: { spelling: "y" } }, { value: Uint32Array.from([99, 100]) }
    ] });
    expect(parseExpression('t"a{x}" t"b{y}"')).toMatchObject({ flavor: "template", parts: [
      { value: Uint32Array.from([97]) }, { expression: { spelling: "x" } }, { value: Uint32Array.from([98]) }, { expression: { spelling: "y" } }
    ] });
  });

  it("preserves interpolated kind for empty and field-free strings", () => {
    expect(parseExpression('"" f""')).toMatchObject({ kind: "interpolated-string", flavor: "formatted", parts: [] });
    expect(parseExpression('t"" t""')).toMatchObject({ kind: "interpolated-string", flavor: "template", parts: [] });
    expect(parseExpression('"a" f"b"')).toMatchObject({ kind: "interpolated-string", parts: [{ value: Uint32Array.from([97, 98]) }] });
  });

  it("joins logical lines and binds trailers to the whole string sequence", () => {
    expect(parseExpression('(f"a" # comment\n "b").upper()')).toMatchObject({ kind: "call", callee: { kind: "attribute", object: { kind: "interpolated-string", parts: [{ value: Uint32Array.from([97, 98]) }] } } });
    expect(parseExpression('f"a" \\\n "b"')).toMatchObject({ parts: [{ value: Uint32Array.from([97, 98]) }] });
  });

  it("retains code points, debug fields, and total source span", () => {
    expect(parseExpression(String.raw`f"\uD800" "\uDC00" f"{x=}"`)).toMatchObject({ start: { offset: 0 }, parts: [
      { value: Uint32Array.from([0xd800, 0xdc00]) }, { debugText: "x=", conversion: "r" }
    ] });
    expect(parseExpression('f"a" "b"')).toMatchObject({ start: { offset: 0 }, end: { offset: 8 } });
  });

  it("assembles long text sequences without losing segments", () => {
    const text = Array.from({ length: 1000 }, (_, i) => i % 2 ? '"a"' : 'f"a"').join(" ");
    expect(parseExpression(text)).toMatchObject({ parts: [{ value: new Uint32Array(1000).fill(97) }] });
  });

  it.each(['t"a" "b"', '"a" t"b"', 't"a" f"b"', 'f"a" t"b"', 'b"a" f"b"', 'f"a" b"b"', 'b"a" t"b"', 't"a" b"b"', 'f"a"\n"b"'])
    ("rejects incompatible or separate literals %s", text => { expect(() => parseExpression(text)).toThrow(SyntaxError); });
});
