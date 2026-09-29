import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosBool, cosDict, cosName, cosNumber, cosStream, dictDelete, dictGet, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { decodePng, renderDisplayListToSvg, renderPdfPageToBitmap } from "./raster.js";

const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));

function offsetPage(x: number, y: number, content = "1 0 0 rg 20 30 40 20 re f") {
  const doc = PdfDocument.create(), page = doc.addPage([80, 100]);
  dictSet(page.pageDict, "MediaBox", numbers([x, y, x + 80, y + 100]));
  page.setCropBox(x + 20, y + 30, x + 60, y + 50);
  page.setRawContentStream(`1 0 0 1 ${x} ${y} cm ${content}`);
  return { doc, page };
}

describe("MediaBox rendering origins", () => {
  it.each([0, 90, 180, 270] as const)("renders positive and negative origins before rotation %s", rotation => {
    for (const [x, y] of [[100, 200], [-100, -200], [-100, 200]]) {
      const { doc, page } = offsetPage(x!, y!);
      page.setRotation(rotation);
      const options = { scale: 1, useCropBox: true };
      for (const bitmap of [page.renderToBitmap(options), decodePng(page.renderToPng(options)), renderPdfPageToBitmap(doc.save(), 0, options)]) {
        expect([bitmap.width, bitmap.height]).toEqual(rotation % 180 ? [20, 40] : [40, 20]);
        expect(Array.from(bitmap.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
        expect(bitmap.data.every((value, index) => value === (index % 4 === 0 || index % 4 === 3 ? 255 : 0))).toBe(true);
      }
    }
  });

  it("resolves inherited and reversed MediaBox bounds without changing editing coordinates", () => {
    const { doc, page } = offsetPage(100, 200);
    dictSet(page.pageDict, "MediaBox", numbers([180, 300, 100, 200]));
    const parent = doc.cos.resolveDict(dictGet(page.pageDict, "Parent"))!;
    dictSet(parent, "MediaBox", dictGet(page.pageDict, "MediaBox")!);
    dictDelete(page.pageDict, "MediaBox");
    const content = page.getContentAst(), list = page.evaluateDisplayList();
    expect(list.paths[0]!.segments[0]).toMatchObject({ x: 120, y: 230 });
    const bitmap = page.renderToBitmap({ scale: 1, useCropBox: true });
    expect(Array.from(bitmap.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(page.getContentAst()).toEqual(content);
    expect(page.evaluateDisplayList()).toEqual(list);
  });

  it.each(["paths", "image", "group", "soft mask"])("translates %s, clipping and anisotropic output together", kind => {
    function render(x: number, y: number) {
      const { doc, page } = offsetPage(x, y);
      const form = cosStream(new TextEncoder().encode("0.5 g 0 0 80 100 re f"), { dict: cosDict({
        Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([0, 0, 80, 100]),
        Group: cosDict({ S: cosName("Transparency"), I: cosBool(true) }),
      }) });
      const image = cosStream(new Uint8Array([255, 0, 0, 0, 0, 255]), { dict: cosDict({
        Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(2), Height: cosNumber(1),
        ColorSpace: cosName("DeviceRGB"), BitsPerComponent: cosNumber(8),
      }) });
      dictSet(page.pageDict, "Resources", cosDict({
        XObject: cosDict({ G: doc.cos.allocateObject(form), I: doc.cos.allocateObject(image) }),
        ExtGState: cosDict({ M: cosDict({ SMask: cosDict({ S: cosName("Luminosity"), G: doc.cos.allocateObject(form) }) }) }),
      }));
      const paints: Record<string, string> = {
        paths: "1 0 0 rg 0 0 80 100 re f 0 0 1 RG 4 w 10 20 m 70 60 l S",
        image: "80 0 0 100 0 0 cm /I Do",
        group: "/G Do", "soft mask": "/M gs 1 0 0 rg 0 0 80 100 re f",
      };
      page.setRawContentStream(`1 0 0 1 ${x} ${y} cm 10 10 m 70 10 l 40 90 l h W n ${paints[kind]}`);
      page.setRotation(90);
      return page.renderToBitmap({ dpiX: 144, dpiY: 72 });
    }
    const actual = render(100, -200), expected = render(0, 0);
    expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
    expect(actual.data.every((value, index) => value === expected.data[index])).toBe(true);
  });

  it("uses the MediaBox origin for an unclipped shading surface", () => {
    function render(x: number, y: number) {
      const { page } = offsetPage(x, y, "/Sh sh");
      dictSet(page.pageDict, "Resources", cosDict({ Shading: cosDict({ Sh: cosDict({
        ShadingType: cosNumber(2), ColorSpace: cosName("DeviceRGB"), Coords: numbers([0, 0, 80, 0]),
        Extend: cosArray([cosBool(true), cosBool(true)]),
        Function: cosDict({ FunctionType: cosNumber(2), Domain: numbers([0, 1]), C0: numbers([1, 0, 0]), C1: numbers([0, 0, 1]), N: cosNumber(1) }),
      }) }) }));
      return page.renderToBitmap({ scale: 1 });
    }
    const actual = render(100, 200), expected = render(0, 0);
    expect(actual.data.every((value, index) => value === expected.data[index])).toBe(true);
  });

  it("renders text at its viewport position while extracting its original PDF coordinates", () => {
    function textPage(x: number, y: number) {
      const { page } = offsetPage(x, y);
      page.setRawContentStream("");
      page.drawText("Hello", { x: x + 20, y: y + 30, size: 12 });
      return page;
    }
    const page = textPage(100, 200), baseline = textPage(0, 0);
    const list = page.evaluateDisplayList();
    expect(list.glyphs[0]!.matrix.slice(4)).toEqual([120, 230]);
    const actual = page.renderToBitmap({ scale: 1 }), expected = baseline.renderToBitmap({ scale: 1 });
    expect(actual.data.every((value, index) => Math.abs(value - expected.data[index]!) <= 1)).toBe(true);
    expect(page.extractText()).toBe("Hello");
    expect(page.evaluateDisplayList().glyphs).toEqual(list.glyphs);
  });

  it.each([
    [0, "1 0 0 1 -100 200"], [90, "0 1 -1 0 -100 -100"],
    [180, "-1 0 0 -1 180 -100"], [270, "0 -1 1 0 200 180"],
  ] as const)("uses the PDF.js viewport transform for SVG rotation %s", (rotation, matrix) => {
    const { page } = offsetPage(100, 200);
    page.setRotation(rotation);
    const svg = renderDisplayListToSvg(page.evaluateDisplayList(), { useCropBox: true });
    expect(svg).toContain(`transform="matrix(${matrix})"`);
    expect(svg).toContain(rotation === 90 ? 'viewBox="30 20 20 40"' : rotation === 270 ? 'viewBox="50 20 20 40"' : rotation === 180 ? 'viewBox="20 30 40 20"' : 'viewBox="20 50 40 20"');
  });

  it("renders the unchanged PDF.js bug852992 negative-origin soft-mask fixture", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-bug852992-reduced.pdf", import.meta.url))));
    const bitmap = doc.getPage(0).renderToBitmap({ scale: 1 });
    expect([bitmap.width, bitmap.height]).toEqual([540, 190]);
    // Independent PDF.js reference: solid left background at viewport (20, 20).
    const offset = (20 * bitmap.width + 20) * 4;
    expect(Array.from(bitmap.data.slice(offset, offset + 4))).toEqual([128, 204, 128, 255]);
  });
});
