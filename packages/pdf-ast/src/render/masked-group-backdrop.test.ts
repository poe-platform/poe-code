import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosBool, cosDict, cosName, cosNumber, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { decodePng, renderDisplayListToBitmap, renderDisplayListToSvg, type RgbaBitmap } from "./raster.js";

const numbers = (values: readonly number[]) => cosArray(values.map(value => cosNumber(value)));

function maskedGroup(options: { isolated?: boolean; mask?: boolean; blend?: string; alpha?: number; backgroundAlpha?: number; matrix?: number[]; nested?: boolean } = {}) {
  const doc = PdfDocument.create(), page = doc.addPage([40, 40]);
  const mask = cosStream(new TextEncoder().encode("0.5 g 0 0 40 40 re f"), { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([0, 0, 40, 40]),
    Group: cosDict({ S: cosName("Transparency"), I: cosBool(true) }),
  }) });
  const resources = cosDict({ ExtGState: cosDict({ B: cosDict({ BM: cosName(options.blend ?? "Screen") }) }) });
  const paint = new TextEncoder().encode("/B gs 1 0 0 rg 0 0 40 40 re f");
  const form = cosStream(options.nested ? new TextEncoder().encode("/Inner Do") : paint, { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([10, 10, 30, 30]),
    Group: cosDict({ S: cosName("Transparency"), I: cosBool(options.isolated ?? false) }),
    ...(options.matrix ? { Matrix: numbers(options.matrix) } : {}), Resources: resources,
  }) });
  if (options.nested) {
    const inner = cosStream(paint, { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([10, 10, 30, 30]),
      Group: cosDict({ S: cosName("Transparency"), I: cosBool(false) }), Resources: resources,
    }) });
    dictSet(form.dict, "Resources", cosDict({ XObject: cosDict({ Inner: doc.cos.allocateObject(inner) }) }));
  }
  dictSet(page.pageDict, "Resources", cosDict({
    XObject: cosDict({ G: doc.cos.allocateObject(form) }),
    ExtGState: cosDict({
      BG: cosDict({ ca: cosNumber(options.backgroundAlpha ?? 1) }),
      Outer: cosDict({ ca: cosNumber(options.alpha ?? 1),
        ...(options.mask === false ? {} : { SMask: cosDict({ S: cosName("Luminosity"), G: doc.cos.allocateObject(mask) }) }),
      }),
    }),
  }));
  page.setRawContentStream("/BG gs 0 0 1 rg 0 0 40 40 re f /Outer gs /G Do");
  return { doc, page };
}

function pixel(bitmap: RgbaBitmap, x = 20, y = 20) {
  const offset = ((bitmap.height - 1 - y) * bitmap.width + x) * 4;
  return Array.from(bitmap.data.slice(offset, offset + 4));
}

describe("PDF.js masked non-isolated group backdrops", () => {
  it.each([
    ["Screen", [128, 0, 255, 255]], ["Multiply", [0, 0, 127, 255]],
  ] as const)("lets inner %s paints see the page before applying the outer mask", (blend, expected) => {
    const { page } = maskedGroup({ blend });
    expect(pixel(page.renderToBitmap({ scale: 1 }))).toEqual(expected);
    expect(pixel(decodePng(page.renderToPng({ scale: 1 })))).toEqual(expected);
  });

  it("retains transparent intermediates for isolated groups", () => {
    expect(pixel(maskedGroup({ isolated: true }).page.renderToBitmap({ scale: 1 }))).toEqual([128, 0, 127, 255]);
  });

  it("blends unmasked outer-opacity groups against the backdrop", () => {
    expect(pixel(maskedGroup({ mask: false, alpha: 0.5 }).page.renderToBitmap({ scale: 1 }))).toEqual([128, 0, 255, 255]);
  });

  it("keeps ordinary Normal paints independent of backdrop copying", () => {
    const { page } = maskedGroup({ blend: "Normal" });
    expect(pixel(page.renderToBitmap({ scale: 1 }))).toEqual([128, 0, 127, 255]);
    expect(renderDisplayListToSvg(page.evaluateDisplayList())).toContain("<path");
  });

  it("applies the outer alpha and mask once after inner blending", () => {
    expect(pixel(maskedGroup({ alpha: 0.5 }).page.renderToBitmap({ scale: 1 }))).toEqual([64, 0, 255, 255]);
  });

  it("detects blend effects in nested Forms", () => {
    expect(pixel(maskedGroup({ nested: true }).page.renderToBitmap({ scale: 1 }))).toEqual([128, 0, 255, 255]);
  });

  it("clips the copied backdrop to the transformed Form BBox", () => {
    const c = Math.SQRT1_2;
    const { page } = maskedGroup({ backgroundAlpha: 0.5, matrix: [c, c, -c, c, 20, -10] });
    const bitmap = page.renderToBitmap({ scale: 1, transparent: true });
    // This point is inside the axial bounds but outside the rotated BBox.
    expect(pixel(bitmap, 7, 6)).toEqual([0, 0, 255, 128]);
  });

  it("preserves display lists and editing coordinates while rendering the backdrop", () => {
    const { page } = maskedGroup();
    const content = page.getContentAst(), list = page.evaluateDisplayList();
    const snapshot = structuredClone(list);
    renderDisplayListToBitmap(list, { scale: 1 });
    expect(page.getContentAst()).toEqual(content);
    expect(list).toEqual(snapshot);
  });

  it("preserves contextual blending in SVG with a raster fallback", () => {
    const { page } = maskedGroup();
    const svg = renderDisplayListToSvg(page.evaluateDisplayList(), { scale: 1 });
    expect(svg).toContain('width="40" height="40"');
    const href = svg.match(/href="data:image\/png;base64,([^"]+)"/);
    expect(href).not.toBeNull();
    expect(pixel(decodePng(new Uint8Array(Buffer.from(href![1]!, "base64"))))).toEqual([128, 0, 255, 255]);
  });

  it("keeps rotation, CropBox, DPI and pixel crops in the SVG fallback", () => {
    const { page } = maskedGroup();
    page.setCropBox(10, 10, 30, 30);
    page.setRotation(90);
    const svg = renderDisplayListToSvg(page.evaluateDisplayList(), {
      dpiX: 144, dpiY: 72, useCropBox: true, cropRect: { x: 2, y: 3, width: 5, height: 6 },
    });
    expect(svg).toContain('width="5" height="6"');
    const href = svg.match(/href="data:image\/png;base64,([^"]+)"/)!;
    const bitmap = decodePng(new Uint8Array(Buffer.from(href[1]!, "base64")));
    expect([bitmap.width, bitmap.height]).toEqual([5, 6]);
    expect(pixel(bitmap, 2, 2)).toEqual([128, 0, 255, 255]);
  });

  it("removes the dark circle from the unchanged PDF.js issue13520 fixture", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue13520.pdf", import.meta.url))));
    const bitmap = doc.getPage(0).renderToBitmap({ scale: 75 / (608.381 - 399.921), useCropBox: true });
    const offset = (17 * bitmap.width + 62) * 4;
    const actual = Array.from(bitmap.data.slice(offset, offset + 4));
    for (const [index, expected] of [209, 207, 180, 255].entries()) expect(Math.abs(actual[index]! - expected)).toBeLessThanOrEqual(7);
  });
});
