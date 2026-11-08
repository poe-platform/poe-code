import { expect, it } from "vitest";
import { PdfDocument, decodePng, renderDisplayListToBitmap, renderDisplayListToSvg, renderPdfPageToBitmap } from "../index.js";

const cases = [
  { rotation: 0, width: 120, height: 80, x: 20, y: 55 },
  { rotation: 90, width: 80, height: 120, x: 25, y: 20 },
  { rotation: 180, width: 120, height: 80, x: 100, y: 25 },
  { rotation: 270, width: 80, height: 120, x: 55, y: 100 },
] as const;

for (const { rotation, width, height, x, y } of cases) {
  it(`honors page rotation ${rotation} in all bitmap and PNG entrypoints`, () => {
    const doc = PdfDocument.create(), page = doc.addPage([120, 80]);
    page.setRotation(rotation);
    page.setRawContentStream("1 0 0 rg 10 20 20 10 re f");
    for (const bitmap of [
      renderDisplayListToBitmap(page.evaluateDisplayList(), { scale: 1 }),
      page.renderToBitmap({ scale: 1 }),
      decodePng(page.renderToPng({ scale: 1 })),
      decodePng(doc.renderPageToPng(0, { scale: 1 })),
      renderPdfPageToBitmap(doc.save(), 0, { scale: 1 }),
    ]) {
      expect([bitmap.width, bitmap.height]).toEqual([width, height]);
      expect([...bitmap.data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)]).toEqual([255, 0, 0, 255]);
    }
  });

  it(`uses the rotated viewport dimensions in SVG: ${rotation}`, () => {
    const doc = PdfDocument.create(), page = doc.addPage([120, 80]);
    page.setRotation(rotation);
    const svg = renderDisplayListToSvg(page.evaluateDisplayList());
    expect(svg).toContain(`width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`);
  });
}

// PDF.js api_spec.js "gets viewport": 595.28 x 841.89, scale 1.5, rotation 90.
it("ports the PDF.js rotated viewport size expectation to integer raster dimensions", () => {
  const doc = PdfDocument.create(), page = doc.addPage([595.28, 841.89]);
  page.setRotation(90);
  const bitmap = page.renderToBitmap({ scale: 1.5 });
  expect([bitmap.width, bitmap.height]).toEqual([1263, 893]);
});

it("crops after rotation in displayed pixel coordinates", () => {
  const doc = PdfDocument.create(), page = doc.addPage([120, 80]);
  page.setRotation(90);
  page.setRawContentStream("1 0 0 rg 10 20 20 10 re f");
  const options = { scale: 1, cropRect: { x: 20, y: 10, width: 10, height: 20 } };
  const actual = page.renderToBitmap(options);
  const expected = renderPdfPageToBitmap(doc.save(), 0, options);
  expect(actual).toEqual(expected);
  expect([...actual.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
});
