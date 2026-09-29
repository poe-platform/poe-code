import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosBool, cosDict, cosName, cosNumber, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { renderDisplayListToSvg, type RgbaBitmap } from "./raster.js";

const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));

function groupPdf(options: { alpha?: number; blend?: string | undefined; inner?: string; backdrop?: string; isolated?: boolean; mask?: boolean; nested?: boolean; clip?: string } = {}) {
  const doc = PdfDocument.create();
  const page = doc.addPage([80, 80]);
  const form = cosStream(new TextEncoder().encode(options.inner ?? "/Normal gs 1 0 0 rg 0 0 30 40 re f 10 0 30 40 re f"), { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([0, 0, 40, 40]),
    Group: cosDict({ S: cosName("Transparency"), I: cosBool(options.isolated ?? false) }),
    Resources: cosDict({ ExtGState: cosDict({
      Normal: cosDict({ ca: cosNumber(1), BM: cosName("Normal") }),
      Multiply: cosDict({ BM: cosName("Multiply") }),
      Half: cosDict({ ca: cosNumber(0.5) }),
    }) }),
  }) });
  const groupState = cosDict({ ca: cosNumber(options.alpha ?? 0.5), CA: cosNumber(0.5),
    ...(options.blend ? { BM: cosName(options.blend) } : {}),
  });
  if (options.mask) {
    const maskForm = cosStream(new TextEncoder().encode("0.5 g 0 0 40 40 re f"), { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([0, 0, 40, 40]),
      Group: cosDict({ S: cosName("Transparency"), CS: cosName("DeviceRGB") }),
    }) });
    dictSet(groupState, "SMask", cosDict({ S: cosName("Luminosity"), G: doc.cos.allocateObject(maskForm) }));
  }
  let formRef = doc.cos.allocateObject(form);
  if (options.nested) {
    formRef = doc.cos.allocateObject(cosStream(new TextEncoder().encode("/Half gs /Child Do"), { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([0, 0, 40, 40]),
      Group: cosDict({ S: cosName("Transparency"), I: cosBool(options.isolated ?? false) }),
      Resources: cosDict({ XObject: cosDict({ Child: formRef }), ExtGState: cosDict({ Half: cosDict({ ca: cosNumber(0.5) }) }) }),
    }) }));
  }
  dictSet(page.pageDict, "Resources", cosDict({
    XObject: cosDict({ G: formRef }),
    ExtGState: cosDict({ Group: groupState, Half: cosDict({ ca: cosNumber(0.5) }) }),
  }));
  page.setRawContentStream(new TextEncoder().encode(`${options.backdrop ?? ""} ${options.clip ?? ""} /Group gs /G Do`));
  return page;
}

function pixel(bitmap: RgbaBitmap, x: number, y: number) {
  const offset = ((bitmap.height - 1 - y) * bitmap.width + x) * 4;
  return Array.from(bitmap.data.subarray(offset, offset + 4));
}

describe("non-isolated transparency Forms", () => {
  it("applies outer opacity once despite overlapping children resetting their state", () => {
    const page = groupPdf();
    const bitmap = page.renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 5, 20)).toEqual([255, 127, 127, 255]);
    expect(pixel(bitmap, 20, 20)).toEqual([255, 127, 127, 255]);
    expect(pixel(bitmap, 60, 20)).toEqual([255, 255, 255, 255]);
  });

  it("applies the outer blend after children reset their blend mode", () => {
    const bitmap = groupPdf({ alpha: 1, blend: "Difference", backdrop: "0.2 0.4 0.6 rg 0 0 80 80 re f" }).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([204, 102, 153, 255]);
  });

  it("keeps the viewer background outside the page's blending backdrop", () => {
    const page = groupPdf({ alpha: 1, blend: "Difference" });
    expect(pixel(page.renderToBitmap({ scale: 1 }), 20, 20)).toEqual([255, 0, 0, 255]);
    const bitmap = page.renderToBitmap({ scale: 1, background: { r: 0, g: 0, b: 1 } });
    expect(pixel(bitmap, 20, 20)).toEqual([255, 0, 0, 255]);
    expect(pixel(bitmap, 60, 20)).toEqual([0, 0, 255, 255]);
  });

  it("matches PDF.js intermediate surfaces when a group has outer opacity", () => {
    const bitmap = groupPdf({ inner: "/Multiply gs 0.5 g 0 0 40 40 re f", backdrop: "0.8 0.4 0.2 rg 0 0 80 80 re f" }).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([166, 115, 90, 255]);
  });

  it("keeps explicitly isolated groups independent of the page backdrop", () => {
    const bitmap = groupPdf({ isolated: true, inner: "/Multiply gs 0.5 g 0 0 40 40 re f", backdrop: "0.8 0.4 0.2 rg 0 0 80 80 re f" }).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([166, 115, 90, 255]);
  });

  it("composites group opacity over a partially transparent backdrop", () => {
    const bitmap = groupPdf({ inner: "/Half gs /Multiply gs 0.5 g 0 0 40 40 re f", backdrop: "q /Half gs 0.8 0.4 0.2 rg 0 0 80 80 re f Q" }).renderToBitmap({ scale: 1, transparent: true });
    const actual = pixel(bitmap, 20, 20);
    // Independent Poppler/PDFium references: alpha .5 + (.5 * .5) * (1 - .5).
    [173, 112, 81, 160].forEach((channel, i) => expect(Math.abs(actual[i]! - channel)).toBeLessThanOrEqual(1));
    expect(pixel(bitmap, 60, 20)).toEqual([204, 102, 51, 128]);
  });

  it("preserves transparency outside the group on an empty backdrop", () => {
    const bitmap = groupPdf().renderToBitmap({ scale: 1, transparent: true });
    expect(pixel(bitmap, 20, 20)).toEqual([255, 0, 0, 128]);
    expect(pixel(bitmap, 60, 20)).toEqual([0, 0, 0, 0]);
  });

  it.each([false, true])("composites nested group opacity once (isolated %s)", isolated => {
    const bitmap = groupPdf({ isolated, nested: true }).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([255, 191, 191, 255]);
  });

  it("applies an outer mask and clip to the finished group", () => {
    const bitmap = groupPdf({ mask: true, clip: "0 0 25 80 re W n" }).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([255, 191, 191, 255]);
    expect(pixel(bitmap, 30, 20)).toEqual([255, 255, 255, 255]);
  });

  it.each([undefined, "Normal", "Compatible"])("retains inherited stroke alpha with blend mode %s", blend => {
    const page = groupPdf({ alpha: 1, blend, inner: "1 0 0 RG 10 w 0 20 m 40 20 l S" });
    expect(pixel(page.renderToBitmap({ scale: 1 }), 20, 20)).toEqual([255, 128, 128, 255]);
  });

  it("keeps group contents as vectors and isolates the SVG page from its background", () => {
    const svg = renderDisplayListToSvg(groupPdf().evaluateDisplayList(), { scale: 1 });
    expect(svg).toContain('<g opacity="0.5" style="isolation:isolate">');
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<image");
    expect(svg.indexOf('<rect')).toBeLessThan(svg.indexOf('<g style="isolation:isolate">'));
  });

  it.each([undefined, "Normal", "Compatible"])("blends ordinary groups directly with outer mode %s", blend => {
    const bitmap = groupPdf({ alpha: 1, blend, inner: "/Multiply gs 0.5 g 0 0 40 40 re f", backdrop: "0.8 0.4 0.2 rg 0 0 80 80 re f" }).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([102, 51, 26, 255]);
  });

  it("preserves the overlap in PDF.js's unchanged transparency_group equality fixture", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-transparency_group.pdf", import.meta.url))));
    const page = doc.getPage(0);
    const bitmap = page.renderToBitmap({ scale: 150 / page.getSize().width });
    // Sample locations and reference colors come from the independent PDF.js render.
    expect(bitmap.width).toBe(150);
    expect(bitmap.height).toBe(113);
    for (const [x, y, rgb] of [
      [75, 45, [9, 32, 34]], [80, 50, [25, 10, 52]],
      [90, 65, [196, 98, 125]], [35, 40, [213, 164, 53]],
    ] as const) {
      const actual = pixel(bitmap, x, bitmap.height - 1 - y);
      rgb.forEach((channel, i) => expect(Math.abs(actual[i]! - channel)).toBeLessThanOrEqual(2));
    }
  });

  it("retains the multiply highlights in PDF.js's unchanged bug1873345 fixture", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-bug1873345.pdf", import.meta.url))));
    const page = doc.getPage(0);
    const bitmap = page.renderToBitmap({ scale: 150 / page.getSize().height });
    expect(pixel(bitmap, 50, bitmap.height - 1 - 50)).toEqual([255, 223, 208, 255]);
    expect(pixel(bitmap, 50, bitmap.height - 1 - 75)).toEqual([255, 207, 185, 255]);
  });
});
