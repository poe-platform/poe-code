import { expect, it } from "vitest";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, dictGet, dictSet } from "../index.js";

it.each(["form", "annotation", "pattern"])("keeps images used through a %s when cleaning redacted output", kind => {
  const doc = PdfDocument.create();
  const page = doc.addPage([100, 100]);
  page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([7, 13, 29])), {
    x: 10, y: 10, width: 20, height: 20,
  });
  const content = page.getRawContentStream();
  const resources = page.getResourcesDict();
  const box = cosArray([0, 0, 100, 100].map(n => cosNumber(n)));
  const formDict = cosDict({ Type: cosName("XObject"), Subtype: cosName("Form"), BBox: box });
  const form = doc.cos.allocateObject(cosStream(content, { dict: formDict }));
  if (kind === "form") {
    const xobjects = doc.cos.resolveDict(dictGet(resources, "XObject"))!;
    dictSet(xobjects, "Wrapper", form);
    page.setContentAst([{ kind: "xobject", name: "Wrapper" }]);
  } else if (kind === "annotation") {
    page.setContentAst([]);
    dictSet(page.pageDict, "Annots", cosArray([cosDict({
      Type: cosName("Annot"), Subtype: cosName("Stamp"), Rect: box,
      AP: cosDict({ N: form }),
    })]));
  } else {
    const pattern = doc.cos.allocateObject(cosStream(content, { dict: cosDict({
      Type: cosName("Pattern"), PatternType: cosNumber(1), PaintType: cosNumber(1),
      TilingType: cosNumber(1), BBox: box, XStep: cosNumber(100), YStep: cosNumber(100),
    }) }));
    dictSet(resources, "Pattern", cosDict({ Painted: pattern }));
    page.setRawContentStream("/Pattern cs /Painted scn 0 0 100 100 re f");
  }
  expect(page.evaluateDisplayList().images.length).toBeGreaterThan(0);
  page.redact([-10, -10, -5, -5]);
  const saved = PdfDocument.load(doc.save());
  const images = saved.getPage(0).evaluateDisplayList().images;
  expect(images.length).toBeGreaterThan(0);
  expect([...images[0]!.decodedRgba!]).toEqual([7, 13, 29, 255]);
});
