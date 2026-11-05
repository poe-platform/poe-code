import { expect, it } from "vitest";
import { PdfDocument } from "../document.js";
import { cosArray, cosDict, cosName, cosNumber } from "../ast.js";
import { resolvePageFonts } from "../fonts/resolve.js";

for (const [size, bottom, top] of [[12, 117.516, 128.616], [20, 115.86, 134.36]] as const) {
  it(`uses Helvetica ascent and descent for ${size}pt word bounds`, () => {
    const doc = PdfDocument.create();
    doc.addPage([216, 144]).drawText("Hello", { x: 20, y: 120, size });
    const word = doc.extractPage(0).blocks[0]!.lines[0]!.words[0]!;
    expect(word.text).toBe("Hello");
    expect(word.bbox[1]).toBeCloseTo(bottom, 6);
    expect(word.bbox[3]).toBeCloseTo(top, 6);
  });
}

for (const cid of [false, true]) {
  it(`reads ${cid ? "CID" : "simple"} font descriptor bounds and normalizes their signs`, () => {
    const doc = PdfDocument.create();
    const descriptor = doc.cos.allocateObject(cosDict({ Ascent: cosNumber(-850), Descent: cosNumber(250) }));
    const font = cid
      ? cosDict({ Subtype: cosName("Type0"), DescendantFonts: cosArray([cosDict({ FontDescriptor: descriptor })]) })
      : cosDict({ Subtype: cosName("TrueType"), FontDescriptor: descriptor });
    const resolved = resolvePageFonts(doc.cos, cosDict({ Font: cosDict({ F1: font }) })).get("F1")!;
    expect(resolved.ascent).toBe(0.85);
    expect(resolved.descent).toBe(-0.25);
  });
}
