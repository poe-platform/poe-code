import { expect, it } from "vitest";
import {
  PdfDocument, cosArray, cosBool, cosDict, cosName, cosNumber, cosStream, dictSet,
  renderDisplayListToBitmap, renderDisplayListToSvg,
} from "../index.js";

const orders = ["IPT", "ITP", "PIT", "PTI", "TIP", "TPI"];

it.each(orders)("paints images, paths, and text in stream order: %s", order => {
  const doc = PdfDocument.create();
  const page = doc.addPage([40, 40]);
  const red = doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0]));
  for (const kind of order) {
    if (kind === "I") page.drawImage(red, { x: 0, y: 0, width: 40, height: 40 });
    if (kind === "P") page.drawRect({ x: 0, y: 0, width: 40, height: 40, fill: { r: 0, g: 0, b: 0 } });
    if (kind === "T") page.drawText("H", { x: 10, y: 10, size: 20, color: { r: 0, g: 1, b: 0 } });
  }
  const display = PdfDocument.load(doc.save()).getPage(0).evaluateDisplayList();
  const bitmap = renderDisplayListToBitmap(display);
  const pixels = Array.from({ length: 1600 }, (_, i) => [...bitmap.data.slice(i * 4, i * 4 + 3)]);
  if (order.endsWith("P")) expect(pixels.every(pixel => pixel.every(n => n === 0))).toBe(true);
  else if (order.endsWith("I")) expect(pixels.every(pixel => pixel[0] === 255 && pixel[1] === 0 && pixel[2] === 0)).toBe(true);
  else expect(pixels.some(pixel => pixel[1]! > 128 && pixel[0]! < 128)).toBe(true);
  const svg = renderDisplayListToSvg(display);
  const positions: Record<string, number> = { I: svg.indexOf("<image "), P: svg.indexOf("<path "), T: svg.indexOf("<text ") };
  expect([...order].map(kind => positions[kind])).toEqual(Object.values(positions).sort((a, b) => a - b));
});

it.each(["shading", "inline image", "type3", "annotation"])("preserves %s painting order", kind => {
  const doc = PdfDocument.create();
  const page = doc.addPage([40, 40]);
  const resources = page.getResourcesDict();
  const nums = (...values: number[]) => cosArray(values.map(n => cosNumber(n)));
  if (kind === "shading") {
    dictSet(resources, "Shading", cosDict({ Red: cosDict({
      ShadingType: cosNumber(2), ColorSpace: cosName("DeviceRGB"),
      Coords: nums(0, 0, 40, 0), Extend: cosArray([cosBool(true), cosBool(true)]),
      Function: cosDict({ FunctionType: cosNumber(2), Domain: nums(0, 1), C0: nums(1, 0, 0), C1: nums(1, 0, 0), N: cosNumber(1) }),
    }) }));
    page.setRawContentStream("/Red sh 0 g 0 0 40 40 re f");
  } else if (kind === "inline image") {
    page.setRawContentStream("q 40 0 0 40 0 0 cm BI /W 1 /H 1 /BPC 8 /CS /RGB /F /AHx ID FF0000> EI Q 0 g 0 0 40 40 re f");
  } else if (kind === "type3") {
    dictSet(resources, "Font", cosDict({ Blocks: cosDict({
      Type: cosName("Font"), Subtype: cosName("Type3"), FontBBox: nums(0, 0, 100, 100),
      FontMatrix: nums(0.01, 0, 0, 0.01, 0, 0), FirstChar: cosNumber(65), LastChar: cosNumber(65), Widths: nums(100),
      Encoding: cosDict({ Differences: cosArray([cosNumber(65), cosName("A")]) }),
      CharProcs: cosDict({ A: doc.cos.allocateObject(cosStream(new TextEncoder().encode("100 0 d0 0 g 0 0 100 100 re f"))) }),
    }) }));
    page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 40, height: 40 });
    page.setRawContentStream(new TextDecoder().decode(page.getRawContentStream()) + " BT /Blocks 40 Tf (A) Tj ET");
  } else {
    page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 40, height: 40 });
    dictSet(page.pageDict, "Annots", cosArray([cosDict({
      Type: cosName("Annot"), Subtype: cosName("Stamp"), Rect: nums(0, 0, 40, 40),
      AP: cosDict({ N: doc.cos.allocateObject(cosStream(new TextEncoder().encode("0 g 0 0 40 40 re f"), { dict: cosDict({
        Type: cosName("XObject"), Subtype: cosName("Form"), BBox: nums(0, 0, 40, 40),
      }) })) }),
    })]));
  }
  const display = page.evaluateDisplayList();
  expect(display.images).toHaveLength(1);
  const bitmap = renderDisplayListToBitmap(display);
  expect([...bitmap.data.slice((20 * 40 + 20) * 4, (20 * 40 + 20) * 4 + 4)]).toEqual([0, 0, 0, 255]);
  const svg = renderDisplayListToSvg(display);
  expect(svg.indexOf("<path ")).toBeGreaterThan(svg.indexOf("<image "));
});

it("renders manually constructed display lists without ordered operations", () => {
  const doc = PdfDocument.create();
  const page = doc.addPage([10, 10]);
  page.drawRect({ x: 0, y: 0, width: 10, height: 10, fill: { r: 0, g: 0, b: 0 } });
  const { operations: ignoredOperations, ...legacy } = page.evaluateDisplayList();
  expect([...renderDisplayListToBitmap(legacy).data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
  expect(renderDisplayListToSvg(legacy)).toContain('<path ');
});

it.each(["form", "pattern"])("preserves interleaved paints inside a %s", kind => {
  const doc = PdfDocument.create();
  const page = doc.addPage([40, 40]);
  page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 40, height: 40 });
  page.drawRect({ x: 0, y: 0, width: 40, height: 40, fill: { r: 0, g: 0, b: 0 } });
  const resources = page.getResourcesDict();
  const stream = doc.cos.allocateObject(cosStream(page.getRawContentStream(), { dict: cosDict({
    Type: cosName(kind === "form" ? "XObject" : "Pattern"), Subtype: cosName("Form"),
    BBox: cosArray([0, 0, 40, 40].map(n => cosNumber(n))), Resources: cosDict({ ...Object.fromEntries(resources.entries.map(e => [e.key.decoded, e.value])) }),
    PatternType: cosNumber(1), PaintType: cosNumber(1), TilingType: cosNumber(1), XStep: cosNumber(40), YStep: cosNumber(40),
  }) }));
  dictSet(resources, kind === "form" ? "XObject" : "Pattern", cosDict({ Wrapper: stream }));
  page.setRawContentStream(kind === "form" ? "/Wrapper Do" : "/Pattern cs /Wrapper scn 0 0 40 40 re f");
  const bitmap = renderDisplayListToBitmap(page.evaluateDisplayList());
  expect([...bitmap.data.slice((20 * 40 + 20) * 4, (20 * 40 + 20) * 4 + 4)]).toEqual([0, 0, 0, 255]);
});

it("composites a translucent path over the preceding image", () => {
  const doc = PdfDocument.create();
  const page = doc.addPage([40, 40]);
  page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 40, height: 40 });
  dictSet(page.getResourcesDict(), "ExtGState", cosDict({ Half: cosDict({ ca: cosNumber(0.5) }) }));
  page.setRawContentStream(new TextDecoder().decode(page.getRawContentStream()) + " /Half gs 0 0 1 rg 0 0 40 40 re f");
  const bitmap = renderDisplayListToBitmap(page.evaluateDisplayList());
  expect([...bitmap.data.slice(0, 4)]).toEqual([128, 0, 128, 255]);
});
