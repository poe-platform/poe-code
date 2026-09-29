import { describe, expect, it } from "vitest";
import { PdfDocument } from "../document.js";
import { CosByteLexer } from "./lexer.js";

describe("lexer token boundaries and progress", () => {
  it.each(["{", "}"])("consumes delimiter %s rather than returning an empty token forever", raw => {
    const lexer = new CosByteLexer(new TextEncoder().encode(raw));
    expect(lexer.nextToken()).toMatchObject({ kind: "keyword", value: raw, span: { start: 0, end: 1 } });
    expect(lexer.nextToken()).toBeUndefined();
  });

  it("advances past an illegal closing parenthesis even when a caller catches the error", () => {
    const lexer = new CosByteLexer(new TextEncoder().encode(") q"));
    expect(() => lexer.nextToken()).toThrow();
    expect(lexer.nextToken()).toMatchObject({ kind: "keyword", value: "q" });
  });

  it.each(["1e-7", "1E+8", "-.5e2"])("preserves existing exponent support for %s", raw => {
    const lexer = new CosByteLexer(new TextEncoder().encode(`${raw}ET`));
    expect(lexer.nextToken()).toMatchObject({ kind: "number", value: Number(raw) });
    expect(lexer.nextToken()).toMatchObject({ kind: "keyword", value: "ET" });
  });

  it("enforces a byte budget on numeric tokens before consuming the following operator", () => {
    const bytes = new TextEncoder().encode("1234ET");
    const lexer = new CosByteLexer(bytes, 0, bytes.length, 3);
    expect(() => lexer.nextToken()).toThrow(/token.*byte/i);
  });

  it.each(["--7", "-.7", "-\r\n7"])("respects the supplied end offset inside %j", raw => {
    const lexer = new CosByteLexer(new TextEncoder().encode(raw), 0, 1);
    expect(lexer.nextToken()).toMatchObject({ kind: "number", value: 0, span: { start: 0, end: 1 } });
    expect(lexer.nextToken()).toBeUndefined();
  });

  it("extracts text from real content with glued numeric operators", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);
    const name = page.ensureStandardFontResource("Helvetica");
    page.setRawContentStream(`BT /${name} 12Tf 10 50Td (Readable) Tj ET`);
    expect(doc.extractText()).toBe("Readable");
    expect(page.evaluateDisplayList().glyphs[0]).toMatchObject({ fontSize: 12, baselineY: 50 });
  });
});
