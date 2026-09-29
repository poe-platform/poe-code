import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, decodeJpegToRgba, decodeXObjectImageToRgba, extractDocumentImages } from "../index.js";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
function meanError(actual: Uint8Array, expected: Uint8Array): number {
  expect(actual.length).toBe(expected.length);
  return actual.reduce((sum, value, i) => sum + Math.abs(value - expected[i]!), 0) / actual.length;
}

it.each(["RGB-0-0-17", "RGB-1-0-17", "L-0-0-17", "L-1-0-17", "CMYK-0-0-17", "CMYK-1-0-17", "rgb-direct"])("decodes independent JPEG %s", name => {
  const decoded = decodeJpegToRgba(fixture(`jpeg-${name}.jpg`));
  expect([decoded.width, decoded.height]).toEqual([17, 13]);
  // Different CMYK profiles are allowed; JPEG sample decoding should be close.
  expect(meanError(decoded.data, fixture(`jpeg-${name}.rgba`))).toBeLessThan(name.startsWith("CMYK") ? 15 : 0.5);
});

// Ported PDF.js api_spec.js issue 4888: cmykjpeg.pdf has 90,000 RGB samples.
it("decodes the PDF.js CMYK JPEG regression with independent reference colors", () => {
  const doc = PdfDocument.load(fixture("pdfjs-cmykjpeg.pdf"));
  const image = extractDocumentImages(doc.cos)[0]!;
  const rgb = image.bitmap.data.filter((_, i) => i % 4 < 3);
  expect(rgb).toHaveLength(90000);
  expect(meanError(rgb, fixture("pdfjs-cmykjpeg.rgb"))).toBeLessThan(8);
});

it("honors a PDF grayscale Decode inversion", () => {
  const doc = PdfDocument.create();
  const jpeg = fixture("jpeg-L-0-0-17.jpg");
  const stream = cosStream(jpeg, { dict: cosDict({ Width: cosNumber(17), Height: cosNumber(13), ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(8), Filter: cosName("DCTDecode"), Decode: cosArray([cosNumber(1), cosNumber(0)]) }) });
  const image = decodeXObjectImageToRgba(doc.cos, stream, undefined);
  const expected = fixture("jpeg-L-0-0-17.rgba").map((value, i) => i % 4 === 3 ? value : 255 - value);
  expect(meanError(image.rgba, expected)).toBeLessThan(0.5);
});

it.each([new Uint8Array(), Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)])("rejects JPEGs with no image data", bytes => {
  expect(() => decodeJpegToRgba(bytes)).toThrow();
});

it("honors ColorTransform 0 in the matching DCT filter parameter slot", () => {
  const bytes = fixture("jpeg-RGB-0-0-17.jpg");
  const asciiHex = new TextEncoder().encode([...bytes].map(b => b.toString(16).padStart(2, "0")).join("") + ">");
  const stream = cosStream(asciiHex, { dict: cosDict({
    Width: cosNumber(17), Height: cosNumber(13), BitsPerComponent: cosNumber(8), ColorSpace: cosName("DeviceRGB"),
    Filter: cosArray([cosName("ASCIIHexDecode"), cosName("DCTDecode")]),
    DecodeParms: cosArray([cosDict({ ColorTransform: cosNumber(1) }), cosDict({ ColorTransform: cosNumber(0) })]),
  }) });
  const image = decodeXObjectImageToRgba(PdfDocument.create().cos, stream, undefined);
  expect(meanError(image.rgba, fixture("jpeg-ycbcr-direct.rgba"))).toBeLessThan(0.5);
});

// JPEG headers adapted from PDF.js jpeg_stream_spec.js: all three supported SOFs.
it.each([0xc0, 0xc1, 0xc2])("checks JPEG SOF %i dimensions before allocating components", marker => {
  const bytes = Uint8Array.of(0xff, 0xd8, 0xff, marker, 0, 11, 8, 0x0f, 0xa0, 0x9c, 0x40, 1, 1, 0x11, 0, 0xff, 0xd9);
  expect(() => decodeJpegToRgba(bytes, 1, 1, 1024)).toThrow(/budget/);
});

it("applies all four PDF CMYK Decode pairs before RGB conversion", () => {
  const stream = cosStream(fixture("jpeg-CMYK-1-0-17.jpg"), { dict: cosDict({
    Width: cosNumber(17), Height: cosNumber(13), BitsPerComponent: cosNumber(8), ColorSpace: cosName("DeviceCMYK"),
    Filter: cosName("DCTDecode"), Decode: cosArray([1, 0, 1, 0, 1, 0, 1, 0].map(n => cosNumber(n))),
  }) });
  const image = decodeXObjectImageToRgba(PdfDocument.create().cos, stream, undefined);
  expect(meanError(image.rgba, fixture("jpeg-CMYK-1-0-17.rgba"))).toBeLessThan(15);
});
