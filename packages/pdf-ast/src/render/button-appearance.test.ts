import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument } from "../document.js";
const input = new Uint8Array(
  readFileSync(new URL("../../../safe-bash-rust/tests/fixtures/pdf-buttons.pdf", import.meta.url))
);
it("renders checked, unchecked and captioned buttons without supplied appearances", () => {
  const before = Uint8Array.from(input),
    doc = PdfDocument.load(input);
  const pixels = Array.from({ length: 6 }, (_, i) => doc.getPage(i).renderToBitmap({ scale: 2 }));
  const at = (i: number, x: number, y: number) => [
    ...pixels[i]!.data.slice((y * 400 + x) * 4, (y * 400 + x) * 4 + 3)
  ];
  for (const i of [0, 1, 4]) {
    const pixel = at(i, i === 4 ? 350 : 110, 145);
    for (const [c, expected] of [229, 242, 255].entries())
      expect(Math.abs(pixel[c]! - expected), `page ${i + 1} background`).toBeLessThanOrEqual(2);
  }
  const dark = (i: number) => {
    let n = 0;
    for (let y = 90; y < 150; y++)
      for (let x = 50; x < 110; x++) if (at(i, x, y).every((v) => v < 100)) n++;
    return n;
  };
  expect(dark(0)).toBeGreaterThan(100);
  expect(dark(1)).toBe(0);
  expect(at(2, 80, 120).every((v) => v < 100)).toBe(true);
  expect(at(3, 80, 120)[0]).toBeGreaterThan(220);
  expect(at(2, 42, 82)).toEqual([255, 255, 255]);
  expect(
    doc
      .getPage(4)
      .evaluateDisplayList()
      .glyphs.map((g) => g.unicode)
      .join("")
  ).toBe("Continue");
  expect(pixels[5]!.data.every((v) => v === 255)).toBe(true);
  expect(
    doc
      .getPage(0)
      .renderToBitmap({ hideAnnotations: true })
      .data.every((v) => v === 255)
  ).toBe(true);
  expect(input).toEqual(before);
});

const extended = new Uint8Array(
  readFileSync(
    new URL("../../../safe-bash-rust/tests/fixtures/pdf-buttons-extended.pdf", import.meta.url)
  )
);
it("uses each widget state and preserves custom marks, supplied appearances and inherited captions", () => {
  const doc = PdfDocument.load(extended),
    pages = Array.from({ length: 30 }, (_, i) => doc.getPage(i).renderToBitmap({ scale: 2 }));
  const same = (a: number, b: number) =>
    expect(Buffer.from(pages[a]!.data).equals(Buffer.from(pages[b]!.data))).toBe(true);
  for (const i of [6, 7]) same(1, i);
  for (const i of [9, 10]) same(3, i);
  for (const i of [8, 16, 25]) same(0, i);
  for (const i of [5, 20, 21, 22])
    expect(
      pages[i]!.data.every((v) => v === 255),
      `hidden/empty page ${i + 1}`
    ).toBe(true);
  const at = (i: number, x: number, y: number) => [
    ...pages[i]!.data.slice((y * 400 + x) * 4, (y * 400 + x) * 4 + 3)
  ];
  expect(at(18, 80, 120)[0]).toBeGreaterThan(220);
  expect(at(18, 240, 120).every((v) => v < 100)).toBe(true);
  expect(at(19, 80, 120)).toEqual([0, 255, 0]);
  expect(at(28, 44, 84)[0]).toBeLessThan(240); // A noncircular radio mark has a rectangular control.
  expect(new Set(pages.slice(11, 16).map((p) => Buffer.from(p.data).toString("base64"))).size).toBe(
    5
  );
  expect(Buffer.from(pages[0]!.data).equals(Buffer.from(pages[24]!.data))).toBe(false);
  const glyphs = doc.getPage(29).evaluateDisplayList().glyphs;
  expect(glyphs.map((g) => g.unicode).join("")).toBe("Inherited");
  expect(glyphs[0]!.fontSize).toBe(14);
});
it.each([false, true])(
  "retained button controls preserve resources and source bytes (backed=%s)",
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
    const doc = await PdfRetainedDocument.open(
      source,
      storage,
      backed
        ? {
            valueArrays: {
              dictionaryStorage: backing,
              storedDictionaryKeys: ["AcroForm", "DR", "Font", "MK", "BS", "Parent"],
              arrayStorage: backing,
              storedArrayKeys: ["Annots", "Rect", "BG", "BC"]
            }
          }
        : {}
    );
    try {
      const buffered = PdfDocument.load(extended);
      let i = 0;
      for await (const page of doc.pages()) {
        const expected = buffered.getPage(i).renderToBitmap({ scale: 1 });
        const rendered = await renderRetainedPagePixels(page, storage, {
          scale: 1,
          tileSize: 128,
          imageStorage: backing
        });
        const chunks = [];
        for await (const chunk of rendered.pixels) chunks.push(chunk);
        expect(Buffer.concat(chunks).equals(Buffer.from(expected.data)), `page ${++i}`).toBe(true);
      }
      expect(i).toBe(30);
      expect(await fs.readFile("/input.pdf")).toEqual(extended);
    } finally {
      await doc.close();
      await source.close();
      await backing.close();
    }
    expect(await fs.readdir("/scratch")).toEqual([]);
  }
);
