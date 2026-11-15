import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { PdfDocument } from "../document.js";
const source = readFileSync(
  new URL("../../../safe-bash-rust/tests/fixtures/pdf-button-icons.pdf", import.meta.url)
);
it.each(Array.from({ length: 25 }, (_, i) => i + 1))(
  "preserves button icon or appearance control on page %i",
  (page) => {
    const before = Buffer.from(source),
      bitmap = PdfDocument.load(source)
        .getPage(page - 1)
        .renderToBitmap({ scale: 2 });
    let red = 0,
      blue = 0,
      magenta = 0;
    const data = bitmap.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0) red++;
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 255) blue++;
      if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255) magenta++;
    }
    expect(Buffer.from(source).equals(before)).toBe(true);
    if (page === 1) {
      expect(red + blue).toBe(0);
      return;
    }
    if (page === 21) {
      expect(magenta).toBeGreaterThan(1000);
      expect(red + blue).toBe(0);
      return;
    }
    if ([22, 23, 24].includes(page)) {
      expect(data.every((v) => v === 255)).toBe(true);
      return;
    }
    expect(red).toBeGreaterThan(1000);
    if (page !== 16) expect(blue).toBeGreaterThan(1000);
  }
);

import {
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  cosString,
  dictSet,
  type PdfCosNode
} from "../ast.js";
const nums = (...values: number[]) => cosArray(values.map((v) => cosNumber(v)));
function button(
  extra: Record<string, PdfCosNode> = {},
  geometry: Record<string, PdfCosNode> = {},
  content = "1 0 0 rg 0 0 40 20 re f 0 0 1 rg 20 0 20 20 re f"
) {
  const doc = PdfDocument.create(),
    page = doc.addPage({ width: 200, height: 100 });
  const icon = cosStream(
    cosDict({
      Subtype: cosName("Form"),
      BBox: nums(0, 0, 40, 20),
      Resources: cosDict(),
      ...geometry
    }),
    new TextEncoder().encode(content)
  );
  const ref = doc.cos.allocateObject(icon);
  const mk = cosDict({
    I: ref,
    TP: cosNumber(1),
    CA: cosString("Caption"),
    IF: cosDict({ SW: cosName("N") }),
    ...extra
  });
  const annot = cosDict({
    Subtype: cosName("Widget"),
    FT: cosName("Btn"),
    Ff: cosNumber(65536),
    Rect: nums(20, 20, 180, 80),
    MK: mk
  });
  dictSet(page.pageDict, "Annots", cosArray([annot]));
  return { doc, page, icon, ref, annot, mk };
}
const rgbCount = (data: Uint8Array | Uint8ClampedArray, r: number, g: number, b: number) => {
  let n = 0;
  for (let i = 0; i < data.length; i += 4)
    if (data[i] === r && data[i + 1] === g && data[i + 2] === b) n++;
  return n;
};
it("honors layout, clipping, fit, alignment, transformed Forms and normal-state selection", () => {
  const doc = PdfDocument.load(source);
  const bitmap = (page: number) => doc.getPage(page - 1).renderToBitmap({ scale: 2 }).data;
  const at = (page: number, x: number, y: number) => [
    ...bitmap(page).slice((y * 400 + x) * 4, (y * 400 + x) * 4 + 3)
  ];
  for (const page of [2, 14, 15, 18, 20, 25]) {
    expect(rgbCount(bitmap(page), 255, 0, 0)).toBe(12544);
    expect(rgbCount(bitmap(page), 0, 0, 255)).toBe(12544);
  }
  for (const page of [3, 4]) expect(rgbCount(bitmap(page), 255, 0, 0)).toBe(7056);
  for (const page of [9, 11, 12, 17]) expect(rgbCount(bitmap(page), 255, 0, 0)).toBe(1600);
  expect(rgbCount(bitmap(13), 255, 0, 0)).toBe(19200);
  expect(at(11, 44, 154)).toEqual([255, 0, 0]);
  expect(at(12, 354, 44)).toEqual([0, 0, 255]);
  expect(at(19, 180, 140)).toEqual([255, 0, 0]);
  expect(at(19, 180, 60)).toEqual([0, 0, 255]);
  for (let tp = 0; tp <= 6; tp++) {
    const glyphs = doc.getPage(tp).evaluateDisplayList().glyphs;
    expect(glyphs.map((g) => g.unicode).join("")).toBe(tp === 1 ? "" : "Caption");
    if (tp === 2) expect(glyphs[0]!.baselineY).toBeLessThan(40);
    if (tp === 3) expect(glyphs[0]!.baselineY).toBeGreaterThan(60);
  }
});
it("centers an omitted alignment, handles tiny and zero geometry, and uses nested resources", () => {
  const { page, icon, ref, annot, doc } = button();
  const data = page.renderToBitmap({ scale: 2 }).data;
  expect([...data.slice((80 * 400 + 160) * 4, (80 * 400 + 160) * 4 + 3)]).toEqual([255, 0, 0]);
  expect(rgbCount(data, 255, 0, 0)).toBe(1600);
  const child = doc.cos.allocateObject(
    cosStream(
      cosDict({ Subtype: cosName("Form"), BBox: nums(0, 0, 40, 20) }),
      new TextEncoder().encode("1 0 0 rg 0 0 40 20 re f")
    )
  );
  dictSet(icon.dict, "Resources", cosDict({ XObject: cosDict({ Child: child }) }));
  doc.cos.setObject(ref.objectNumber, cosStream(icon.dict, new TextEncoder().encode("/Child Do")));
  expect(rgbCount(page.renderToBitmap({ scale: 2 }).data, 255, 0, 0)).toBe(3200);
  expect(ref.kind).toBe("ref");
  for (const rect of [nums(20, 20, 20, 80), nums(20, 20, 20.001, 20.001)]) {
    dictSet(annot, "Rect", rect);
    expect(() => page.renderToBitmap()).not.toThrow();
  }
  const zero = button({}, { BBox: nums(0, 0, 0, 20) });
  expect(zero.page.renderToBitmap().data.every((v) => v === 255)).toBe(true);
});
it("renders ordinary shifted, rotated and raster Form controls", () => {
  const doc = PdfDocument.load(
    readFileSync(
      new URL("../../../safe-bash-rust/tests/fixtures/pdf-icon-forms.pdf", import.meta.url)
    )
  );
  for (let i = 0; i < 3; i++) {
    const data = doc.getPage(i).renderToBitmap({ scale: 2 }).data;
    expect(rgbCount(data, 255, 0, 0)).toBe(6400);
    expect(rgbCount(data, 0, 0, 255)).toBe(6400);
  }
});
it.each([
  { TP: cosNumber(7) },
  { TP: cosNumber(1.5) },
  { TP: cosString("1") },
  { I: cosNumber(1) },
  { IF: cosString("bad") },
  { IF: cosDict({ SW: cosName("bad") }) },
  { IF: cosDict({ S: cosNumber(1) }) },
  { IF: cosDict({ FB: cosNumber(1) }) },
  { IF: cosDict({ A: nums(0) }) },
  { IF: cosDict({ A: nums(-1, 0) }) },
  { IF: cosDict({ A: cosString("bad") }) }
])("rejects invalid icon layout and fit scalars %#", (extra) => {
  expect(() => button(extra).page.renderToBitmap()).toThrow();
});
it.each([
  { BBox: nums(0, 0, 40) },
  { BBox: cosString("bad") },
  { Matrix: nums(1, 0, 0, 1, 0) },
  { Matrix: cosString("bad") },
  { Subtype: cosName("Image") },
  { Resources: cosString("bad") }
])("rejects invalid icon Forms %#", (geometry) => {
  expect(() => button({}, geometry).page.renderToBitmap()).toThrow();
});
it("rejects recursive icon Forms through the bounded renderer", () => {
  const { page, icon, ref } = button({}, {}, "/Self Do");
  dictSet(icon.dict, "Resources", cosDict({ XObject: cosDict({ Self: ref }) }));
  expect(() => page.renderToBitmap()).toThrow(/limit/i);
});

it.each([false, true])(
  "retained icon controls preserve resources and source bytes (backed=%s)",
  async (backed) => {
    const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
    const { PagedStorage } = await import("@poe-code/safe-fs/storage");
    const { PdfFileSource } = await import("../source.js");
    const { PdfRetainedDocument } = await import("../retained-document.js");
    const { renderRetainedPagePixels } = await import("./retained-page-pixels.js");
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    await fs.writeFile("/input.pdf", source);
    const storage = { fs, directory: "/scratch" },
      fileSource = await PdfFileSource.open(fs, "/input.pdf");
    const backing = new PagedStorage(
      { fs, cwd: "/scratch", env: {}, signal: new AbortController().signal },
      1
    );
    const doc = await PdfRetainedDocument.open(
      fileSource,
      storage,
      backed
        ? {
            valueArrays: {
              dictionaryStorage: backing,
              storedDictionaryKeys: [
                "AcroForm",
                "DR",
                "Font",
                "MK",
                "IF",
                "XObject",
                "Resources",
                "BS",
                "Parent"
              ],
              arrayStorage: backing,
              storedArrayKeys: ["Annots", "Rect", "BG", "BC", "BBox", "Matrix", "A"]
            }
          }
        : {}
    );
    try {
      const buffered = PdfDocument.load(source);
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
      expect(i).toBe(25);
      expect(Buffer.from(await fs.readFile("/input.pdf"))).toEqual(source);
    } finally {
      await doc.close();
      await fileSource.close();
      await backing.close();
    }
    expect(await fs.readdir("/scratch")).toEqual([]);
  }
);

it("charges icon decoding against the document byte limit", () => {
  const doc = PdfDocument.load(source, { maxDecompressedBytes: 16 });
  expect(() => doc.getPage(1).renderToBitmap()).toThrow(/budget/i);
});
it("rejects oversized raster resources inside an icon", () => {
  const { page, doc, icon } = button({}, {}, "/Image Do");
  const image = doc.cos.allocateObject(
    cosStream(
      cosDict({
        Subtype: cosName("Image"),
        Width: cosNumber(1e9),
        Height: cosNumber(1e9),
        BitsPerComponent: cosNumber(8),
        ColorSpace: cosName("DeviceRGB")
      }),
      new Uint8Array()
    )
  );
  dictSet(icon.dict, "Resources", cosDict({ XObject: cosDict({ Image: image }) }));
  expect(() => page.renderToBitmap()).toThrow();
});
