/* Licensed to the Apache Software Foundation under Apache-2.0.
 * Adapted from Apache PDFBox c4d556abc9d5f0cbc486d459c84682321dd38ff4.
 * See THIRD_PARTY_NOTICES.md and licenses/PDFJS-APACHE-2.0.txt.
 */
import { describe, expect, it } from "vitest";
import { PdfDocument } from "./document.js";
import { cosHexString, cosString, decodePdfString } from "./ast.js";

// TestCOSString and PDFDocEncodingTest: compare decoded strings because local
// COS nodes preserve source format and bytes rather than Java value equality.
describe("PDFBox strings", () => {
  it.each([
    "世", "This is some regular text. It should all be expressible in ASCII",
    "En français où les choses sont accentués. En español, así", "をクリックしてく",
    "Line1\nLine2\nLine3\n", "( test#some) escaped< \\chars>!~1239857 ",
  ])("round trips Unicode %j", value => {
    expect(decodePdfString(cosString(value))).toBe(value);
  });

  it("preserves edited metadata through save and reopen", () => {
    const doc = PdfDocument.create();
    doc.addPage([100, 100]);
    const title = "A\u00a0B\u00adC • €";
    doc.setMetadata({ title });
    expect(PdfDocument.load(doc.save()).getMetadata().title).toBe(title);
  });

  it.each(["FEFF", "FFFE"])("decodes empty BOM-only string %s (PDFBOX-3881)", hex => {
    expect(decodePdfString(cosHexString(hex))).toBe("");
  });

  it("keeps distinct binary strings (PDFBOX-2401)", () => {
    expect(cosHexString("000000FF000000").bytes).not.toEqual(cosHexString("000000FF00FFFF").bytes);
  });

  it.each([
    0x02d8, 0x02c7, 0x02c6, 0x02d9, 0x02dd, 0x02db, 0x02da, 0x02dc,
    0x2022, 0x2020, 0x2021, 0x2026, 0x2014, 0x2013, 0x0192, 0x2044,
    0x2039, 0x203a, 0x2212, 0x2030, 0x201e, 0x201c, 0x201d, 0x2018,
    0x2019, 0x201a, 0x2122, 0xfb01, 0xfb02, 0x0141, 0x0152, 0x0160,
    0x0178, 0x017d, 0x0131, 0x0142, 0x0153, 0x0161, 0x017e, 0x20ac,
  ])("round trips PDFDocEncoding deviation U+%s", code => {
    const value = String.fromCharCode(code);
    expect(decodePdfString(cosString(value))).toBe(value);
  });

  it.each(Array.from({ length: 256 }, (_, i) => i))(
    "preserves character %i outside PDFDocEncoding (PDFBOX-3864)", code => {
      const decoded = decodePdfString(cosHexString(`FEFF${code.toString(16).padStart(4, "0")}`));
      expect(decodePdfString(cosString(decoded))).toBe(decoded);
    }
  );
});
