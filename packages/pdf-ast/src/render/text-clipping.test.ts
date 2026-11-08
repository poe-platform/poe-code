import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument, type PdfPaintOperation, renderDisplayListToBitmap, renderDisplayListToSvg } from "../index.js";

function display(content: string) {
  const doc = PdfDocument.create();
  const page = doc.addPage([60, 40]);
  page.drawText("H", { x: 5, y: 5, size: 30 });
  const font = new TextDecoder().decode(page.getRawContentStream()).split("/")[1]!.split(" ")[0];
  page.setRawContentStream(content.replaceAll("FONT", font!));
  return page.evaluateDisplayList();
}

it.each([4, 5, 6, 7])("clips subsequent painting with text mode %i", mode => {
  const list = display(`BT /FONT 30 Tf ${mode} Tr 5 5 Td (H) Tj ET 0 0 1 rg 0 0 60 40 re f`);
  const bitmap = renderDisplayListToBitmap(list, { scale: 1 });
  expect([...bitmap.data.slice(0, 3)]).toEqual([255, 255, 255]);
  expect(Array.from({ length: 2400 }, (_, i) => bitmap.data[i * 4] === 0 && bitmap.data[i * 4 + 2] === 255).some(Boolean)).toBe(true);
  expect(renderDisplayListToSvg(list)).toContain("clipPath");
});

it("unions marked-content fragments until ET and restores the clip at Q", () => {
  const list = display("q BT /FONT 20 Tf 7 Tr 5 5 Td /Span BMC (H) Tj EMC 25 0 Td /Span BMC (H) Tj EMC ET 0 0 1 rg 0 0 60 40 re f Q 1 0 0 rg 0 35 60 5 re f");
  const bitmap = renderDisplayListToBitmap(list, { scale: 1 });
  const pixel = (x: number, y: number) => [...bitmap.data.slice((y * 60 + x) * 4, (y * 60 + x) * 4 + 3)];
  expect(pixel(0, 20)).toEqual([255, 255, 255]);
  expect(pixel(0, 0)).toEqual([255, 0, 0]);
  expect(pixel(7, 25)).toEqual([0, 0, 255]);
  expect(pixel(32, 25)).toEqual([0, 0, 255]);
});

it("clips inline images but leaves images before ET unclipped", () => {
  const image = "q 60 0 0 40 0 0 cm BI /W 1 /H 1 /BPC 8 /CS /RGB /F /AHx ID 0000FF> EI Q";
  const list = display(`BT /FONT 30 Tf 7 Tr 5 5 Td (H) Tj ET ${image}`);
  expect([...renderDisplayListToBitmap(list, { scale: 1 }).data.slice(0, 3)]).toEqual([255, 255, 255]);
  const before = display(`BT /FONT 30 Tf 7 Tr 5 5 Td (H) Tj ${image} ET`);
  expect([...renderDisplayListToBitmap(before, { scale: 1 }).data.slice(0, 3)]).toEqual([0, 0, 255]);
  expect(renderDisplayListToSvg(list)).toContain('clip-path="url(#text-clip-');
});

it("intersects successive text clipping objects", () => {
  const list = display("BT /FONT 20 Tf 7 Tr 5 5 Td (H) Tj ET BT /FONT 20 Tf 30 5 Td (H) Tj ET 0 0 1 rg 0 0 60 40 re f");
  const bitmap = renderDisplayListToBitmap(list, { scale: 1 });
  expect(Array.from(bitmap.data).every(value => value === 255)).toBe(true);
});

it("renders the upstream embedded CID CFF clipping fixture as blue glyphs", () => {
  const doc = PdfDocument.load(readFileSync(new URL("../fixtures/pdfjs-text_clip_cff_cid.pdf", import.meta.url)));
  const list = doc.getPage(0).evaluateDisplayList();
  const clipped = list.operations!.filter(op => op.value.clipPaths);
  expect(clipped.length).toBeGreaterThan(0);
  const bitmap = renderDisplayListToBitmap(list, { scale: 1 });
  const blue = Array.from({ length: bitmap.width * bitmap.height }, (_, i) => bitmap.data[i * 4]! < 30 && bitmap.data[i * 4 + 2]! > 200).filter(Boolean).length;
  const unclipped = renderDisplayListToBitmap({ ...list, operations: list.operations!.map(op => ({ ...op, value: { ...op.value, clipPaths: undefined } } as PdfPaintOperation)) }, { scale: 1 });
  const solidBlue = Array.from({ length: unclipped.width * unclipped.height }, (_, i) => unclipped.data[i * 4]! < 30 && unclipped.data[i * 4 + 2]! > 200).filter(Boolean).length;
  expect(blue).toBeGreaterThan(100);
  expect(blue).toBeLessThan(solidBlue / 2);
  expect(renderDisplayListToSvg(list)).toContain("clipPath");
});

it.each([4, 5, 6, 7])("preserves text painting for mode %i before later paints", mode => {
  const list = display(`BT /FONT 30 Tf ${mode} Tr 5 5 Td (H) Tj ET`);
  const bitmap = renderDisplayListToBitmap(list, { scale: 1 });
  const painted = Array.from({ length: 2400 }, (_, i) => bitmap.data[i * 4]! < 128).filter(Boolean).length;
  if (mode === 7) expect(painted).toBe(0);
  else expect(painted).toBeGreaterThan(20);
});

it("clips subsequent outlined text", () => {
  const list = display("BT /FONT 20 Tf 7 Tr 5 5 Td (H) Tj ET BT 0 Tr 30 5 Td (H) Tj ET");
  expect(Array.from(renderDisplayListToBitmap(list, { scale: 1 }).data).every(value => value === 255)).toBe(true);
});

it("keeps ET after marked content when serializing a parsed stream", async () => {
  const { parseContentStream } = await import("../content/parser.js");
  const { serializeContentNodesToLines } = await import("../content/serializer.js");
  const nodes = parseContentStream(new TextEncoder().encode("BT /F1 20 Tf 7 Tr /Span BMC (H) Tj EMC ET 0 0 1 rg"));
  const serialized = serializeContentNodesToLines(nodes).join("\n");
  expect(serialized.indexOf("ET")).toBeGreaterThan(serialized.indexOf("EMC"));
  expect(serialized.indexOf("ET")).toBeLessThan(serialized.indexOf("rg"));
});
