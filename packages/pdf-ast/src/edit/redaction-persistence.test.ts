import { describe, expect, it } from "vitest";
import {
  PdfDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  dictGet,
  dictDelete,
  dictSet,
  type SavePdfOptions,
} from "../index.js";

function decodedStreams(doc: PdfDocument): string[] {
  return [...doc.cos.objects.values()].flatMap(({ value }) =>
    value.kind === "stream" ? [new TextDecoder().decode(doc.cos.decodeStream(value))] : []
  );
}

describe("redaction persistence", () => {
  it.each(["direct", "indirect"])("removes obsolete %s Contents array streams from saved bytes", shape => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    page.drawText("SECRET", { x: 10, y: 50 });
    const original = dictGet(page.pageDict, "Contents")!;
    const array = cosArray([original]);
    dictSet(page.pageDict, "Contents", shape === "direct" ? array : doc.cos.allocateObject(array));
    const loaded = PdfDocument.load(doc.save());
    loaded.getPage(0).redact([0, 0, 200, 100]);
    const saved = PdfDocument.load(loaded.save());
    expect(saved.extractText()).toBe("");
    expect(decodedStreams(saved).join("\n")).not.toContain("SECRET");
  });

  it.each<SavePdfOptions>([
    { incremental: true },
    { objectStreams: "generate" },
    { normalizeContent: true },
    { encrypt: { userPassword: "review", ownerPassword: "owner" } },
  ])("does not retain original streams or revisions with save options %j", options => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    page.drawText("SECRET", { x: 10, y: 50 });
    const array = cosArray([dictGet(page.pageDict, "Contents")!]);
    dictSet(page.pageDict, "Contents", array);
    const loaded = PdfDocument.load(doc.save({ objectStreams: "generate" }));
    loaded.getPage(0).redact([0, 0, 200, 100]);
    const bytes = loaded.save(options);
    const saved = PdfDocument.load(bytes, { password: "review" });
    expect(saved.extractText()).toBe("");
    expect(decodedStreams(saved).join("\n")).not.toContain("SECRET");
    expect(saved.cos.revisions).toHaveLength(1);
  });

  it("does not edit another page that shares the original content stream", () => {
    const doc = PdfDocument.create();
    const first = doc.addPage([200, 100]);
    first.drawText("SHARED", { x: 10, y: 50 });
    const second = doc.addPage([200, 100]);
    dictSet(second.pageDict, "Contents", dictGet(first.pageDict, "Contents")!);
    dictSet(second.pageDict, "Resources", dictGet(first.pageDict, "Resources")!);
    const loaded = PdfDocument.load(doc.save());
    loaded.getPage(0).redact([0, 0, 200, 100]);
    const saved = PdfDocument.load(loaded.save());
    expect(saved.getPage(0).extractText()).toBe("");
    expect(saved.getPage(1).extractText()).toBe("SHARED");
  });

  it("removes the image resource and its bytes when its last placement is redacted", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);
    const image = doc.embedRgbImage(2, 1, new Uint8Array([7, 13, 29, 31, 43, 53]));
    page.drawImage(image, { x: 10, y: 10, width: 20, height: 20 });
    const loaded = PdfDocument.load(doc.save());
    loaded.getPage(0).redact([0, 0, 50, 50]);
    const saved = PdfDocument.load(loaded.save());
    expect(saved.getPage(0).evaluateDisplayList().images).toHaveLength(0);
    expect([...saved.cos.objects.values()].filter(({ value }) =>
      value.kind === "stream" && dictGet(value.dict, "Subtype")?.kind === "name" &&
      (dictGet(value.dict, "Subtype") as { decoded: string }).decoded === "Image"
    )).toHaveLength(0);
  });

  it("preserves another page's image when resource dictionaries are shared", () => {
    const doc = PdfDocument.create();
    const first = doc.addPage([100, 100]);
    const image = doc.embedRgbImage(1, 1, new Uint8Array([7, 13, 29]));
    first.drawImage(image, { x: 10, y: 10, width: 20, height: 20 });
    const second = doc.addPage([100, 100]);
    dictSet(second.pageDict, "Contents", dictGet(first.pageDict, "Contents")!);
    dictSet(second.pageDict, "Resources", dictGet(first.pageDict, "Resources")!);
    const loaded = PdfDocument.load(doc.save());
    loaded.getPage(0).redact([0, 0, 50, 50]);
    const saved = PdfDocument.load(loaded.save());
    expect(saved.getPage(0).evaluateDisplayList().images).toHaveLength(0);
    expect(saved.getPage(1).evaluateDisplayList().images).toHaveLength(1);
  });

  it("removes discarded image bytes inherited from the parent Pages resources", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);
    page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([7, 13, 29])), {
      x: 10, y: 10, width: 20, height: 20,
    });
    const parent = doc.cos.resolveDict(dictGet(page.pageDict, "Parent"))!;
    dictSet(parent, "Resources", dictGet(page.pageDict, "Resources")!);
    page.pageDict.entries.splice(page.pageDict.entries.findIndex(entry => entry.key.decoded === "Resources"), 1);
    const loaded = PdfDocument.load(doc.save());
    expect(loaded.getPage(0).evaluateDisplayList().images).toHaveLength(1);
    loaded.getPage(0).redact([0, 0, 50, 50]);
    const saved = PdfDocument.load(loaded.save());
    expect([...saved.cos.objects.values()].filter(({ value }) => {
      const subtype = value.kind === "stream" ? dictGet(value.dict, "Subtype") : undefined;
      return subtype?.kind === "name" && subtype.decoded === "Image";
    })).toHaveLength(0);
  });

  it("does not retain a redacted image through an unused resource on another page", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);
    page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([7, 13, 29])), {
      x: 10, y: 10, width: 20, height: 20,
    });
    const parent = doc.cos.resolveDict(dictGet(page.pageDict, "Parent"))!;
    dictSet(parent, "Resources", dictGet(page.pageDict, "Resources")!);
    dictDelete(page.pageDict, "Resources");
    const blank = doc.addPage([100, 100]);
    dictDelete(blank.pageDict, "Resources");
    const loaded = PdfDocument.load(doc.save());
    loaded.getPage(0).redact([0, 0, 50, 50]);
    const saved = PdfDocument.load(loaded.save());
    expect(saved.getPage(1).evaluateDisplayList().images).toHaveLength(0);
    expect([...saved.cos.objects.values()].filter(({ value }) => {
      const subtype = value.kind === "stream" ? dictGet(value.dict, "Subtype") : undefined;
      return subtype?.kind === "name" && subtype.decoded === "Image";
    })).toHaveLength(0);
  });

  it("removes a discarded Form XObject and its confidential stream", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    page.drawText("VISIBLE", { x: 10, y: 80 });
    const resources = page.getResourcesDict();
    const form = doc.cos.allocateObject(cosStream(new TextEncoder().encode("BT /F1 12 Tf 10 50 Td (SECRET) Tj ET"), {
      dict: cosDict({
        Type: cosName("XObject"), Subtype: cosName("Form"),
        BBox: cosArray([0, 0, 200, 100].map(n => cosNumber(n))),
        Resources: cosDict({ Font: dictGet(resources, "Font")! }),
      }),
    }));
    dictSet(resources, "XObject", cosDict({ Confidential: form }));
    page.setContentAst([...page.getContentAst(), { kind: "xobject", name: "Confidential" }]);
    const loaded = PdfDocument.load(doc.save());
    expect(loaded.extractText()).toContain("SECRET");
    loaded.getPage(0).redact([0, 40, 150, 65]);
    const saved = PdfDocument.load(loaded.save());
    expect(saved.extractText()).toBe("VISIBLE");
    expect(decodedStreams(saved).join("\n")).not.toContain("SECRET");
  });
});
