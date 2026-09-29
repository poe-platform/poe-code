import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosStream, cosString, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { decodeXObjectImageToRgba } from "../extract/images.js";

const numbers = (values: readonly number[]) => cosArray(values.map(value => cosNumber(value)));
// Ported from PDF.js colorspace_spec.js: CalGrayCS, CalRGBCS and LabCS.
const vectors = [
  { family: "CalGray", samples: [27, 125, 250, 131], expected: [25, 25, 25, 143, 143, 143, 251, 251, 251, 149, 149, 149], input: [1], rgb: [255, 255, 255] },
  { family: "CalRGB", samples: [27, 125, 250, 131, 139, 140, 111, 25, 198, 21, 147, 255], expected: [0, 238, 255, 185, 196, 195, 235, 0, 243, 0, 255, 255], input: [0.1, 0.2, 0.3], rgb: [0, 147, 151] },
  { family: "Lab", samples: [27, 25, 50, 31, 19, 40, 11, 25, 98, 21, 47, 55], expected: [0, 49, 101, 0, 53, 117, 0, 41, 40, 0, 43, 90], input: [55, 25, 35], rgb: [188, 100, 61] },
];
function colorSpace(family: string) {
  return cosArray([cosName(family), cosDict({
    WhitePoint: numbers([1, 1, 1]), BlackPoint: numbers([0, 0, 0]),
    ...(family === "CalGray" ? { Gamma: cosNumber(2) } : family === "CalRGB" ? { Gamma: numbers([1, 1, 1]), Matrix: numbers([1, 0, 0, 0, 1, 0, 0, 0, 1]) } : { Range: numbers([-100, 100, -100, 100]) }),
  })]);
}

describe("PDF.js calibrated color reference vectors", () => {
  it("preserves the gray ramp in PDF.js's unchanged calgray equality fixture", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-calgray.pdf", import.meta.url))));
    const bitmap = doc.getPage(0).renderToBitmap({ scale: 400 / 1100, useCropBox: true });
    expect([bitmap.width, bitmap.height]).toEqual([309, 400]);
    for (const [x, y, gray] of [[110, 350, 23], [180, 280, 146], [180, 200, 186], [110, 130, 209], [180, 50, 245]]) {
      const offset = (y! * bitmap.width + x!) * 4;
      expect(Array.from(bitmap.data.slice(offset, offset + 4))).toEqual([gray, gray, gray, 255]);
    }
  });

  it.each(vectors)("converts $family path colors", ({ family, input, rgb }) => {
    const doc = PdfDocument.create(), page = doc.addPage([10, 10]);
    dictSet(page.pageDict, "Resources", cosDict({ ColorSpace: cosDict({ CS: colorSpace(family) }) }));
    page.setRawContentStream(`/CS cs ${input.join(" ")} scn 0 0 10 10 re f`);
    expect(Array.from(page.renderToBitmap({ scale: 1 }).data.slice(0, 4))).toEqual([...rgb, 255]);
  });

  it.each(vectors)("converts $family image samples", ({ family, samples, expected }) => {
    const stream = cosStream(new Uint8Array(samples), { dict: cosDict({ Width: cosNumber(4), Height: cosNumber(1), BitsPerComponent: cosNumber(8), ColorSpace: colorSpace(family) }) });
    const image = decodeXObjectImageToRgba(PdfDocument.create().cos, stream, undefined);
    expect(Array.from(image.rgba.filter((_, index) => index % 4 < 3))).toEqual(expected);
  });

  it.each(vectors)("converts $family indexed palettes", ({ family, samples, expected }) => {
    const cs = cosArray([cosName("Indexed"), colorSpace(family), cosNumber(3), cosString(new Uint8Array(samples))]);
    const stream = cosStream(new Uint8Array([0, 1, 2, 3]), { dict: cosDict({ Width: cosNumber(4), Height: cosNumber(1), BitsPerComponent: cosNumber(8), ColorSpace: cs }) });
    const image = decodeXObjectImageToRgba(PdfDocument.create().cos, stream, undefined);
    expect(Array.from(image.rgba.filter((_, index) => index % 4 < 3))).toEqual(expected);
  });

  it.each(vectors)("uses $family as an image tint alternate space", ({ family, input, rgb }) => {
    const tint = cosDict({ FunctionType: cosNumber(2), Domain: numbers([0, 1]), N: cosNumber(1), C0: numbers(input), C1: numbers(input) });
    const cs = cosArray([cosName("Separation"), cosName("Spot"), colorSpace(family), tint]);
    const stream = cosStream(new Uint8Array([255]), { dict: cosDict({ Width: cosNumber(1), Height: cosNumber(1), BitsPerComponent: cosNumber(8), ColorSpace: cs }) });
    expect(Array.from(decodeXObjectImageToRgba(PdfDocument.create().cos, stream, undefined).rgba)).toEqual([...rgb, 255]);
  });
});
