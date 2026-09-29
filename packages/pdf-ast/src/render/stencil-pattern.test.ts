import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosBool, cosDict, cosName, cosNumber, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { extractDocumentImages } from "../extract/images.js";
import { renderDisplayListToSvg } from "./raster.js";

function stencilPattern(options: { inline?: boolean; inverted?: boolean; alpha?: number; onePixel?: boolean; tiling?: boolean; rotated?: boolean; blend?: boolean } = {}) {
  const doc = PdfDocument.create();
  const page = doc.addPage([100, 100]);
  const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));
  const pattern = options.tiling
    ? cosStream(new TextEncoder().encode("1 0 0 rg 0 0 10 20 re f 0 0 1 rg 10 0 10 20 re f"), {
      dict: cosDict({ Type: cosName("Pattern"), PatternType: cosNumber(1), PaintType: cosNumber(1), TilingType: cosNumber(1),
        BBox: numbers([0, 0, 20, 20]), XStep: cosNumber(20), YStep: cosNumber(20), Resources: cosDict({}) }),
    })
    : cosDict({ Type: cosName("Pattern"), PatternType: cosNumber(2), Matrix: numbers([1, 0, 0, 1, 10, 0]),
      Shading: cosDict({ ShadingType: cosNumber(2), ColorSpace: cosName("DeviceRGB"), Coords: numbers([0, 0, 80, 0]),
        Extend: cosArray([cosBool(true), cosBool(true)]),
        Function: cosDict({ FunctionType: cosNumber(2), Domain: numbers([0, 1]), C0: numbers([1, 0, 0]), C1: numbers([0, 0, 1]), N: cosNumber(1) }),
      }),
    });
  const width = options.onePixel ? 1 : 4;
  const maskByte = options.onePixel ? 0 : options.inverted ? 0xa0 : 0x50;
  const mask = cosStream(new Uint8Array([maskByte]), { dict: cosDict({ Type: cosName("XObject"), Subtype: cosName("Image"),
    Width: cosNumber(width), Height: cosNumber(1), BitsPerComponent: cosNumber(1), ImageMask: cosBool(true),
    Decode: numbers(options.inverted ? [1, 0] : [0, 1]),
  }) });
  dictSet(page.pageDict, "Resources", cosDict({ Pattern: cosDict({ P: doc.cos.allocateObject(pattern) }),
    XObject: cosDict({ M: doc.cos.allocateObject(mask) }),
    ExtGState: cosDict({ G: cosDict({ ca: cosNumber(options.alpha ?? 1), BM: cosName(options.blend ? "Multiply" : "Normal") }) }),
  }));
  const image = options.inline
    ? `BI /W ${width} /H 1 /IM true /BPC 1 /D [${options.inverted ? "1 0" : "0 1"}] ID ${String.fromCharCode(maskByte)} EI`
    : "/M Do";
  page.setRawContentStream(new TextEncoder().encode(
    `${options.blend ? "0 0 1 rg 0 0 100 100 re f " : ""}q /Pattern cs /P scn /G gs ${options.rotated ? "0 80 -40 0 50 10" : "80 0 0 40 10 10"} cm ${image} Q\n0 1 0 rg 70 70 10 10 re f`
  ));
  return doc;
}

function pixel(doc: PdfDocument, x: number, y: number) {
  const bitmap = doc.getPage(0).renderToBitmap({ dpi: 72 });
  const offset = ((99 - y) * bitmap.width + x) * 4;
  return Array.from(bitmap.data.subarray(offset, offset + 4));
}

describe("pattern-painted stencil images", () => {
  // PDF.js CanvasGraphics._createMaskCanvas paints the pattern through the mask,
  // in page coordinates, rather than coloring its source pixels before scaling.
  it.each([false, true])("paints a gradient through a stencil (inline=%s)", inline => {
    const doc = stencilPattern({ inline });
    expect(pixel(doc, 20, 20)[0]).toBeGreaterThan(200);
    expect(pixel(doc, 20, 20)[2]).toBeGreaterThan(20);
    expect(pixel(doc, 60, 20)[0]).toBeLessThan(120);
    expect(pixel(doc, 60, 20)[2]).toBeGreaterThan(140);
    expect(pixel(doc, 40, 20)).toEqual([255, 255, 255, 255]);
    expect(pixel(doc, 75, 75)).toEqual([0, 255, 0, 255]);
  });

  it("keeps gradient detail when the stencil is only one pixel", () => {
    // Independently confirmed by Poppler and MuPDF. PDF.js's optimized
    // paintSolidColorImageMask currently bypasses its pattern-painting path.
    const doc = stencilPattern({ onePixel: true });
    expect(pixel(doc, 20, 20)[0]).toBeGreaterThan(200);
    expect(pixel(doc, 80, 20)[0]).toBeLessThan(50);
    expect(pixel(doc, 80, 20)[2]).toBeGreaterThan(200);
  });

  it("uses inverted Decode and applies fill alpha only once", () => {
    const doc = stencilPattern({ inverted: true, alpha: 0.5 });
    expect(pixel(doc, 20, 20)[1]).toBe(127);
    expect(pixel(doc, 20, 20)[2]).toBeGreaterThan(135);
    expect(pixel(doc, 20, 20)[2]).toBeLessThan(160);
    expect(pixel(doc, 40, 20)).toEqual([255, 255, 255, 255]);
  });

  it("transforms the stencil independently of the pattern", () => {
    const doc = stencilPattern({ rotated: true });
    expect(pixel(doc, 20, 20)[0]).toBeGreaterThan(200);
    expect(pixel(doc, 20, 20)[2]).toBeGreaterThan(20);
    expect(pixel(doc, 20, 40)).toEqual([255, 255, 255, 255]);
    expect(pixel(doc, 20, 60)).toEqual(pixel(doc, 20, 20));
  });

  it("preserves the stencil's blend mode when painting its shading", () => {
    const doc = stencilPattern({ blend: true });
    const color = pixel(doc, 20, 20);
    expect(color[0]).toBe(0);
    expect(color[1]).toBe(0);
    expect(color[2]).toBeGreaterThan(20);
    expect(color[2]).toBeLessThan(50);
    expect(pixel(doc, 40, 20)).toEqual([0, 0, 255, 255]);
  });

  it("paints tiling patterns through the same stencil", () => {
    const doc = stencilPattern({ tiling: true });
    expect(pixel(doc, 15, 20)).toEqual([0, 0, 255, 255]);
    expect(pixel(doc, 25, 20)).toEqual([255, 0, 0, 255]);
    expect(pixel(doc, 40, 20)).toEqual([255, 255, 255, 255]);
  });

  it("preserves the mask in SVG and keeps image extraction independent of pattern painting", () => {
    const doc = stencilPattern();
    expect(renderDisplayListToSvg(doc.getPage(0).evaluateDisplayList())).toContain("<mask");
    const images = extractDocumentImages(doc.cos);
    expect(images).toHaveLength(1);
    expect(images[0]?.type).toBe("stencil");
    expect(images[0]?.width).toBe(4);
  });

  it("retains the gradient in the original PDF.js issue13372 equality fixture", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue13372.pdf", import.meta.url))));
    const bitmap = doc.getPage(0).renderToBitmap({ scale: 0.25 });
    let coloredPixels = 0;
    for (let i = 0; i < bitmap.data.length; i += 4) {
      if (Math.max(bitmap.data[i]!, bitmap.data[i + 1]!, bitmap.data[i + 2]!) - Math.min(bitmap.data[i]!, bitmap.data[i + 1]!, bitmap.data[i + 2]!) > 30) coloredPixels++;
    }
    expect(coloredPixels).toBeGreaterThan(1000);
  });
});
