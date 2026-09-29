import { expect, it } from "vitest";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, cosString, dictDelete, dictGet, dictSet, flattenDocumentFormFields } from "../index.js";

it.each([false, true])("preserves appearance bytes and colliding resources (inherited: %s)", inherited => {
  const doc = PdfDocument.create(); const page = doc.addPage([300, 160]);
  page.drawText("Page header", { x: 10, y: 140, size: 12 });
  const sharedResources = doc.cos.resolveDict(dictGet(page.pageDict, "Resources"))!;
  const originalEntries = [...sharedResources.entries];
  if (inherited) {
    dictSet(doc.cos.resolveDict(dictGet(page.pageDict, "Parent"))!, "Resources", sharedResources);
    dictDelete(page.pageDict, "Resources");
  }
  const font = doc.cos.allocateObject(cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier"), Encoding: cosName("WinAnsiEncoding") }));
  const prefix = new TextEncoder().encode("BT /F1 12 Tf 2 30 Td (");
  const text = Uint8Array.of(0x95, 0x20, 0x80, 0x20, 0x97, 0x20, ...new TextEncoder().encode("/F1 literal"));
  const middle = new TextEncoder().encode(") Tj ET q 60 0 0 10 0 0 cm BI /W 6 /H 1 /BPC 8 /CS /G ID ");
  const pixels = Uint8Array.of(0x80,0x95,0x97,0xa0,0xc0,0xff);
  const suffix = new TextEncoder().encode(" EI Q");
  const bytes = Uint8Array.from([...prefix, ...text, ...middle, ...pixels, ...suffix]);
  const appearance = doc.cos.allocateObject(cosStream(bytes, { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Form"),
    BBox: cosArray([0,0,200,60].map(n => cosNumber(n))), Resources: cosDict({ Font: cosDict({ F1: font }) }),
  }), compress: true }));
  const originalAppearance = doc.cos.resolve(appearance)!;
  const widget = doc.cos.allocateObject(cosDict({
    Type: cosName("Annot"), Subtype: cosName("Widget"), FT: cosName("Tx"), T: cosString("field"),
    Rect: cosArray([20,30,220,90].map(n => cosNumber(n))), AP: cosDict({ N: appearance }),
  }));
  dictSet(page.pageDict,"Annots",cosArray([widget]));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!,"AcroForm",cosDict({Fields:cosArray([widget])}));
  flattenDocumentFormFields(doc.cos);
  expect(sharedResources.entries).toEqual(originalEntries);
  const loaded=PdfDocument.load(doc.save()); const display=loaded.getPage(0).evaluateDisplayList();
  const resources = loaded.cos.resolveDict(dictGet(loaded.getPage(0).pageDict, "Resources"))!;
  const xObjects = loaded.cos.resolveDict(dictGet(resources, "XObject"))!;
  const preserved = loaded.cos.resolve(xObjects.entries[0]!.value)!;
  if (preserved.kind !== "stream" || originalAppearance.kind !== "stream") throw new Error("Missing appearance stream");
  expect(preserved.rawBytes).toEqual(originalAppearance.rawBytes);
  expect(display.glyphs.map(g => g.unicode).join("")).toContain("Page header");
  expect(display.glyphs.map(g => g.unicode).join("")).toContain("• € — /F1 literal");
  expect(display.glyphs.find(g => g.unicode === "•")?.fontName).toBe("Courier");
  expect(display.images).toHaveLength(1);
  expect([...display.images[0]!.decodedRgba!].filter((_,i)=>i%4===0)).toEqual([...pixels]);
  expect(loaded.cos.resolveArray(dictGet(loaded.getPage(0).pageDict,"Annots"))?.items ?? []).toHaveLength(0);
});
