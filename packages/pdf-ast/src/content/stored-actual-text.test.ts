import { PdfTextGlyphNormalizer } from "../extract/text-glyphs.js";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosDict, cosName, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { PdfRawTextIndex } from "../extract/raw-text-index.js";

it("keeps inline ActualText in caller backing through nested evaluation and indexing", async () => {
  const original = PdfDocument.create(), page = original.addPage();
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F: cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") }) }) }));
  const replacement = "replacement ".repeat(8192);
  page.setRawContentStream(`/Span << /ActualText (${replacement}) /MCID 1 >> BDC q BT /F 12 Tf (AB) Tj ET Q EMC BT /F 12 Tf (Z) Tj ET`);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const signal = new AbortController().signal, storage = { fs, directory: "/scratch" }, backing = new PagedStorage({ fs, cwd: "/scratch", env: {}, signal }, 4);
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage);
  try {
    const retained = (await document.pages().next()).value!;
    let seen = 0;
    async function* glyphs() {
      for await (const event of retained.evaluateSteps(storage, { pathStorage: backing, retainActualText: true })) if (event.operation.kind === "glyph") {
        const glyph = event.operation.value;
        if (seen++ < 2) { expect(typeof glyph.actualText).toBe("undefined"); expect(glyph.storedActualText?.byteLength).toBe(replacement.length); expect(() => [...new PdfTextGlyphNormalizer().push(glyph)]).toThrow("requires PdfRawTextIndex"); }
        else expect(glyph.storedActualText).toBeUndefined();
        yield glyph;
      }
    }
    const index = await PdfRawTextIndex.create(glyphs(), storage);
    try {
      let text = "";
      for await (const block of index.blocks()) for await (const line of block.lines()) for await (const word of line.words()) for await (const part of word.text()) text += part;
      expect(seen).toBe(3); expect(text).toBe(replacement + "Z");
    } finally { await index.close(); }
    const indexedPage = await retained.indexRawText(storage);
    try {
      let text = "";
      for await (const block of indexedPage.blocks()) for await (const line of block.lines()) for await (const word of line.words()) for await (const part of word.text()) text += part;
      expect(text).toBe(replacement + "Z");
    } finally { await indexedPage.close(); }
  } finally { await document.close(); await source.close(); await backing.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
