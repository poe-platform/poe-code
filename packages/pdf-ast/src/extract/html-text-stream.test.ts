import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosString, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfRawTextIndex } from "./raw-text-index.js";
import { streamHtmlPageText } from "./html-text-stream.js";

it.each([false, true])("streams styled page markup in XML=%s without collecting line text", async xml => {
  const original = PdfDocument.create(); original.addPage([200, 200]).drawText("Hello & bye", { x: 10, y: 100, size: 12 });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input.pdf", original.save());
  const storage = { fs, directory: "/scratch" }, source = await PdfFileSource.open(fs, "/input.pdf");
  const document = await PdfRetainedDocument.open(source, storage);
  try {
    for await (const page of document.pages()) {
      const index = await page.indexText(storage, { mode: "layout", retainFontNames: true });
      try {
        let result = "";
        for await (const part of streamHtmlPageText(document, page, index, storage, { xml, zoom: 1, height: 200 })) {
          expect(part.length).toBeLessThanOrEqual(16384); result += part; await Promise.resolve();
        }
        expect(result).toContain("Hello &amp; bye");
        if (xml) {
          expect(result).toContain('<fontspec id="0" size="12" family="Helvetica" color="#000000"/>');
          expect(result).toContain('font="0">Hello &amp; bye</text>');
        } else expect(result).toContain('margin:0;">Hello &amp; bye</p>');
      } finally { await index.close(); }
    }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([false, true])("preserves font styles, zoom, first overlapping link and image order (XML=%s)", async xml => {
  const original = PdfDocument.create(), p = original.addPage([200, 200]);
  p.drawText("Styled", { x: 10, y: 100, size: 12, font: "Helvetica-BoldOblique" });
  const annotation = (uri: string) => cosDict({ Type: cosName("Annot"), Subtype: cosName("Link"), Rect: cosArray([0, 90, 180, 120].map(value => cosNumber(value))), A: cosDict({ S: cosName("URI"), URI: cosString(uri) }) });
  dictSet(p.dict, "Annots", cosArray([annotation("https://example.test/?a=1&b=2"), annotation("ignored")]));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input.pdf", original.save());
  const storage = { fs, directory: "/scratch" }, source = await PdfFileSource.open(fs, "/input.pdf"), document = await PdfRetainedDocument.open(source, storage);
  try {
    for await (const page of document.pages()) {
      const index = await page.indexText(storage, { mode: "layout", retainFontNames: true });
      try {
        let result = "";
        for await (const part of streamHtmlPageText(document, page, index, storage, { xml, zoom: 2, height: 200, images: async function* () { yield "IMAGE\n"; } })) result += part;
        expect(result).toContain('<a href="https://example.test/?a=1&amp;b=2"><b><i>Styled</i></b></a>');
        expect(result).not.toContain("ignored");
        if (xml) {
          expect(result).toContain('id="1" size="24" family="Helvetica-BoldOblique"');
          expect(result.indexOf("IMAGE")).toBeGreaterThan(result.indexOf("<fontspec"));
          expect(result.indexOf("IMAGE")).toBeLessThan(result.indexOf("<text"));
        } else expect(result.startsWith("IMAGE\n")).toBe(true);
      } finally { await index.close(); }
    }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([false, true])("bounds long font and line chunks and closes its font index after interrupted output (XML=%s)", async xml => {
  const original = PdfDocument.create(); original.addPage([200, 200]);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input.pdf", original.save());
  const storage = { fs, directory: "/scratch" }, source = await PdfFileSource.open(fs, "/input.pdf"), document = await PdfRetainedDocument.open(source, storage);
  try {
    for await (const page of document.pages()) {
      const index = await PdfRawTextIndex.create([{ unicode: "&".repeat(65536), fontName: "BoldItalic".repeat(xml ? 8 : 8192), fontSize: 12, charCode: 65,
        bbox: [0, 0, 100, 12], baselineY: 0, advanceWidth: 100, matrix: [1, 0, 0, 1, 0, 0], color: { r: 0, g: 0, b: 0 } }], storage, { retainFontNames: true });
      try {
        const before = (await fs.readdir("/scratch")).sort();
        let count = 0, escaped = 0;
        for await (const part of streamHtmlPageText(document, page, index, storage, { xml, height: 200 })) {
          expect(part.length).toBeLessThanOrEqual(16384); count += part.length;
          if (part.startsWith("&amp;")) escaped += part.length / 5;
          await Promise.resolve();
        }
        expect(count).toBeGreaterThan(300000); expect(escaped).toBe(65536);
        expect((await fs.readdir("/scratch")).sort()).toEqual(before);
        const output = streamHtmlPageText(document, page, index, storage, { xml, height: 200 });
        await output.next(); await output.return();
        expect((await fs.readdir("/scratch")).sort()).toEqual(before);
        const failure = new Error("image failed");
        const failing = streamHtmlPageText(document, page, index, storage, { xml, height: 200, images: async function* () { yield "image started"; throw failure; } });
        await expect((async () => { for await (const ignored of failing) void ignored; })()).rejects.toBe(failure);
        expect((await fs.readdir("/scratch")).sort()).toEqual(before);
      } finally { await index.close(); }
    }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
