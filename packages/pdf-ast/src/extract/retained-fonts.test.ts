import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosStream, dictSet, dictDelete, dictGet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";

async function fixture(count = 3, amend?: (document: PdfDocument) => void) {
  const original = PdfDocument.create(); const page = original.addPage();
  const fonts = Array.from({ length: count }, (_, i) => original.cos.allocateObject(cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName(`Font${i}`) })));
  const resources = cosDict({ Font: cosDict({ F: fonts[0]! }) });
  const form = original.cos.allocateObject(cosStream(resources, new Uint8Array()));
  const stored = original.cos.resolve(form)!; if (stored.kind !== "stream") throw new Error("fixture form missing");
  dictSet(stored.dict, "Subtype", cosName("Form"));
  dictSet(stored.dict, "Resources", cosDict({ Font: cosDict({ F: fonts[1]! }), XObject: cosDict({ Cycle: form }) }));
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F: fonts[0]! }), XObject: cosDict({ Form: form }) }));
  dictSet(page.pageDict, "Annots", cosArray([cosDict({ AP: cosDict({ N: original.cos.allocateObject(cosStream(cosDict({ Resources: cosDict({ Font: cosDict({ F: fonts[2]! }) }) }), new Uint8Array())) }) })]));
  dictSet(original.cos.resolveDict(original.cos.rootRef)!, "AcroForm", cosDict({ DR: cosDict({ Font: cosDict(Object.fromEntries(fonts.map((font, i) => [`F${i}`, font]))) }) }));
  amend?.(original);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input", { chunkBytes: 64, cacheBytes: 128 });
  const document = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { chunkBytes: 64, cacheBytes: 128 });
  return { document, fs, source, async close() { await document.close(); expect(await fs.readdir("/scratch")).toEqual([]); await source.close(); } };
}

it("visits page, recursive form, annotation and AcroForm fonts without decoding payloads", async () => {
  const f = await fixture(); const decode = vi.spyOn(f.document.objects, "decodeStream"); const names = [];
  for await (const font of f.document.fonts()) { names.push(font.name); expect(font.embedded).toBe(false); expect(font.type).toBe("Type 1"); }
  expect(names).toEqual(["Font0", "Font1", "Font2"]); expect(decode).not.toHaveBeenCalled(); await f.close();
});

it("releases suspended font traversal indexes on document close", async () => {
  const f = await fixture(80); const iterator = f.document.fonts();
  for (let i = 0; i < 60; i++) expect((await iterator.next()).done).toBe(false);
  await f.close(); expect((await iterator.next()).done).toBe(true);
});

it("inspects Type 3, CID, pattern and graphics-state fonts without loading font programs", async () => {
  const f = await fixture(3, doc => {
    const program = doc.cos.allocateObject(cosStream(cosDict({ Filter: cosName("Unsupported") }), new Uint8Array([1, 2, 3])));
    const cid = doc.cos.allocateObject(cosDict({ Type: cosName("Font"), Subtype: cosName("Type0"), BaseFont: cosName("ABCDEF+CID"), Encoding: cosName("Identity-H"),
      DescendantFonts: cosArray([cosDict({ Subtype: cosName("CIDFontType2"), FontDescriptor: cosDict({ FontFile2: program }) })]), ToUnicode: program }));
    const simple = doc.cos.allocateObject(cosDict({ Subtype: cosName("TrueType"), BaseFont: cosName("Simple"), Encoding: cosDict() }));
    const type3 = doc.cos.allocateObject(cosDict({ Subtype: cosName("Type3"), BaseFont: cosName("Glyphs"), Resources: cosDict({ Font: cosDict({ CID: cid }) }) }));
    const pattern = doc.cos.allocateObject(cosStream(cosDict({ Resources: cosDict({ Font: cosDict({ Simple: simple }) }) }), new Uint8Array()));
    dictSet(doc.getPage(0).pageDict, "Resources", cosDict({ Font: cosDict({ Type3: type3 }), ExtGState: cosDict({ State: cosDict({ Font: cosArray([cid]) }) }), Pattern: cosDict({ P: pattern }) }));
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict());
    dictSet(doc.getPage(0).pageDict, "Annots", cosArray([]));
  });
  const rows = []; for await (const font of f.document.fonts()) rows.push([font.name, font.type, font.encoding, font.embedded, font.unicode]);
  expect(rows).toEqual([["Glyphs", "Type 3", "Builtin", true, false], ["ABCDEF+CID", "CID TrueType", "Identity-H", true, true], ["Simple", "TrueType", "Custom", false, false]]);
  await f.close();
});

it("selects pages while inheriting resource dictionaries", async () => {
  const f = await fixture(3, doc => {
    const second = doc.addPage(); const font = doc.cos.allocateObject(cosDict({ Subtype: cosName("Type1"), BaseFont: cosName("Second") }));
    dictDelete(second.pageDict, "Resources");
    dictSet(doc.cos.resolveDict(dictGet(second.pageDict, "Parent"))!, "Resources", cosDict({ Font: cosDict({ F: font }) }));
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict());
  });
  const names = []; for await (const font of f.document.fonts({ firstPage: 2, lastPage: 2 })) names.push(font.name);
  expect(names).toEqual(["Second"]);
  await expect(f.document.fonts({ firstPage: 0 }).next()).rejects.toThrow("range"); await f.close();
});

it("does not mistake stream dictionaries for font dictionaries", async () => {
  const f = await fixture(3, doc => {
    const invalid = doc.cos.allocateObject(cosStream(cosDict({ BaseFont: cosName("Invalid") }), new Uint8Array()));
    dictSet(doc.getPage(0).pageDict, "Resources", cosDict({ Font: cosDict({ Invalid: invalid }) }));
  });
  const names = []; for await (const font of f.document.fonts()) names.push(font.name);
  expect(names).not.toContain("Invalid"); await f.close();
});
