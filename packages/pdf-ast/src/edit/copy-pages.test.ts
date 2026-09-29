import { describe, expect, it } from "vitest";
import { PdfDocument, cosArray, cosDict, cosName, dictGet, dictSet } from "../index.js";

function sourceDocument() {
  const doc = PdfDocument.create();
  doc.addPage([200, 200]).drawText("Original", { x: 20, y: 120, size: 15 });
  return doc;
}

describe("copying pages", () => {
  // Ported from pypdf 6.19.0 tests/test_writer.py::test_append_multiple.
  // Replace the downloaded fixture with an in-memory page and check all copies.
  it("gives repeated pages distinct identities across both append batches", () => {
    const source = sourceDocument();
    const target = PdfDocument.create();
    target.copyPagesFrom(source, [0, 0, 0]);
    target.copyPagesFrom(source, [0, 0, 0]);
    expect(new Set(target.getPages().map(page => page.ref.objectNumber)).size).toBe(6);
    const saved = PdfDocument.load(target.save());
    expect(saved.pageCount).toBe(6);
    expect(saved.getPages().map(page => page.extractText())).toEqual(Array(6).fill("Original"));
  });

  it.each([false, true])("edits only the selected copy through save/reopen (incremental=%s)", incremental => {
    const source = sourceDocument();
    const target = PdfDocument.create();
    target.copyPagesFrom(source, [0, 0]);
    target.getPage(0).drawText("First copy", { x: 20, y: 60, size: 15 });
    const saved = PdfDocument.load(target.save());
    expect(saved.pageCount).toBe(2);
    expect(saved.getPage(0).extractText()).toContain("First copy");
    expect(saved.getPage(1).extractText()).toBe("Original");
    saved.getPage(1).setRawContentStream("BT /F1 15 Tf 20 60 Td (Second copy) Tj ET");
    const reopened = PdfDocument.load(saved.save({ incremental }));
    expect(reopened.getPage(0).extractText()).toContain("First copy");
    expect(reopened.getPage(1).extractText()).toBe("Second copy");
    expect(source.getPage(0).extractText()).toBe("Original");
  });

  it("isolates edits when distinct imported pages share a content stream", () => {
    const source = sourceDocument();
    const second = source.addPage([200, 200]);
    dictSet(second.pageDict, "Contents", dictGet(source.getPage(0).pageDict, "Contents")!);
    dictSet(second.pageDict, "Resources", source.getPage(0).getResourcesDict());
    const target = PdfDocument.create();
    target.copyPagesFrom(source, [0, 1]);
    target.getPage(0).setRawContentStream("BT /F1 15 Tf 20 60 Td (Edited) Tj ET");
    const saved = PdfDocument.load(target.save());
    expect(saved.getPages().map(page => page.extractText())).toEqual(["Edited", "Original"]);
  });

  it("retains cross-page link destinations when pages are reordered", () => {
    const source = sourceDocument();
    const second = source.addPage([200, 200]);
    dictSet(source.getPage(0).pageDict, "Annots", cosArray([cosDict({
      Subtype: cosName("Link"), Dest: cosArray([second.ref, cosName("Fit")]),
    })]));
    const target = PdfDocument.create();
    target.copyPagesFrom(source, [1, 0]);
    const saved = PdfDocument.load(target.save());
    const annots = saved.cos.resolveArray(dictGet(saved.getPage(1).pageDict, "Annots"))!;
    const link = saved.cos.resolveDict(annots.items[0])!;
    const dest = saved.cos.resolveArray(dictGet(link, "Dest"))!;
    expect(dest.items[0]).toMatchObject({ kind: "ref", objectNumber: saved.getPage(0).ref.objectNumber, generationNumber: 0 });
  });
});
