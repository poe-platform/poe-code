import { describe, expect, it } from "vitest";
import { cosDict, cosNumber, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import type { RgbaBitmap } from "./raster.js";
import { strokeOutlines } from "./stroke.js";
import nativeVectors from "../fixtures/pdfium-agg-stroke-vectors.json" with { type: "json" };

function stroke(content: string, alpha = 1) {
  const doc = PdfDocument.create();
  const page = doc.addPage([100, 100]);
  dictSet(page.pageDict, "Resources", cosDict({ ExtGState: cosDict({ A: cosDict({ CA: cosNumber(alpha) }) }) }));
  page.setRawContentStream(new TextEncoder().encode(`/A gs 0 0 1 RG 10 w ${content}`));
  return page.renderToBitmap({ scale: 4 });
}

function pixel(bitmap: RgbaBitmap, x: number, y: number) {
  const offset = ((bitmap.height - 1 - Math.floor(y * 4)) * bitmap.width + Math.floor(x * 4)) * 4;
  return Array.from(bitmap.data.subarray(offset, offset + 4));
}

describe("bitmap stroke outlines", () => {
  it.each(nativeVectors)("matches native PDFium AGG: $name", vector => {
    const points = vector.points.map(p => [p[0]!, p[1]!] as const);
    const contours = strokeOutlines([{ points, closed: vector.closed }], vector.width,
      vector.cap as 0 | 1 | 2, vector.join as 0 | 1 | 2, vector.miterLimit);
    expect(contours).toHaveLength(vector.contours.length);
    contours.forEach((contour, i) => {
      expect(contour).toHaveLength(vector.contours[i]!.length);
      contour.forEach((point, j) => {
        expect(point[0]).toBeCloseTo(vector.contours[i]![j]![0]!, 4);
        expect(point[1]).toBeCloseTo(vector.contours[i]![j]![1]!, 4);
      });
    });
  });

  // PDF.js delegates joins/caps to Canvas; PDFium uses AGG's miter_join_revert,
  // round_join and bevel_join with the PDF line width and miter limit.
  it.each([
    [0, 16, true], [1, 16, false], [1, 17, true], [2, 17, false], [2, 18, true],
  ] as const)("paints join %i at the rectangle corner (%i)", (join, coordinate, painted) => {
    const bitmap = stroke(`${join} j 20 20 60 60 re S`);
    expect(pixel(bitmap, coordinate, coordinate)).toEqual(painted ? [0, 0, 255, 255] : [255, 255, 255, 255]);
    expect(pixel(bitmap, 50, 50)).toEqual([255, 255, 255, 255]);
  });

  it.each([1, 2, 10])("uses miter limit %i to select bevel fallback", limit => {
    const bitmap = stroke(`${limit} M 20 20 60 60 re S`);
    expect(pixel(bitmap, 16, 16)).toEqual(limit === 1 ? [255, 255, 255, 255] : [0, 0, 255, 255]);
  });

  it("keeps reflected rectangle joins and the interior hole", () => {
    const bitmap = stroke("-1 0 0 1 100 0 cm 20 20 60 60 re S");
    expect(pixel(bitmap, 16, 16)).toEqual([0, 0, 255, 255]);
    expect(pixel(bitmap, 50, 50)).toEqual([255, 255, 255, 255]);
  });

  it("composites overlapping segments of one stroke only once", () => {
    const bitmap = stroke("10 50 m 90 50 l 50 10 m 50 90 l S", 0.5);
    expect(pixel(bitmap, 50, 50)).toEqual([128, 128, 255, 255]);
    expect(pixel(bitmap, 25, 50)).toEqual(pixel(bitmap, 50, 50));
  });

  it("does not join distinct subpaths that share an endpoint", () => {
    const bitmap = stroke("10 20 m 20 20 l 20 20 m 20 30 l S");
    expect(pixel(bitmap, 23, 17)).toEqual([255, 255, 255, 255]);
  });

  it.each([0, 1, 2])("applies cap %i only at open subpath endpoints", cap => {
    const bitmap = stroke(`${cap} J 10 50 m 90 50 l S`);
    expect(pixel(bitmap, 7, 50)).toEqual(cap === 0 ? [255, 255, 255, 255] : [0, 0, 255, 255]);
    expect(pixel(bitmap, 6, 54)).toEqual(cap === 2 ? [0, 0, 255, 255] : [255, 255, 255, 255]);
  });

  it("joins an uninterrupted dash across a path vertex", () => {
    const bitmap = stroke("[30 20] 0 d 20 20 m 40 20 l 40 40 l S");
    expect(pixel(bitmap, 44, 16)).toEqual([0, 0, 255, 255]);
    expect(pixel(bitmap, 40, 35)).toEqual([255, 255, 255, 255]);
  });

  it("joins an uninterrupted dash across a closed path's seam", () => {
    const bitmap = stroke("[200 10] 0 d 20 20 60 60 re S");
    expect(pixel(bitmap, 16, 16)).toEqual([0, 0, 255, 255]);
  });

  it("resets dash phase for every subpath", () => {
    const bitmap = stroke("[10 10] 0 d 10 20 m 25 20 l 10 40 m 40 40 l S");
    expect(pixel(bitmap, 12, 40)).toEqual([0, 0, 255, 255]);
    expect(pixel(bitmap, 22, 40)).toEqual([255, 255, 255, 255]);
  });

  it.each([0, 1, 2])("handles a zero-length segment with cap %i", cap => {
    const bitmap = stroke(`${cap} J 50 50 m 50 50 l S`);
    expect(pixel(bitmap, 50, 50)).toEqual(cap === 1 ? [0, 0, 255, 255] : [255, 255, 255, 255]);
  });

  it("repeats odd-length dash arrays with alternating paint and gap phases", () => {
    const bitmap = stroke("[10 5 5] 0 d 10 50 m 90 50 l S");
    expect(pixel(bitmap, 27, 50)).toEqual([0, 0, 255, 255]);
    expect(pixel(bitmap, 32, 50)).toEqual([255, 255, 255, 255]);
    expect(pixel(bitmap, 42, 50)).toEqual([0, 0, 255, 255]);
  });

  it("paints zero-length round dashes as dots", () => {
    const bitmap = stroke("1 J [0 20] 0 d 10 50 m 90 50 l S");
    expect(pixel(bitmap, 30, 50)).toEqual([0, 0, 255, 255]);
    expect(pixel(bitmap, 20, 50)).toEqual([255, 255, 255, 255]);
    // PDF.js and Poppler stop before a zero-length dash at the final endpoint.
    expect(pixel(bitmap, 90, 50)).toEqual([255, 255, 255, 255]);
  });

  it("bounds dash expansion and large-radius join subdivision", () => {
    expect(() => strokeOutlines([{ points: [[0, 0], [1e12, 0]], closed: false }], 10, 0, 0, 10, [1, 1]))
      .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
    expect(() => strokeOutlines([{ points: [[0, 0], [10, 0], [10, 10]], closed: false }], 1e15, 0, 1, 10))
      .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
  });
});
