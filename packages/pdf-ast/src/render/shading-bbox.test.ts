import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";

const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));

describe("function shading bounding boxes", () => {
  it.each([
    { name: "identity", matrix: [1, 0, 0, 1, 0, 0], inside: [35, 70], outside: [45, 70] },
    { name: "translation", matrix: [1, 0, 0, 1, 10, 20], inside: [45, 50], outside: [55, 50] },
    { name: "rotation", matrix: [0, 1, -1, 0, 80, 0], inside: [50, 65], outside: [50, 55] },
    { name: "shear", matrix: [1, 0.3, 0.4, 1, 0, 0], inside: [47, 59], outside: [57, 56] },
  ])("clips before the function matrix under $name", ({ matrix, inside, outside }) => {
    const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
    dictSet(page.pageDict, "Resources", cosDict({ Shading: cosDict({ Sh: cosDict({
      ShadingType: cosNumber(1), ColorSpace: cosName("DeviceRGB"),
      Domain: numbers([0, 1, 0, 1]), Matrix: numbers([20, 0, 0, 20, 30, 20]),
      BBox: numbers([30, 20, 40, 40]),
      Function: cosStream(new TextEncoder().encode("{ pop pop 1 0 0 }"), { dict: cosDict({
        FunctionType: cosNumber(4), Domain: numbers([0, 1, 0, 1]), Range: numbers([0, 1, 0, 1, 0, 1]),
      }) }),
    }) }) }));
    page.setRawContentStream(`${matrix.join(" ")} cm /Sh sh`);
    const bitmap = page.renderToBitmap({ scale: 1 });
    for (const [position, expected] of [[inside, [255, 0, 0, 255]], [outside, [255, 255, 255, 255]]]) {
      const [x, y] = position!;
      const offset = (y! * bitmap.width + x!) * 4;
      expect(Array.from(bitmap.data.slice(offset, offset + 4))).toEqual(expected);
    }
  });

  it("retains the bounded gradient in PDF.js's function_based_shading fixture", () => {
    const bytes = new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-function_based_shading.pdf", import.meta.url)));
    const bitmap = PdfDocument.load(bytes).getPage(0).renderToBitmap({ scale: 400 / 792 });
    // Independently rendered PDF.js pixels; PDFium confirms the same panel.
    for (const [x, y, gray] of [[58, 164, 3], [35, 140, 137], [78, 188, 135], [60, 190, 111]]) {
      const offset = (y! * bitmap.width + x!) * 4;
      for (let channel = 0; channel < 3; channel++) expect(Math.abs(bitmap.data[offset + channel]! - gray!)).toBeLessThanOrEqual(8);
      expect(bitmap.data[offset + 3]).toBe(255);
    }
  });
});
