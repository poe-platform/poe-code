import { expect, it, vi } from "vitest";
import { PdfDocument, decodePng, renderDisplayListToSvg } from "../index.js";

it("embeds lossless PNG image bytes in SVG without a global Buffer", () => {
  let svg: string;
  try {
    vi.stubGlobal("Buffer", undefined);
    const doc = PdfDocument.create();
    const page = doc.addPage([2, 1]);
    const image = doc.embedRgbImage(2, 1, Uint8Array.of(0, 128, 255, 255, 1, 127));
    page.drawImage(image, { x: 0, y: 0, width: 2, height: 1 });
    const loaded = PdfDocument.load(doc.save());
    svg = renderDisplayListToSvg(loaded.getPage(0).evaluateDisplayList());
    expect(globalThis.Buffer).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
  const prefix = 'href="data:image/png;base64,';
  expect(svg).toContain(prefix);
  const encoded = svg.split(prefix)[1]!.split('"')[0]!;
  const png = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  const bitmap = decodePng(png);
  expect([bitmap.width, bitmap.height]).toEqual([2, 1]);
  expect([...bitmap.data]).toEqual([0, 128, 255, 255, 255, 1, 127, 255]);
});
