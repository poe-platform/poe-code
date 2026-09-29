import { expect, it } from "vitest";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosRef, cosStream, serializeCosDocument } from "./index.js";

it("preserves inherited page attributes when saving flattens a nested page tree", () => {
  const bytes = serializeCosDocument({
    rootRef: cosRef(1),
    objects: [
      { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
      { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Count: cosNumber(1), Kids: cosArray([cosRef(3)]) }) },
      { objectNumber: 3, generationNumber: 0, value: cosDict({
        Type: cosName("Pages"), Parent: cosRef(2), Count: cosNumber(1), Kids: cosArray([cosRef(4)]),
        MediaBox: cosArray([10, 20, 210, 120].map(n => cosNumber(n))),
        CropBox: cosArray([20, 30, 200, 110].map(n => cosNumber(n))),
        Rotate: cosNumber(90),
        Resources: cosDict({ Font: cosDict({ Inherited: cosRef(6) }) }),
      }) },
      { objectNumber: 4, generationNumber: 0, value: cosDict({ Type: cosName("Page"), Parent: cosRef(3), Contents: cosRef(5) }) },
      { objectNumber: 5, generationNumber: 0, value: cosStream(new TextEncoder().encode("BT /Inherited 12 Tf 30 70 Td (Retained) Tj ET")) },
      { objectNumber: 6, generationNumber: 0, value: cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier") }) },
    ],
  });
  const loaded = PdfDocument.load(bytes);
  expect(loaded.getPage(0).getSize()).toEqual({ width: 200, height: 100 });
  const saved = PdfDocument.load(loaded.save());
  const page = saved.getPage(0);
  expect(page.getMediaBox()).toEqual([10, 20, 210, 120]);
  expect(page.getCropBox()).toEqual([20, 30, 200, 110]);
  expect(page.getRotation()).toBe(90);
  expect(page.extractText()).toBe("Retained");
  expect(page.evaluateDisplayList().glyphs[0]?.fontName).toBe("Courier");
});
