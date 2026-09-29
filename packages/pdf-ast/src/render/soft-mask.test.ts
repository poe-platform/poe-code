import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosBool, cosDict, cosName, cosNumber, cosStream, dictGet, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { decodePng, renderDisplayListToSvg, type RgbaBitmap } from "./raster.js";

const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));

function maskedPdf(options: { subtype?: string; content?: string; backdrop?: number[]; transfer?: boolean; alpha?: number; matrix?: number[]; bbox?: number[]; paint?: string } = {}) {
  const doc = PdfDocument.create();
  const page = doc.addPage([80, 80]);
  const form = cosStream(new TextEncoder().encode(options.content ?? "0.5 g 0 0 40 40 re f"), { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers(options.bbox ?? [0, 0, 40, 40]),
    ...(options.matrix ? { Matrix: numbers(options.matrix) } : {}),
    Group: cosDict({ S: cosName("Transparency"), CS: cosName("DeviceRGB"), I: cosBool(true) }),
    Resources: cosDict({ ExtGState: cosDict({ A: cosDict({ ca: cosNumber(0.5) }) }) }),
  }) });
  const mask = cosDict({ S: cosName(options.subtype ?? "Luminosity"), G: doc.cos.allocateObject(form),
    ...(options.backdrop ? { BC: numbers(options.backdrop) } : {}),
    ...(options.transfer ? { TR: cosDict({ FunctionType: cosNumber(2), Domain: numbers([0, 1]), C0: numbers([1]), C1: numbers([0]), N: cosNumber(1) }) } : {}),
  });
  dictSet(page.pageDict, "Resources", cosDict({ ExtGState: cosDict({
    M: cosDict({ SMask: doc.cos.allocateObject(mask), ca: cosNumber(options.alpha ?? 1) }),
    None: cosDict({ SMask: cosName("None") }),
  }) }));
  page.setRawContentStream(new TextEncoder().encode(options.paint ?? "/M gs 1 0 0 rg 0 0 80 80 re f"));
  return doc;
}

function pixel(bitmap: RgbaBitmap, x: number, y: number) {
  const offset = ((bitmap.height - 1 - y) * bitmap.width + x) * 4;
  return Array.from(bitmap.data.subarray(offset, offset + 4));
}

describe("ExtGState soft masks", () => {
  it("uses luminosity for opacity and clips the mask group to its BBox", () => {
    const bitmap = maskedPdf({ content: "0.5 g 0 0 80 80 re f" }).getPage(0).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([255, 127, 127, 255]);
    expect(pixel(bitmap, 60, 20)).toEqual([255, 255, 255, 255]);
  });

  it("uses opacity for Alpha masks, independently of their color and backdrop", () => {
    const bitmap = maskedPdf({ subtype: "Alpha", content: "/A gs 0 g 0 0 40 40 re f", backdrop: [1, 1, 1] }).getPage(0).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([255, 127, 127, 255]);
    expect(pixel(bitmap, 60, 20)).toEqual([255, 255, 255, 255]);
  });

  it("uses PDF luminosity coefficients, including mask alpha over the backdrop", () => {
    const bitmap = maskedPdf({ content: "/A gs 1 0 0 rg 0 0 40 40 re f", backdrop: [1, 1, 1] }).getPage(0).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([255, 90, 90, 255]);
    expect(pixel(bitmap, 60, 20)).toEqual([255, 0, 0, 255]);
  });

  it("applies a transfer function inside and outside the mask group", () => {
    const bitmap = maskedPdf({ transfer: true, content: "1 g 0 0 40 40 re f" }).getPage(0).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([255, 255, 255, 255]);
    expect(pixel(bitmap, 60, 20)).toEqual([255, 0, 0, 255]);
  });

  it("resets mask-group alpha constants and then applies the paint alpha once", () => {
    const bitmap = maskedPdf({ alpha: 0.5 }).getPage(0).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([255, 191, 191, 255]);
  });

  it("keeps the mask transform from gs when subsequent painting changes the CTM", () => {
    const bitmap = maskedPdf({ matrix: [1, 0, 0, 1, 10, 0], paint: "/M gs 1 0 0 1 20 0 cm 1 0 0 rg 0 0 80 80 re f" }).getPage(0).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 30, 20)).toEqual([255, 127, 127, 255]);
    expect(pixel(bitmap, 60, 20)).toEqual([255, 255, 255, 255]);
  });

  it("restores a saved mask after SMask None without accumulating masks", () => {
    const bitmap = maskedPdf({ paint: "/M gs q /None gs 0 0 1 rg 60 0 20 20 re f Q 1 0 0 rg 0 0 80 80 re f" }).getPage(0).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([255, 127, 127, 255]);
    expect(pixel(bitmap, 70, 10)).toEqual([0, 0, 255, 255]);
  });

  it("applies the mask to each paint in content order", () => {
    const bitmap = maskedPdf({ paint: "/M gs 1 0 0 rg 0 0 30 40 re f 10 0 30 40 re f" }).getPage(0).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 5, 20)).toEqual([255, 127, 127, 255]);
    expect(pixel(bitmap, 20, 20)).toEqual([255, 63, 63, 255]);
  });

  it("clips rotated mask groups to their actual BBox shape", () => {
    const bitmap = maskedPdf({ matrix: [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 40, 0], content: "1 g 0 0 80 80 re f" }).getPage(0).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 40, 25)).toEqual([255, 0, 0, 255]);
    expect(pixel(bitmap, 15, 40)).toEqual([255, 255, 255, 255]);
  });

  it("keeps an empty mask BBox transparent", () => {
    const bitmap = maskedPdf({ bbox: [0, 0, 0, 0], content: "1 g 0 0 80 80 re f" }).getPage(0).renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([255, 255, 255, 255]);
  });

  it("bounds recursive soft-mask forms", () => {
    const doc = maskedPdf();
    const resources = doc.cos.resolveDict(dictGet(doc.getPage(0).pageDict, "Resources"))!;
    const states = doc.cos.resolveDict(dictGet(resources, "ExtGState"))!;
    const state = doc.cos.resolveDict(dictGet(states, "M"))!;
    const mask = doc.cos.resolveDict(dictGet(state, "SMask"))!;
    const form = cosStream(new TextEncoder().encode("/M gs 1 g 0 0 40 40 re f"), { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([0, 0, 40, 40]), Resources: resources,
      Group: cosDict({ S: cosName("Transparency"), CS: cosName("DeviceGray") }),
    }) });
    dictSet(mask, "G", doc.cos.allocateObject(form));
    expect(() => doc.getPage(0).evaluateDisplayList()).toThrow(expect.objectContaining({ code: "E_LIMIT" }));
  });

  it("restores the original signature's luminosity in PDF.js issue17069", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue17069.pdf", import.meta.url))));
    const bitmap = doc.getPage(0).renderToBitmap({ scale: 150 / 792 });
    // Independent PDF.js and Poppler reference, sampled inside the ring.
    const offset = (36 * bitmap.width + 20) * 4;
    expect(bitmap.data[offset]).toBeGreaterThan(140);
    expect(bitmap.data[offset + 1]).toBeGreaterThan(190);
    expect(bitmap.data[offset + 2]).toBeGreaterThan(200);
    expect(bitmap.data[offset]).toBeLessThan(210);
  });

  it("composites isolated Form opacity once, after its overlapping paints", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([80, 80]);
    const form = cosStream(new TextEncoder().encode("/Full gs 1 0 0 rg 0 0 30 40 re f 10 0 30 40 re f"), { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([0, 0, 40, 40]),
      Group: cosDict({ S: cosName("Transparency"), I: cosBool(true) }),
      Resources: cosDict({ ExtGState: cosDict({ Full: cosDict({ ca: cosNumber(1) }) }) }),
    }) });
    dictSet(page.pageDict, "Resources", cosDict({
      XObject: cosDict({ G: doc.cos.allocateObject(form) }), ExtGState: cosDict({ Half: cosDict({ ca: cosNumber(0.5) }) }),
    }));
    page.setRawContentStream(new TextEncoder().encode("/Half gs /G Do"));
    const bitmap = page.renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 5, 20)).toEqual([255, 127, 127, 255]);
    expect(pixel(bitmap, 20, 20)).toEqual([255, 127, 127, 255]);
    const svg = renderDisplayListToSvg(page.evaluateDisplayList());
    expect(svg).toContain('opacity="0.5"');
  });

  it("combines a group's opacity, soft mask and blend mode after painting", () => {
    const doc = maskedPdf({ alpha: 0.5 });
    const page = doc.getPage(0);
    const resources = doc.cos.resolveDict(dictGet(page.pageDict, "Resources"))!;
    const states = doc.cos.resolveDict(dictGet(resources, "ExtGState"))!;
    dictSet(doc.cos.resolveDict(dictGet(states, "M"))!, "BM", cosName("Multiply"));
    const group = cosStream(new TextEncoder().encode("1 0 0 rg 0 0 30 40 re f 10 0 30 40 re f"), { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([0, 0, 40, 40]),
      Group: cosDict({ S: cosName("Transparency"), I: cosBool(true) }), Resources: cosDict({}),
    }) });
    dictSet(resources, "XObject", cosDict({ G: doc.cos.allocateObject(group) }));
    page.setRawContentStream(new TextEncoder().encode("0 0 1 rg 0 0 80 80 re f /M gs /G Do"));
    const bitmap = page.renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 5, 20)).toEqual([0, 0, 191, 255]);
    expect(pixel(bitmap, 20, 20)).toEqual([0, 0, 191, 255]);
    expect(pixel(bitmap, 60, 20)).toEqual([0, 0, 255, 255]);
  });

  it("retains group text for extraction and excludes text used only in a mask", () => {
    const doc = maskedPdf({ content: "1 g BT /F 12 Tf 5 15 Td (MASK) Tj ET" });
    const page = doc.getPage(0);
    const resources = doc.cos.resolveDict(dictGet(page.pageDict, "Resources"))!;
    const states = doc.cos.resolveDict(dictGet(resources, "ExtGState"))!;
    const mask = doc.cos.resolveDict(dictGet(doc.cos.resolveDict(dictGet(states, "M"))!, "SMask"))!;
    const maskForm = doc.cos.resolve(dictGet(mask, "G"))!;
    if (maskForm.kind !== "stream") throw new Error("Expected mask form");
    const font = cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") });
    const fontResources = cosDict({ Font: cosDict({ F: doc.cos.allocateObject(font) }) });
    dictSet(maskForm.dict, "Resources", fontResources);
    const group = cosStream(new TextEncoder().encode("1 0 0 rg BT /F 12 Tf 5 15 Td (TEXT) Tj ET"), { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([0, 0, 40, 40]),
      Group: cosDict({ S: cosName("Transparency"), I: cosBool(true) }), Resources: fontResources,
    }) });
    dictSet(resources, "XObject", cosDict({ G: doc.cos.allocateObject(group) }));
    page.setRawContentStream(new TextEncoder().encode("/M gs /G Do"));
    expect(page.extractText()).toBe("TEXT");
    const list = page.evaluateDisplayList();
    expect(list.glyphs.map(g => g.unicode).join("")).toBe("TEXT");
    const bitmap = page.renderToBitmap({ scale: 1, transparent: true });
    expect(bitmap.data.some((value, i) => i % 4 === 3 && value > 0)).toBe(true);
  });

  it("applies an ExtGState mask to an ordinary image", () => {
    const doc = maskedPdf();
    const page = doc.getPage(0);
    const resources = doc.cos.resolveDict(dictGet(page.pageDict, "Resources"))!;
    const image = cosStream(new Uint8Array([0, 0, 255]), { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(1), Height: cosNumber(1),
      ColorSpace: cosName("DeviceRGB"), BitsPerComponent: cosNumber(8),
    }) });
    dictSet(resources, "XObject", cosDict({ I: doc.cos.allocateObject(image) }));
    page.setRawContentStream(new TextEncoder().encode("/M gs 80 0 0 80 0 0 cm /I Do"));
    const bitmap = page.renderToBitmap({ scale: 1 });
    expect(pixel(bitmap, 20, 20)).toEqual([127, 127, 255, 255]);
    expect(pixel(bitmap, 60, 20)).toEqual([255, 255, 255, 255]);
  });

  it("evaluates nested mask groups without leaking their paints into the page", () => {
    const doc = maskedPdf();
    const page = doc.getPage(0);
    const resources = doc.cos.resolveDict(dictGet(page.pageDict, "Resources"))!;
    const states = doc.cos.resolveDict(dictGet(resources, "ExtGState"))!;
    const mask = doc.cos.resolveDict(dictGet(doc.cos.resolveDict(dictGet(states, "M"))!, "SMask"))!;
    const innerForm = dictGet(mask, "G")!;
    const outerForm = cosStream(new TextEncoder().encode("/Inner gs 1 g 0 0 40 40 re f"), { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([0, 0, 40, 40]),
      Group: cosDict({ S: cosName("Transparency"), I: cosBool(true) }),
      Resources: cosDict({ ExtGState: cosDict({ Inner: cosDict({ SMask: cosDict({ S: cosName("Luminosity"), G: innerForm }) }) }) }),
    }) });
    dictSet(mask, "G", doc.cos.allocateObject(outerForm));
    const bitmap = page.renderToBitmap({ scale: 1, transparent: true });
    expect(pixel(bitmap, 20, 20)).toEqual([255, 0, 0, 128]);
    expect(pixel(bitmap, 60, 20)).toEqual([0, 0, 0, 0]);
    expect(page.evaluateDisplayList().paths).toHaveLength(1);
  });

  it.each([
    ["smask_alpha_bc", 20, 20, [242, 242, 242, 255]],
    ["smask_alpha_oob", 100, 100, [153, 204, 242, 255]],
    ["smask_alpha_oob_transfer", 300, 300, [153, 204, 242, 255]],
    ["smask_luminosity_oob_transfer", 250, 200, [223, 99, 80, 255]],
  ] as const)("ports the unchanged PDF.js %s equality fixture", (name, x, y, expected) => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL(`../fixtures/pdfjs-${name}.pdf`, import.meta.url))));
    const bitmap = doc.getPage(0).renderToBitmap({ scale: 0.25 });
    const actual = pixel(bitmap, Math.floor(x / 4), Math.floor(y / 4));
    expected.forEach((value, i) => expect(Math.abs(actual[i]! - value)).toBeLessThanOrEqual(1));
  });

  it("preserves the mask through save/reopen and SVG export", () => {
    const doc = maskedPdf();
    const reopened = PdfDocument.load(doc.save());
    expect(reopened.getPage(0).renderToBitmap({ scale: 1 }).data).toEqual(doc.getPage(0).renderToBitmap({ scale: 1 }).data);
    const svg = renderDisplayListToSvg(reopened.getPage(0).evaluateDisplayList(), { scale: 1 });
    expect(svg).toContain("<mask");
    const match = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(svg);
    expect(match).not.toBeNull();
    const mask = decodePng(new Uint8Array(Buffer.from(match![1]!, "base64")));
    expect(pixel(mask, 20, 20)[3]).toBe(128);
    expect(pixel(mask, 60, 20)[3]).toBe(0);
  });
});
