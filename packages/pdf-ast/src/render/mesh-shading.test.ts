import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PdfDocument } from "../document.js";

// Unchanged PDF.js equality fixtures issue4227 and issue6305-part-1.
// Reference pixels come from PDF.js 6.3.289 at scale 400/792.
const fixtures = [
  { name: "coons", colors: [[0, 204, 48], [0, 74, 178], [0, 35, 217], [0, 77, 176], [0, 43, 209], [0, 204, 49], [0, 198, 54], [0, 160, 92], [0, 185, 67]] },
  { name: "tensor", colors: [[0, 206, 46], [0, 73, 180], [0, 35, 217], [0, 76, 176], [0, 76, 177], [0, 204, 49], [0, 201, 51], [0, 158, 94], [0, 152, 101]] },
];
const positions = [[85, 115], [120, 115], [165, 115], [210, 115], [85, 155], [130, 175], [165, 190], [210, 230], [85, 230]];

describe("PDF.js mesh shading fixtures", () => {
  it.each(fixtures)("preserves curved patches and all reuse flags in $name", ({ name, colors }) => {
    const bytes = new Uint8Array(readFileSync(new URL(`../fixtures/pdfjs-${name}-allflags-withfunction.pdf`, import.meta.url)));
    const bitmap = PdfDocument.load(bytes).getPage(0).renderToBitmap({ scale: 400 / 792 });
    expect([bitmap.width, bitmap.height]).toEqual([309, 400]);
    for (let i = 0; i < positions.length; i++) {
      const [x, y] = positions[i]!;
      const offset = (y! * bitmap.width + x!) * 4;
      for (let channel = 0; channel < 3; channel++) {
        // Allow the independent rasterizers' pixel sampling to differ slightly.
        expect(Math.abs(bitmap.data[offset + channel]! - colors[i]![channel]!), `${name} at ${x},${y}, channel ${channel}`).toBeLessThanOrEqual(8);
      }
      expect(bitmap.data[offset + 3]).toBe(255);
    }
  });
});
