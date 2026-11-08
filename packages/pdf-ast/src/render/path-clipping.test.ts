import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument, renderDisplayListToBitmap, renderDisplayListToSvg } from "../index.js";

function display(content: string) {
  const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
  page.drawText("H", { x: 10, y: 10, size: 80 });
  const font = new TextDecoder().decode(page.getRawContentStream()).split("/")[1]!.split(" ")[0]!;
  page.setRawContentStream(content.replaceAll("FONT", font));
  return PdfDocument.load(doc.save()).getPage(0).evaluateDisplayList();
}

function pixel(content: string, x: number, y: number) {
  const bitmap = renderDisplayListToBitmap(display(content), { scale: 1 });
  const offset = ((99 - y) * 100 + x) * 4;
  return [...bitmap.data.slice(offset, offset + 3)];
}

const triangle = "10 10 m 90 10 l 10 90 l W n";
const bluePage = "0 0 1 rg 0 0 100 100 re f";
const blue = [0, 0, 255], white = [255, 255, 255];

it("closes an open triangular clip and retains its SVG geometry", () => {
  const content = `${triangle} ${bluePage}`;
  expect(pixel(content, 20, 20)).toEqual(blue);
  expect(pixel(content, 80, 80)).toEqual(white);
  const svg = renderDisplayListToSvg(display(content));
  expect(svg).toContain("<clipPath");
  expect(svg).toContain('d="M 10 90 L 90 90 L 10 10"');
});

it.each([
  { rule: "W*", inner: "30 30 40 40 re", center: white },
  { rule: "W", inner: "30 30 40 40 re", center: blue },
  { rule: "W", inner: "70 30 -40 40 re", center: white },
  { rule: "W", inner: "30 30 m 30 70 l 70 70 l 70 30 l h", center: white },
])("retains $rule winding with inner path $inner", ({ rule, inner, center }) => {
  const content = `10 10 80 80 re ${inner} ${rule} n ${bluePage}`;
  expect(pixel(content, 20, 20)).toEqual(blue);
  expect(pixel(content, 50, 50)).toEqual(center);
  expect(renderDisplayListToSvg(display(content))).toContain(`clip-rule="${rule === "W*" ? "evenodd" : "nonzero"}"`);
});

it("clips to cubic curves", () => {
  const content = `10 50 m 10 90 90 90 90 50 c 90 10 10 10 10 50 c W n ${bluePage}`;
  expect(pixel(content, 50, 50)).toEqual(blue);
  expect(pixel(content, 15, 85)).toEqual(white);
});

it("intersects paths and restores the prior clip at Q", () => {
  const content = `${triangle} q 30 0 60 100 re W n ${bluePage} Q 1 0 0 rg 10 10 10 10 re f`;
  expect(pixel(content, 40, 20)).toEqual(blue);
  expect(pixel(content, 40, 80)).toEqual(white);
  expect(pixel(content, 20, 30)).toEqual(white);
  expect(pixel(content, 15, 15)).toEqual([255, 0, 0]);
});

it("freezes the clipping path in page coordinates before later CTM changes", () => {
  const content = `1 0 0.5 1 0 0 cm 10 10 40 40 re W n 1 0 -0.5 1 0 0 cm ${bluePage}`;
  expect(pixel(content, 40, 30)).toEqual(blue);
  expect(pixel(content, 20, 40)).toEqual(white);
});

it("applies a pending clip after painting the current path", () => {
  const content = `0 0 1 RG 10 w 20 20 60 60 re W S 1 0 0 rg 0 0 100 100 re f`;
  expect(pixel(content, 17, 50)).toEqual(blue);
  expect(pixel(content, 50, 50)).toEqual([255, 0, 0]);
});

it("clips subsequent strokes and inline images", () => {
  const stroke = `${triangle} 0 0 1 RG 10 w 0 80 m 100 80 l S`;
  expect(pixel(stroke, 80, 80)).toEqual(white);
  const image = `${triangle} q 100 0 0 100 0 0 cm BI /W 1 /H 1 /BPC 8 /CS /RGB /F /AHx ID 0000FF> EI Q`;
  expect(pixel(image, 20, 20)).toEqual(blue);
  expect(pixel(image, 80, 80)).toEqual(white);
});

it("intersects text and ordinary clips", () => {
  const content = `BT /FONT 80 Tf 7 Tr 10 10 Td (H) Tj ET ${triangle} ${bluePage}`;
  expect(pixel(content, 18, 30)).toEqual(blue);
  expect(pixel(content, 58, 60)).toEqual(white);
});

it("retains an empty clipping path", () => {
  expect(pixel(`W n ${bluePage}`, 50, 50)).toEqual(white);
});

it("preserves the curved signature outline and hole in PDF.js issue17069", () => {
  const doc = PdfDocument.load(readFileSync(new URL("../fixtures/pdfjs-issue17069.pdf", import.meta.url)));
  const list = doc.getPage(0).evaluateDisplayList();
  const scale = 150 / Math.max(list.width, list.height);
  const bitmap = renderDisplayListToBitmap(list, { scale });
  const at = (x: number, y: number) => [...bitmap.data.slice((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 3)];
  expect(at(14, 33)).toEqual(white);
  expect(at(17, 36)).toEqual(white);
  expect(at(20, 36)[0]).toBeLessThan(240);
  expect(PdfDocument.load(doc.save()).getPage(0).renderToBitmap({ scale })).toEqual(bitmap);
});

// Ported normal-rendering assertions from PDF.js test/unit/api_spec.js,
// "should render with operationsFilter" (Apache-2.0), unchanged fixture.
it("matches PDF.js clippath's exact black and white pixel counts", () => {
  const doc = PdfDocument.load(readFileSync(new URL("../fixtures/pdfjs-clippath.pdf", import.meta.url)));
  const bitmap = doc.getPage(0).renderToBitmap({ scale: 1 });
  const counts = { black: 0, white: 0, other: 0 };
  for (let i = 0; i < bitmap.data.length; i += 4) {
    const rgb = [...bitmap.data.slice(i, i + 3)];
    if (rgb.every(c => c === 0)) counts.black++;
    else if (rgb.every(c => c === 255)) counts.white++;
    else counts.other++;
  }
  expect(counts).toEqual({ black: 7200, white: 12800, other: 0 });
});
