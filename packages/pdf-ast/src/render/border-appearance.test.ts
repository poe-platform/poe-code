import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosString, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
// Relief bands follow PDFium 156.0.8076.0 via pypdfium2 5.14.0 interactive forms.
// MuPDF 1.23.10 flattens B/I; retain our existing radio contours and text sizing.
const bytes = readFileSync(
  new URL("../../../safe-bash-rust/tests/fixtures/pdf-borders.pdf", import.meta.url)
);
it.each(Array.from({ length: 15 }, (_, i) => i))(
  "preserves PDF border appearance on page %i",
  (i) => {
    const before = Buffer.from(bytes),
      bitmap = PdfDocument.load(bytes).getPage(i).renderToBitmap({ scale: 2 });
    const pixel = (x: number, y: number) =>
      Array.from(bitmap.data.subarray((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 3));
    expect(Buffer.from(bytes).equals(before)).toBe(true);
    const style = i % 3,
      upper = style === 0 ? [204, 217, 230] : style === 1 ? [255, 255, 255] : [128, 128, 128];
    const lower = style === 0 ? [204, 217, 230] : style === 1 ? [102, 108, 115] : [191, 191, 191];
    if (i >= 12) {
      if (style === 0) {
        expect(pixel(200, 60)).toEqual([204, 217, 230]);
        return;
      }
      const matches = (y: number, expected: number[]) =>
        pixel(200, y).every((v, c) => Math.abs(v - expected[c]!) <= 2);
      expect(Array.from({ length: 11 }, (_, j) => 45 + j).some((y) => matches(y, upper))).toBe(
        true
      );
      expect(
        Array.from({ length: 11 }, (_, j) => 145 + j).some((y) =>
          matches(y, style === 1 ? [140, 153, 166] : lower)
        )
      ).toBe(true);
      return;
    }
    for (const [actual, expected] of [
      [pixel(100, 48), upper],
      [pixel(100, 152), lower]
    ])
      for (let c = 0; c < 3; c++)
        expect(Math.abs(actual![c]! - expected![c]!)).toBeLessThanOrEqual(2);
  }
);

const extended = readFileSync(
  new URL("../../../safe-bash-rust/tests/fixtures/pdf-borders-extended.pdf", import.meta.url)
);
it.each([0, 15])(
  "preserves relief defaults, rotation, clipping and appearance precedence (%i)",
  (offset) => {
    const before = Buffer.from(extended),
      doc = PdfDocument.load(extended);
    const pages = Array.from({ length: 15 }, (_, i) =>
      doc.getPage(offset + i).renderToBitmap({ scale: 2 })
    );
    const pixel = (i: number, x: number, y: number) =>
      Array.from(pages[i]!.data.slice((y * 400 + x) * 4, (y * 400 + x) * 4 + 3));
    const near = (i: number, x: number, y: number, expected: number[]) =>
      pixel(i, x, y).forEach((v, c) => expect(Math.abs(v - expected[c]!)).toBeLessThanOrEqual(2));
    const upper = offset === 0 ? [255, 255, 255] : [128, 128, 128],
      lower = offset === 0 ? [102, 108, 115] : [191, 191, 191];
    for (const i of [0, 2]) {
      near(i, 100, 48, upper);
      near(i, 100, 152, lower);
    }
    near(1, 100, 152, offset === 0 ? [128, 128, 128] : lower);
    near(3, 100, 152, offset === 0 ? [77, 77, 77] : lower);
    near(4, 100, 152, offset === 0 ? [227, 232, 236] : lower);
    const shade = offset === 0 ? [191, 191, 191] : lower;
    expect(
      Array.from({ length: 11 }, (_, j) => 145 + j).some((y) =>
        pixel(14, 200, y).every((v, c) => Math.abs(v - shade[c]!) <= 2)
      )
    ).toBe(true);
    for (const i of [8, 9]) {
      near(i, 100, 48, lower);
      near(i, 100, 152, upper);
    }
    near(10, 100, 48, upper);
    near(10, 100, 152, lower);
    near(5, 100, 42, [204, 217, 230]);
    near(6, 100, 42, [204, 217, 230]);
    near(6, 100, 41, upper);
    near(6, 100, 158, lower);
    for (const i of [7, 11, 13]) {
      if (i === 7) {
        near(i, 39, 158, [255, 255, 255]);
        near(i, 45, 158, [255, 255, 255]);
      } else expect(pages[i]!.data.every((v) => v === 255)).toBe(true);
    }
    near(12, 100, 100, [0, 255, 0]);
    expect(
      doc
        .getPage(offset)
        .evaluateDisplayList()
        .glyphs.map((g) => g.unicode)
        .join("")
    ).toBe("Border sample");
    expect(doc.getPage(offset).evaluateDisplayList().glyphs[0]!.bbox[0]).toBeGreaterThanOrEqual(27);
    expect(
      doc
        .getPage(offset)
        .renderToBitmap({ hideAnnotations: true })
        .data.every((v) => v === 255)
    ).toBe(true);
    expect(extended).toEqual(before);
  }
);

// PDFium 156 interactive forms (pypdfium2 5.14): missing BG shades white;
// missing BC omits only the outline. CMYK components are divided before the
// renderer's existing color conversion (which differs slightly from PDFium).
it.each(["B", "I"])("rejects invalid %s border geometry before producing a bitmap", (style) => {
  for (const width of [cosString("bad"), cosNumber(1000001), cosNumber(-1000001)]) {
    const doc = PdfDocument.create(),
      page = doc.addPage();
    dictSet(
      page.pageDict,
      "Annots",
      cosArray([
        cosDict({
          Subtype: cosName("Widget"),
          FT: cosName("Tx"),
          Rect: cosArray([0, 0, 100, 100].map((v) => cosNumber(v))),
          MK: cosDict({ BC: cosArray([cosNumber(0)]) }),
          BS: cosDict({ S: cosName(style), W: width })
        })
      ])
    );
    expect(() => page.renderToPng()).toThrow(/Invalid PDF widget/);
    expect(page.renderToBitmap({ hideAnnotations: true }).data.every((v) => v === 255)).toBe(true);
  }
});

it("retained relief rendering matches buffered pages and preserves source bytes", async () => {
  const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
  const { PagedStorage } = await import("@poe-code/safe-fs/storage");
  const { PdfFileSource } = await import("../source.js");
  const { PdfRetainedDocument } = await import("../retained-document.js");
  const { renderRetainedPagePixels } = await import("./retained-page-pixels.js");
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/input.pdf", bytes);
  const storage = { fs, directory: "/scratch" },
    source = await PdfFileSource.open(fs, "/input.pdf");
  const backing = new PagedStorage(
    { fs, cwd: "/scratch", env: {}, signal: new AbortController().signal },
    1
  );
  const doc = await PdfRetainedDocument.open(source, storage, {
    valueArrays: {
      dictionaryStorage: backing,
      storedDictionaryKeys: ["AcroForm", "DR", "Font", "MK", "BS"],
      arrayStorage: backing,
      storedArrayKeys: ["Annots", "Rect", "BG", "BC"]
    }
  });
  try {
    const buffered = PdfDocument.load(bytes);
    let i = 0;
    for await (const page of doc.pages()) {
      const expected = buffered.getPage(i++).renderToBitmap({ scale: 1 });
      const rendered = await renderRetainedPagePixels(page, storage, {
        scale: 1,
        tileSize: 128,
        imageStorage: backing
      });
      const chunks = [];
      for await (const chunk of rendered.pixels) chunks.push(chunk);
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected.data));
    }
    expect(i).toBe(15);
    expect(Buffer.from(await fs.readFile("/input.pdf"))).toEqual(bytes);
  } finally {
    await doc.close();
    await source.close();
    await backing.close();
  }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["S", "D", "U"])("preserves the %s border control", (style) => {
  const doc = PdfDocument.create(),
    page = doc.addPage([100, 100]);
  dictSet(
    page.pageDict,
    "Annots",
    cosArray([
      cosDict({
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        Rect: cosArray([0, 0, 100, 100].map((v) => cosNumber(v))),
        MK: cosDict({
          BG: cosArray([0.8, 0.85, 0.9].map((v) => cosNumber(v))),
          BC: cosArray([cosNumber(0)])
        }),
        BS: cosDict({
          S: cosName(style),
          W: cosNumber(3),
          D: cosArray([cosNumber(4), cosNumber(4)])
        })
      })
    ])
  );
  const bitmap = page.renderToBitmap({ scale: 1 });
  const dark = Array.from({ length: 80 }, (_, i) => i + 10).filter(
    (x) => bitmap.data[(100 + x) * 4]! < 100
  ).length;
  if (style === "S") expect(dark).toBe(80);
  else if (style === "D") {
    expect(dark).toBeGreaterThan(20);
    expect(dark).toBeLessThan(60);
  } else {
    expect(dark).toBe(0);
    expect(bitmap.data[(98 * 100 + 50) * 4]).toBe(0);
  }
});
