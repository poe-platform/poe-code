import { expect, it } from "vitest";
import { PdfDocument } from "../index.js";
import vectors from "../fixtures/pdfium-agg-cubic-vectors.json" with { type: "json" };
import { flattenCubic } from "./cubic.js";

it.each(vectors)("matches native PDFium/AGG subdivision for $curve", ({ curve, points }) => {
  const actual = flattenCubic(...curve as [number, number, number, number, number, number, number, number]);
  expect(actual).toHaveLength(points.length);
  for (let i = 0; i < points.length; i++) {
    expect(actual[i]![0]).toBeCloseTo(points[i]![0]!, 4);
    expect(actual[i]![1]).toBeCloseTo(points[i]![1]!, 4);
  }
});

it("bounds subdivision of extremely large curves and retains endpoints", () => {
  const points = flattenCubic(1, 2, 1e12, 1e12, -1e12, 1e12, 3, 4);
  expect(points.length).toBeLessThanOrEqual(2 ** 16 + 2);
  expect(points[0]).toEqual([1, 2]);
  expect(points.at(-1)).toEqual([3, 4]);
  expect(points.every(point => point.every(Number.isFinite))).toBe(true);
});

it.each(["fill", "clip", "stroke"])("preserves scaled cubic geometry when painting a %s", paint => {
  const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
  const path = "10 50 m 10 90 90 90 90 50 c 90 10 10 10 10 50 c";
  page.setRawContentStream("0 0 1 rg 0 0 1 RG 1 w " + path +
    (paint === "clip" ? " W n 0 0 100 100 re f" : paint === "stroke" ? " S" : " f"));
  const bitmap = page.renderToBitmap({ scale: 6 });
  // PDF.js 6.3.289 reference pixels: both lie inside the actual cubic, where
  // the fixed twelve-edge approximation incorrectly leaves white pixels.
  for (const [x, y] of [[273, 121], [326, 478]]) {
    const offset = (y! * bitmap.width + x!) * 4;
    expect([...bitmap.data.slice(offset, offset + 3)]).toEqual([0, 0, 255]);
  }
});
