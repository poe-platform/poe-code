/* Licensed to the Apache Software Foundation under Apache-2.0.
 * Adapted from Apache PDFBox c4d556abc9d5f0cbc486d459c84682321dd38ff4.
 * See THIRD_PARTY_NOTICES.md and licenses/PDFJS-APACHE-2.0.txt.
 */
import { describe, expect, it } from "vitest";
import { CosByteLexer } from "./lexer.js";

// TestCOSParser and TestCOSNumber: original inputs/expectations via token API.
describe("PDFBox COS parsing", () => {
  it.each([
    ["(Test)", "Test"],
    ["((Test)\n/ ", "(Test"], ["((Test)\r/ ", "(Test"],
    ["((Test)\r\n/", "(Test"], ["((Test)\n> ", "(Test"],
    ["((Test)\r> ", "(Test"], ["((Test)\r\n>", "(Test"],
  ])("recovers literal %j", (input, expected) => {
    const lexer = new CosByteLexer(new TextEncoder().encode(input));
    expect(lexer.nextToken()).toMatchObject({ kind: "string", bytes: new TextEncoder().encode(expected) });
  });

  it("preserves a balanced nested string across a dictionary-like line", () => {
    const input = "((Test)\n/Name)";
    expect(new CosByteLexer(new TextEncoder().encode(input)).nextToken()).toMatchObject({
      kind: "string", bytes: new TextEncoder().encode("(Test)\n/Name"),
    });
  });

  it("leaves the following dictionary field available after recovery", () => {
    const lexer = new CosByteLexer(new TextEncoder().encode("((Test)\n/Author (Ada) >>"));
    expect(lexer.nextToken()).toMatchObject({ kind: "string", bytes: new TextEncoder().encode("(Test") });
    expect(lexer.nextToken()).toMatchObject({ kind: "name", decoded: "Author" });
    expect(lexer.nextToken()).toMatchObject({ kind: "string", bytes: new TextEncoder().encode("Ada") });
    expect(lexer.nextToken()).toMatchObject({ kind: "dict-end" });
  });

  it("retains the explicit string byte budget during recovery", () => {
    const lexer = new CosByteLexer(new TextEncoder().encode("((Test)\n/Author (Ada) >>"), 0, undefined, 3);
    expect(() => lexer.nextToken()).toThrow(/maximum byte length/);
  });

  it.each([
    ["/Name1 ", "Name1"], ["/ASomewhatLongerName ", "ASomewhatLongerName"],
    ["/A;Name_With-Various***Characters? ", "A;Name_With-Various***Characters?"],
    ["/1.2 ", "1.2"], ["/$$ ", "$$"], ["/@pattern ", "@pattern"],
    ["/#2Enotdef ", ".notdef"], ["/lime#20Green ", "lime Green"],
    ["/paired#28#29parentheses ", "paired()parentheses"],
    ["/The_Key_of_F#23_Minor ", "The_Key_of_F#_Minor"], ["/A#42 ", "AB"],
    ["/ ", ""], ["/Name\0Extra ", "Name"], ["/Name#GG ", "Name#GG"],
    ["/Name#2fTest ", "Name/Test"], ["/Name#2FTest ", "Name/Test"],
    ...[">", "<", "[", "]", "(", ")", "/", "%"].map((delimiter, i) => [`/Name${i + 1}${delimiter}`, `Name${i + 1}`]),
  ])("parses name %j", (input, decoded) => {
    expect(new CosByteLexer(new TextEncoder().encode(input)).nextToken()).toMatchObject({ kind: "name", decoded });
  });

  it.each(["0", "-", ".", "1", "2", "3", "100", "256", "-1000", "+2000", "1.1", "100.0", "-100.001", "-2e-006", "-8e+05"])(
    "parses number %s", input => {
      expect(new CosByteLexer(new TextEncoder().encode(input)).nextToken()).toMatchObject({
        kind: "number", value: input === "-" || input === "." ? 0 : Number(input),
      });
    }
  );
});
