import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosBool, cosDict, cosName, cosNumber, cosStream, dictSet, type PdfEvaluatedImage } from "../ast.js";
import { PdfDocument } from "../document.js";
import { renderDisplayListToBitmap } from "./raster.js";

function stripes(width: number, height: number, transparent = false): PdfEvaluatedImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(transparent ? (x % 2 ? [0, 0, 255, 0] : [255, 0, 0, 255]) : [x % 2 * 255, x % 2 * 255, x % 2 * 255, 255], (y * width + x) * 4);
    }
  }
  return { name: "I", width, height, decodedRgba: data, matrix: [4, 0, 0, 4, 0, 0], colorSpace: "DeviceRGB", bitsPerComponent: 8 };
}

function render(image: PdfEvaluatedImage, width = 4, height = 4) {
  return renderDisplayListToBitmap({ pageIndex: 0, width, height, rotation: 0, images: [image], paths: [], glyphs: [], annotations: [] }, { scale: 1, transparent: true });
}

describe("image downsampling", () => {
  // PDF.js src/display/canvas.js: CanvasGraphics._scaleImage limits each
  // reduction to a factor of two, then uses a smoothed canvas draw.
  it.each([8, 64])("retains alternating lines when reducing a %i-pixel image", width => {
    const bitmap = render(stripes(width, 8));
    for (let i = 0; i < bitmap.data.length; i += 4) {
      expect(Array.from(bitmap.data.subarray(i, i + 4))).toEqual([128, 128, 128, 255]);
    }
  });

  it("smooths fractional reductions at source pixel centers", () => {
    const bitmap = render({ ...stripes(4, 1), matrix: [3, 0, 0, 1, 0, 0] }, 3, 1);
    // Independent Canvas drawImage result; float precision can round a half
    // channel value either way when mapping through the inverse PDF matrix.
    const expected = [43, 43, 43, 255, 128, 128, 128, 255, 213, 213, 213, 255];
    expected.forEach((value, i) => expect(Math.abs(bitmap.data[i]! - value)).toBeLessThanOrEqual(1));
  });

  it.each([
    [4, 0, 0, 4, 0, 0],
    [0, 4, -4, 0, 4, 0],
    [-4, 0, 0, 4, 4, 0],
  ] as const)("filters alpha without bleeding hidden color through transform %j", (...matrix) => {
    const bitmap = render({ ...stripes(64, 8, true), matrix });
    for (let i = 0; i < bitmap.data.length; i += 4) {
      expect(Array.from(bitmap.data.subarray(i, i + 4))).toEqual([255, 0, 0, 128]);
    }
  });

  it("preserves nearest-neighbor upscaling and original decoded pixels", () => {
    const image = stripes(2, 2);
    const original = image.decodedRgba!.slice();
    const bitmap = render(image);
    expect(Array.from(bitmap.data.subarray(0, 16))).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
    render({ ...image, matrix: [1, 0, 0, 1, 0, 0] }, 1, 1);
    expect(image.decodedRgba).toEqual(original);
  });

  it("matches independent staged Canvas reduction for odd-sized RGBA images", () => {
    const image = stripes(13, 9);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 13; x++) image.decodedRgba!.set([x % 2 * 255, y % 2 * 255, 80, (x + y) % 2 ? 128 : 255], (y * 13 + x) * 4);
    }
    // PDF.js _scaleImage dimensions: 13x9 -> 7x5 -> 4x3; final draw 3x2.
    // Oracle: @napi-rs/canvas, the same Canvas implementation used by PDF.js.
    const expected = [67, 54, 81, 202, 25, 42, 80, 216, 67, 54, 81, 202,
      67, 54, 81, 202, 25, 42, 80, 216, 67, 54, 81, 202];
    const bitmap = render({ ...image, matrix: [3, 0, 0, 2, 0, 0] }, 3, 2);
    expected.forEach((value, i) => expect(Math.abs(bitmap.data[i]! - value)).toBeLessThanOrEqual(2));
  });

  it("preserves fine mask coverage in the original PDF.js issue13372 equality fixture", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue13372.pdf", import.meta.url))));
    const bitmap = doc.getPage(0).renderToBitmap({ scale: 150 / 842 });
    // Nine evenly spaced interior samples from PDF.js 6.3.289 at 150px.
    // Before smoothing, the mean channel error at these points was 30.33/255.
    const expected = [[255, 215, 156], [255, 191, 206], [255, 135, 234],
      [210, 255, 135], [255, 254, 198], [255, 228, 188],
      [43, 255, 212], [209, 255, 218], [213, 255, 143]];
    let error = 0, index = 0;
    for (const y of [30, 75, 120]) {
      for (const x of [20, 50, 80]) {
        const offset = (y * bitmap.width + x) * 4;
        expected[index++]!.forEach((value, channel) => { error += Math.abs(bitmap.data[offset + channel]! - value); });
      }
    }
    expect(error / 27).toBeLessThan(4);
  });

  it.each([false, true])("smooths a PDF stencil with Interpolate=%s, including save/reopen", interpolate => {
    const doc = PdfDocument.create();
    const page = doc.addPage([4, 4]);
    const mask = cosStream(new Uint8Array(8).fill(0x55), { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(8), Height: cosNumber(8),
      ImageMask: cosBool(true), BitsPerComponent: cosNumber(1), Interpolate: cosBool(interpolate),
    }) });
    dictSet(page.pageDict, "Resources", cosDict({ XObject: cosDict({ M: doc.cos.allocateObject(mask) }) }));
    page.setRawContentStream(new TextEncoder().encode("1 0 0 rg 4 0 0 4 0 0 cm /M Do"));
    for (const source of [doc, PdfDocument.load(doc.save())]) {
      const bitmap = source.getPage(0).renderToBitmap({ scale: 1, transparent: true });
      expect(Array.from(bitmap.data.subarray(0, 4))).toEqual([255, 0, 0, 128]);
    }
  });
});
