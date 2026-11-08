import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { cosArray, cosBool, cosDict, cosName, cosNumber, cosStream, dictGet, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { renderDisplayListToSvg } from "./raster.js";

function patternText(options: { shading?: boolean; uncolored?: boolean; mode?: number; rotated?: boolean; alpha?: number } = {}) {
  const doc = PdfDocument.create(), page = doc.addPage([60, 40]);
  page.drawText("H", { x: 5, y: 5, size: 20 });
  const font = new TextDecoder().decode(page.getRawContentStream()).split("/")[1]!.split(" ")[0];
  const nums = (values: number[]) => cosArray(values.map(value => cosNumber(value)));
  const pattern = options.shading
    ? cosDict({ PatternType: cosNumber(2), Shading: cosDict({ ShadingType: cosNumber(2),
      ColorSpace: cosName("DeviceRGB"), Coords: nums([0, 0, 60, 0]), Extend: cosArray([cosBool(true), cosBool(true)]),
      Function: cosDict({ FunctionType: cosNumber(2), Domain: nums([0, 1]), C0: nums([1, 0, 0]), C1: nums([0, 0, 1]), N: cosNumber(1) }),
    }) })
    : cosStream(new TextEncoder().encode(options.uncolored ? "0 0 5 20 re f" : "1 0 0 rg 0 0 5 20 re f 0 0 1 rg 5 0 5 20 re f"), {
      dict: cosDict({ PatternType: cosNumber(1), PaintType: cosNumber(options.uncolored ? 2 : 1), TilingType: cosNumber(1),
        BBox: nums([0, 0, 10, 20]), XStep: cosNumber(10), YStep: cosNumber(20), Resources: cosDict({}) }),
    });
  const resources = doc.cos.resolveDict(dictGet(page.pageDict, "Resources"))!;
  dictSet(resources, "Pattern", cosDict({ P: doc.cos.allocateObject(pattern) }));
  dictSet(resources, "ColorSpace", cosDict({ Uncolored: cosArray([cosName("Pattern"), cosName("DeviceRGB")]) }));
  dictSet(resources, "ExtGState", cosDict({ A: cosDict({ ca: cosNumber(options.alpha ?? 1) }) }));
  page.setRawContentStream(`${options.uncolored ? "/Uncolored cs 0 1 0 /P scn" : "/Pattern cs /P scn"} /A gs 0 1 0 RG 0.4 w
    BT /${font} 20 Tf ${options.mode ?? 0} Tr ${options.rotated ? "0 1 -1 0 35 5 Tm" : "1 0 0 1 5 5 Tm"} (H) Tj ET
    1 0 1 rg 50 30 5 5 re f`);
  return page;
}

function pixel(page: ReturnType<typeof patternText>, x: number, y: number) {
  const bitmap = page.renderToBitmap({ dpi: 72 });
  const offset = ((39 - y) * 60 + x) * 4;
  return Array.from(bitmap.data.subarray(offset, offset + 3));
}

it.each([0, 2, 4, 6])("fills outlined glyphs with a tiling pattern in text mode %i", mode => {
  const page = patternText({ mode });
  expect(pixel(page, 7, 10)).toEqual([0, 0, 255]);
  const [red, green, blue] = pixel(page, 11, 12);
  expect(red).toBeGreaterThan(150);
  expect(blue).toBe(0);
  // The crossbar edge includes the green stroke in modes 2 and 6.
  if (mode === 2 || mode === 6) expect(green).toBeGreaterThan(0);
  else expect(green).toBe(0);
  expect(pixel(page, 11, 7)).toEqual([255, 255, 255]);
  if (mode < 4) expect(pixel(page, 52, 32)).toEqual([255, 0, 255]);
  else expect(pixel(page, 52, 32)).toEqual([255, 255, 255]);
});

it("keeps patterns fixed in page space when text is rotated", () => {
  const page = patternText({ rotated: true });
  expect(pixel(page, 27, 7)).toEqual([0, 0, 255]);
  expect(pixel(page, 22, 7)).toEqual([255, 0, 0]);
  expect(pixel(page, 30, 11)).toEqual([255, 255, 255]);
});

it("paints uncolored pattern tiles with the selected base color and preserves gaps", () => {
  const page = patternText({ uncolored: true });
  expect(pixel(page, 11, 12)).toEqual([0, 255, 0]);
  expect(pixel(page, 7, 10)).toEqual([255, 255, 255]);
});

it("clips shading fills to glyph contours and applies fill alpha", () => {
  const page = patternText({ shading: true, alpha: 0.5 });
  const [red, green, blue] = pixel(page, 7, 10);
  expect(red).toBeGreaterThan(220);
  expect(green).toBe(127);
  expect(blue).toBeGreaterThan(135);
  expect(blue).toBeLessThan(160);
  expect(pixel(page, 11, 7)).toEqual([255, 255, 255]);
  expect(renderDisplayListToSvg(page.evaluateDisplayList())).toContain("clipPath");
});

it.each([1, 3, 5, 7])("does not fill text mode %i with the pattern", mode => {
  expect(pixel(patternText({ mode }), 11, 12)).not.toEqual([255, 0, 0]);
});

it("preserves the upstream embedded checkerboard and gradient text through editor saves", () => {
  const doc = PdfDocument.load(readFileSync(new URL("../fixtures/pdfjs-pattern_text_embedded_font.pdf", import.meta.url)));
  const page = doc.getPage(0), list = page.evaluateDisplayList();
  const options = { scale: 400 / list.height };
  const bitmap = page.renderToBitmap(options);
  const sample = (x: number, y: number) => Array.from(bitmap.data.subarray((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 3));
  // Independent Poppler samples in the gradient row; allow raster sampling rounding.
  for (const [x, expected] of [[40, [20, 12, 235]], [90, [74, 45, 181]], [180, [173, 104, 82]]] as const) {
    sample(x, 190).forEach((value, channel) => expect(Math.abs(value - expected[channel]!)).toBeLessThanOrEqual(2));
  }
  const shades = [73, 75, 77].map(x => sample(x, 140)[0]!);
  expect(Math.max(...shades) - Math.min(...shades)).toBeGreaterThan(60);
  const copied = PdfDocument.create();
  copied.copyPagesFrom(doc, [0]);
  for (const bytes of [doc.save(), doc.save({ incremental: true }), copied.save()]) {
    expect(PdfDocument.load(bytes).getPage(0).renderToBitmap(options).data).toEqual(bitmap.data);
  }
});
