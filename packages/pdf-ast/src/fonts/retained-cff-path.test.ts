import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { readStoredPath } from "../content/stored-path.js";
import type { PdfPixelStorage } from "../ast.js";
import { Type2Compiled } from "../vendor/pdfjs-fonts.mjs";

it.each(["pdfjs-cff_bluescale_small_zones.pdf", "pdfjs-text_clip_cff_cid.pdf"])(
  "streams retained outlines with native geometry for %s",
  async (name) => {
    const bytes = readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
    const expected = PdfDocument.load(bytes).getPage(0).evaluateDisplayList().glyphs;
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    await fs.writeFile("/input", bytes);
    const index = { fs, directory: "/scratch" },
      source = await PdfFileSource.open(fs, "/input");
    const doc = await PdfRetainedDocument.open(source, index);
    const data = new Uint8Array(8 * 1024 * 1024);
    let end = 0;
    const storage: PdfPixelStorage = {
      allocate(size) {
        const position = end;
        end += size;
        if (end > data.length) throw Error("fixture backing exhausted");
        return position;
      },
      async read(position, length) {
        return data.slice(position, position + length);
      },
      async write(position, bytes) {
        data.set(bytes, position);
      }
    };
    const whole = vi.spyOn(Type2Compiled.prototype, "compileGlyph").mockImplementation(() => {
      throw Error("whole glyph compilation");
    });
    let glyph = 0;
    try {
      const page = (await doc.pages().next()).value!;
      for await (const event of page.evaluateSteps(index, {
        imageStorage: storage,
        chunkBytes: 4096
      })) {
        if (event.operation.kind !== "glyph") continue;
        const actual = event.operation.value,
          reference = expected[glyph++]!;
        expect(actual.unicode).toBe(reference.unicode);
        expect(actual.bbox).toEqual(reference.bbox);
        if (!reference.outline) continue;
        expect(actual.outline?.segments).toEqual([]);
        const stored = actual.outline?.storedSegments;
        expect(stored).toBeDefined();
        const segments = [];
        for await (const segment of readStoredPath(stored!)) segments.push(segment);
        expect(segments).toEqual(reference.outline.segments);
      }
      expect(glyph).toBe(expected.length);
      expect(whole).not.toHaveBeenCalled();
    } finally {
      whole.mockRestore();
      await doc.close();
      await source.close();
    }
    expect(await fs.readdir("/scratch")).toEqual([]);
  }
);
