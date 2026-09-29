import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosStream } from "../ast.js";
import { PdfDocument } from "../document.js";
import { serializeCosDocument } from "../cos/writer.js";

function meshPattern(chained: boolean) {
  const mesh = cosStream(new Uint8Array([
    0, 0, 0, 255, 0, 0,
    0, 255, 0, 0, 255, 0,
    0, 0, 255, 0, 0, 255,
  ]), { dict: cosDict({ ShadingType: cosNumber(4), ColorSpace: cosName("DeviceRGB"),
    BitsPerCoordinate: cosNumber(8), BitsPerComponent: cosNumber(8), BitsPerFlag: cosNumber(8),
    Decode: cosArray([0, 100, 0, 100, 0, 1, 0, 1, 0, 1].map(value => cosNumber(value))),
  }) });
  return PdfDocument.load(serializeCosDocument({ objects: [
    { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
    { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Count: cosNumber(1), Kids: cosArray([cosRef(3)]) }) },
    { objectNumber: 3, generationNumber: 0, value: cosDict({ Type: cosName("Page"), Parent: cosRef(2), MediaBox: cosArray([0, 0, 100, 100].map(value => cosNumber(value))), Contents: cosRef(4),
      Resources: cosDict({ Pattern: cosDict({ P: cosDict({ PatternType: cosNumber(2), Shading: chained ? cosRef(6) : cosRef(5) }) }) }),
    }) },
    { objectNumber: 4, generationNumber: 0, value: cosStream(new TextEncoder().encode("/Pattern cs /P scn 0 0 100 100 re f")) },
    { objectNumber: 5, generationNumber: 0, value: mesh },
    { objectNumber: 6, generationNumber: 0, value: cosRef(5) },
  ], rootRef: cosRef(1) }));
}

describe("mesh shading patterns", () => {
  it.each([false, true])("retains the shading stream (chained reference=%s)", chained => {
    const doc = meshPattern(chained);
    const image = doc.getPage(0).evaluateDisplayList().images[0];
    expect(image?.decodedRgba).toBeDefined();
    const bitmap = doc.getPage(0).renderToBitmap({ dpi: 72 });
    const pixel = (75 * bitmap.width + 25) * 4;
    expect(Array.from(bitmap.data.slice(pixel, pixel + 3))).toEqual([128, 65, 62]);
  });

  it("retains PDF.js issue2948's rainbow mesh rather than painting black", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue2948.pdf", import.meta.url))));
    expect(doc.getPage(0).evaluateDisplayList().images.some(image => image.name === "PatternShading_R8" && image.decodedRgba)).toBe(true);
  });
});
