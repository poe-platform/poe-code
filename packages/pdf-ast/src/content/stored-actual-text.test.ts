import { PdfTextGlyphNormalizer } from "../extract/text-glyphs.js";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosDict, cosName, cosString, dictSet } from "../ast.js";
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
    let streamed = ""; const decoder = new TextDecoder();
    for await (const part of retained.streamRawText(storage)) streamed += decoder.decode(part, { stream: true });
    streamed += decoder.decode(); expect(streamed).toBe(replacement + "Z");
    const indexedPage = await retained.indexRawText(storage);
    try {
      let text = "";
      for await (const block of indexedPage.blocks()) for await (const line of block.lines()) for await (const word of line.words()) for await (const part of word.text()) text += part;
      expect(text).toBe(replacement + "Z");
    } finally { await indexedPage.close(); }
  } finally { await document.close(); await source.close(); await backing.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});


it.each(["plain", "compressed", "encrypted", "encrypted-compressed"])("streams named indirect ActualText from %s source backing", async mode => {
  const original = PdfDocument.create(), page = original.addPage();
  const replacement = "named replacement ".repeat(1024), value = original.cos.allocateObject(cosString(replacement));
  const property = original.cos.allocateObject(cosDict({ ActualText: original.cos.allocateObject(value) }));
  const properties = original.cos.allocateObject(cosDict({ Replacement: property }));
  dictSet(page.pageDict, "Resources", cosDict({ Properties: properties, Font: cosDict({ F: cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") }) }) }));
  page.setRawContentStream("/Span /Replacement BDC BT /F 12 Tf (AB) Tj ET EMC");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  await fs.writeFile("/input", original.save({ ...(mode.includes("encrypted") ? { encrypt: { revision: 3, userPassword: "secret" } } : {}), ...(mode.includes("compressed") ? { objectStreams: "generate" as const } : {}) }));
  const signal = new AbortController().signal, storage = { fs, directory: "/scratch" }, backing = new PagedStorage({ fs, cwd: "/scratch", env: {}, signal }, 4);
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage, { password: "secret", valueArrays: { stringStorage: backing, storedStringKeys: ["ActualText"] } });
  try {
    const retained = (await document.pages().next()).value!;
    let seen = 0;
    for await (const event of retained.evaluateSteps(storage, { pathStorage: backing, retainActualText: true })) if (event.operation.kind === "glyph") {
      seen++; expect(event.operation.value.actualText).toBeUndefined(); expect(event.operation.value.storedActualText?.storage).toBe(backing);
    }
    expect(seen).toBe(2);
    let text = "";
    const decoder = new TextDecoder();
    for await (const part of retained.streamRawText(storage, { pathStorage: backing })) text += decoder.decode(part, { stream: true });
    expect(text + decoder.decode()).toBe(replacement);
  } finally { await document.close(); await source.close(); await backing.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
