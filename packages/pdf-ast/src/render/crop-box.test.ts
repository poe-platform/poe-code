import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosBool, cosDict, cosName, cosNumber, cosStream, dictGet, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { decodePng, renderDisplayListToBitmap, renderDisplayListToSvg, renderPdfPageToBitmap } from "./raster.js";

const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));

function croppedPage(box = [20, 30, 60, 50]) {
  const doc = PdfDocument.create();
  const page = doc.addPage([80, 100]);
  dictSet(page.pageDict, "CropBox", numbers(box));
  page.setRawContentStream("1 0 0 rg 20 30 20 20 re f 0 0 1 rg 40 30 20 20 re f");
  return { doc, page };
}

describe("page CropBox rendering", () => {
  it.each([
    [0, 40, 20, [255, 0, 0, 255]],
    [90, 20, 40, [255, 0, 0, 255]],
    [180, 40, 20, [0, 0, 255, 255]],
    [270, 20, 40, [0, 0, 255, 255]],
  ] as const)("honors CropBox before rotation %s in every bitmap entrypoint", (rotation, width, height, color) => {
    const { doc, page } = croppedPage();
    page.setRotation(rotation);
    const options = { scale: 1, useCropBox: true };
    for (const bitmap of [
      page.renderToBitmap(options), decodePng(page.renderToPng(options)),
      decodePng(doc.renderPageToPng(0, options)),
      renderDisplayListToBitmap(page.evaluateDisplayList(), options),
      renderPdfPageToBitmap(doc.save(), 0, options),
    ]) {
      expect([bitmap.width, bitmap.height]).toEqual([width, height]);
      expect(Array.from(bitmap.data.slice(0, 4))).toEqual(color);
    }
    const svg = renderDisplayListToSvg(page.evaluateDisplayList(), options);
    expect(svg).toContain(`width="${width}" height="${height}"`);
    expect(svg).toContain("<path");
  });

  it("keeps the MediaBox default and preserves content/editing coordinates", () => {
    const { doc, page } = croppedPage();
    const content = page.getContentAst();
    const bitmap = page.renderToBitmap({ scale: 1 });
    expect([bitmap.width, bitmap.height]).toEqual([80, 100]);
    page.renderToBitmap({ scale: 1, useCropBox: true });
    expect(page.getContentAst()).toEqual(content);
    expect(PdfDocument.load(doc.save()).getPage(0).getCropBox()).toEqual([20, 30, 60, 50]);
  });

  it("resolves an inherited CropBox", () => {
    const doc = PdfDocument.create(), page = doc.addPage([80, 100]);
    const parent = doc.cos.resolveDict(dictGet(page.pageDict, "Parent"))!;
    dictSet(parent, "CropBox", numbers([20, 30, 60, 50]));
    const bitmap = page.renderToBitmap({ scale: 1, useCropBox: true });
    expect([bitmap.width, bitmap.height]).toEqual([40, 20]);
  });

  it("falls back to the actual MediaBox for a malformed CropBox", () => {
    const doc = PdfDocument.create(), page = doc.addPage([1000, 1000]);
    dictSet(page.pageDict, "CropBox", cosArray([cosName("Invalid")]));
    const bitmap = page.renderToBitmap({ scale: 0.1, useCropBox: true });
    expect([bitmap.width, bitmap.height]).toEqual([100, 100]);
  });

  // PDF.js Page.getBoundingBox / Page.view: normalize rectangles, intersect
  // CropBox with MediaBox, and use MediaBox when the intersection is empty.
  it.each([
    [[60, 50, 20, 30], [40, 20]],
    [[-10, 30, 60, 110], [60, 70]],
    [[100, 100, 120, 120], [80, 100]],
    [[20, 30, 20, 50], [80, 100]],
  ])("uses PDF.js visible-box rules for %j", (box, size) => {
    const { doc, page } = croppedPage(box);
    for (const bitmap of [page.renderToBitmap({ scale: 1, useCropBox: true }), renderPdfPageToBitmap(doc.save(), 0, { scale: 1, useCropBox: true })]) {
      expect([bitmap.width, bitmap.height]).toEqual(size);
    }
    expect(renderDisplayListToSvg(page.evaluateDisplayList(), { useCropBox: true })).toContain(`width="${size[0]}" height="${size[1]}"`);
  });

  it("applies asymmetric DPI before rotation and pixel crops afterward", () => {
    const { page } = croppedPage();
    page.setRotation(90);
    const bitmap = page.renderToBitmap({ dpiX: 144, dpiY: 72, useCropBox: true, cropRect: { x: 2, y: 5, width: 10, height: 15 } });
    expect([bitmap.width, bitmap.height]).toEqual([10, 15]);
    expect(Array.from(bitmap.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it("honors hideAnnotations through the page methods", () => {
    const { doc, page } = croppedPage();
    const appearance = cosStream(new TextEncoder().encode("0 1 0 rg 0 0 40 20 re f"), { dict: cosDict({ BBox: numbers([0, 0, 40, 20]) }) });
    dictSet(page.pageDict, "Annots", cosArray([doc.cos.allocateObject(cosDict({
      Type: cosName("Annot"), Subtype: cosName("Widget"), Rect: numbers([20, 30, 60, 50]),
      AP: cosDict({ N: doc.cos.allocateObject(appearance) }),
    }))]));
    const shown = page.renderToBitmap({ scale: 1, useCropBox: true });
    const hidden = decodePng(page.renderToPng({ scale: 1, useCropBox: true, hideAnnotations: true }));
    expect(Array.from(shown.data.slice(0, 4))).toEqual([0, 255, 0, 255]);
    expect(Array.from(hidden.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it("crops the finished page without cropping intermediate transparency groups", () => {
    const { doc, page } = croppedPage();
    const form = cosStream(new TextEncoder().encode("1 0 0 rg 20 30 40 20 re f"), { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([0, 0, 80, 100]),
      Group: cosDict({ S: cosName("Transparency"), I: cosBool(true) }),
    }) });
    dictSet(page.pageDict, "Resources", cosDict({ XObject: cosDict({ G: doc.cos.allocateObject(form) }) }));
    page.setRawContentStream("/G Do");
    const bitmap = page.renderToBitmap({ scale: 1, useCropBox: true });
    expect([bitmap.width, bitmap.height]).toEqual([40, 20]);
    expect(Array.from(bitmap.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it("renders the visible artwork in the unchanged PDF.js issue13520 fixture", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue13520.pdf", import.meta.url))));
    const page = doc.getPage(0);
    const scale = 75 / (608.381 - 399.921);
    const bitmap = page.renderToBitmap({ scale, useCropBox: true });
    expect([bitmap.width, bitmap.height]).toEqual([75, 32]);
  });
});
