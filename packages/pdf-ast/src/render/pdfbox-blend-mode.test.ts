/* Licensed to the Apache Software Foundation under Apache-2.0.
 * Adapted from PDFBox TestPDFRendererBlendMode at
 * c4d556abc9d5f0cbc486d459c84682321dd38ff4. Original size/pixels retained.
 * See THIRD_PARTY_NOTICES.md and licenses/PDFJS-APACHE-2.0.txt.
 */
import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";

describe("PDFBox ColorBurn viewer backdrop (PDFBOX-4095)", () => {
  it.each(["page", "form", "nested form", "self-referencing form"])("keeps a blue square visible through %s resources", scenario => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 200]);
    let resources = cosDict({ ExtGState: cosDict({ Burn: cosDict({ BM: cosName("ColorBurn") }) }) });
    let content = scenario === "self-referencing form" ? "0 0 1 rg 50 50 100 100 re f" : "/Burn gs 0 0 1 rg 50 50 100 100 re f";
    const depth = scenario === "page" ? 0 : scenario === "nested form" ? 2 : 1;
    for (let i = 0; i < depth; i++) {
      const form = cosStream(new TextEncoder().encode(content), { dict: cosDict({
        Type: cosName("XObject"), Subtype: cosName("Form"),
        BBox: cosArray([0, 0, 200, 200].map(n => cosNumber(n))), Resources: resources,
      }) });
      const ref = doc.cos.allocateObject(form);
      if (scenario === "self-referencing form") dictSet(resources, "XObject", cosDict({ Self: ref }));
      resources = cosDict({ XObject: cosDict({ Form: ref }) });
      content = "/Form Do";
    }
    dictSet(page.pageDict, "Resources", resources);
    page.setRawContentStream(new TextEncoder().encode(content));
    const bitmap = page.renderToBitmap({ scale: 1 });
    const pixel = (x: number, y: number) => Array.from(bitmap.data.subarray((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4));
    expect(pixel(100, 100)).toEqual([0, 0, 255, 255]);
    expect(pixel(25, 25)).toEqual([255, 255, 255, 255]);
  });
});
