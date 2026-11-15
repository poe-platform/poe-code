import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument } from "../document.js";

const pdf = new Uint8Array(
  readFileSync(new URL("../../../safe-bash-rust/tests/fixtures/pdf-widgets.pdf", import.meta.url))
);

it("renders filled text and choice widgets without supplied appearances", () => {
  const doc = PdfDocument.load(pdf);
  for (let i = 0; i < 5; i++) {
    const page = doc.getPage(i),
      bitmap = page.renderToBitmap({ scale: 2 });
    const at = (145 * bitmap.width + 250) * 4;
    // Both PDFium and MuPDF paint the specified light blue field background.
    for (const [c, expected] of [229, 242, 255].entries())
      expect(
        Math.abs(bitmap.data[at + c]! - expected),
        `page ${i + 1} background channel ${c}`
      ).toBeLessThanOrEqual(2);
    expect(page.evaluateDisplayList().glyphs.length, `page ${i + 1} field value`).toBeGreaterThan(
      4
    );
  }
  expect(
    doc
      .getPage(5)
      .renderToBitmap({ scale: 2 })
      .data.every((v) => v === 255)
  ).toBe(true);
  expect(
    doc
      .getPage(0)
      .renderToBitmap({ scale: 2, hideAnnotations: true })
      .data.every((v) => v === 255)
  ).toBe(true);
});

const extended = new Uint8Array(
  readFileSync(
    new URL("../../../safe-bash-rust/tests/fixtures/pdf-widgets-extended.pdf", import.meta.url)
  )
);
it("uses choice display labels, visible list options and selected rows", () => {
  const doc = PdfDocument.load(extended);
  const text = (i: number) =>
    doc
      .getPage(i)
      .evaluateDisplayList()
      .glyphs.map((g) => g.unicode)
      .join("");
  expect(text(7)).toBe("Green");
  expect(text(8)).toBe("RedGreenBlue");
  expect(text(9)).toBe("SecondThirdFourthFifth");
  const bitmap = doc.getPage(9).renderToBitmap({ scale: 2 });
  const pixel = (y: number) => [...bitmap.data.slice((y * 400 + 300) * 4, (y * 400 + 300) * 4 + 3)];
  expect(pixel(60)).toEqual([0, 51, 113]);
  expect(pixel(88)[0]).toBeGreaterThan(220);
  expect(pixel(118)).toEqual([0, 51, 113]);
});
it("masks passwords, honors inherited settings and keeps supplied appearances", () => {
  const doc = PdfDocument.load(extended);
  expect(
    Buffer.from(doc.getPage(1).renderToPng({ scale: 2 })).equals(
      Buffer.from(doc.getPage(2).renderToPng({ scale: 2 }))
    )
  ).toBe(true);
  expect(doc.getPage(3).evaluateDisplayList().glyphs).toHaveLength(0);
  expect(
    doc
      .getPage(4)
      .renderToBitmap({ scale: 2 })
      .data.every((v) => v === 255)
  ).toBe(true);
  expect(
    doc
      .getPage(5)
      .evaluateDisplayList()
      .glyphs.map((g) => g.unicode)
      .join("")
  ).toBe("Null appearance");
  const supplied = doc.getPage(6).renderToBitmap({ scale: 2 });
  expect([...supplied.data.slice((100 * 400 + 200) * 4, (100 * 400 + 200) * 4 + 3)]).toEqual([
    0, 255, 0
  ]);
  expect(doc.getPage(6).evaluateDisplayList().glyphs).toHaveLength(0);
  const inherited = doc.getPage(0).evaluateDisplayList().glyphs;
  expect(inherited.map((g) => g.unicode).join("")).toBe("Inherited value");
  expect(inherited[0]!.fontSize).toBe(14);
});
it("draws comb dividers and aligns the value within cells", () => {
  const doc = PdfDocument.load(extended);
  for (const [page, left] of [
    [10, 27],
    [18, 87],
    [19, 47]
  ]) {
    const bitmap = doc.getPage(page!).renderToBitmap({ scale: 2 });
    expect(bitmap.data[(60 * 400 + 80) * 4]).toBeLessThan(100);
    const first = doc.getPage(page!).evaluateDisplayList().glyphs[0]!;
    expect(first.bbox[0]).toBeGreaterThan(left! - 15);
    expect(first.bbox[0]).toBeLessThan(left! + 15);
  }
});

it.each([false, true])(
  "retained widgets match buffered rendering without mutating the source (backed=%s)",
  async (backed) => {
    const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
    const { PagedStorage } = await import("@poe-code/safe-fs/storage");
    const { PdfFileSource } = await import("../source.js");
    const { PdfRetainedDocument } = await import("../retained-document.js");
    const { renderRetainedPagePixels } = await import("./retained-page-pixels.js");
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    await fs.writeFile("/input.pdf", extended);
    const storage = { fs, directory: "/scratch" },
      source = await PdfFileSource.open(fs, "/input.pdf");
    const backing = new PagedStorage(
      { fs, cwd: "/scratch", env: {}, signal: new AbortController().signal },
      1
    );
    const retained = await PdfRetainedDocument.open(
      source,
      storage,
      backed
        ? {
            valueArrays: {
              dictionaryStorage: backing,
              storedDictionaryKeys: ["AcroForm", "DR", "Font", "MK", "BS", "Parent"],
              arrayStorage: backing,
              storedArrayKeys: ["Annots", "Rect", "Opt", "I", "Border", "BG", "BC"]
            }
          }
        : {}
    );
    try {
      const doc = PdfDocument.load(extended);
      let i = 0;
      for await (const page of retained.pages()) {
        const expected = doc.getPage(i).renderToBitmap({ scale: 1 });
        const rendered = await renderRetainedPagePixels(page, storage, {
          scale: 1,
          tileSize: 128,
          imageStorage: backing
        });
        const chunks = [];
        for await (const chunk of rendered.pixels) chunks.push(chunk);
        expect(Buffer.concat(chunks).equals(Buffer.from(expected.data)), `page ${i + 1}`).toBe(
          true
        );
        i++;
      }
      expect(i).toBe(20);
      expect(Buffer.from(await fs.readFile("/input.pdf")).equals(Buffer.from(extended))).toBe(true);
    } finally {
      await retained.close();
      await source.close();
      await backing.close();
    }
    expect(await fs.readdir("/scratch")).toEqual([]);
  }
);
