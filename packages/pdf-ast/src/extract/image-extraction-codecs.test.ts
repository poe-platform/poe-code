import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, dictSet,
  extractDocumentImages, decodeInlineImageNodeToRgba,
} from "../index.js";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// Same PDF.js regression documents and independent reference pixels as pdfjs-codecs.test.ts.
it.each([
  ["pdfjs-jbig2-symbol-offset.pdf", "ea0b15437343b56b23a6e0c2674c919058b7ca95a295c9a712caffff44bc9cf8"],
  ["pdfjs-jp2-resetprob.pdf", "656979fe916cbf4ef6bcee5bfaa6afa0ab7c09c1556c0c73eb45584e75ea2caf"],
])("extracts correct reference pixels from %s", (file, hash) => {
  const image = extractDocumentImages(PdfDocument.load(fixture(file)).cos)[0]!;
  expect(digest(image.bitmap.data)).toBe(hash);
  expect(image.rawEncodedBytes?.length).toBeGreaterThan(0);
});

it("infers extraction dimensions, color space, and resolution from a JPX codestream", () => {
  const doc = PdfDocument.create();
  const page = doc.addPage([8, 6]);
  const raw = fixture("gray-lossless.jp2");
  const ref = doc.cos.allocateObject(cosStream(raw, { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Image"), Filter: cosName("JPXDecode"),
  }) }));
  const name = page.ensureXObjectResource(ref);
  page.setRawContentStream(`8 0 0 6 0 0 cm /${name} Do`);
  const image = extractDocumentImages(doc.cos)[0]!;
  expect(image).toMatchObject({ width: 8, height: 6, colorSpace: "gray", colorSpaceLabel: "gray", components: 1, bitsPerComponent: 8, xPpi: 72, yPpi: 72 });
  expect(digest(image.bitmap.data)).toBe("e683562d04502a4e06ba8d48dbbf86df106e31bc53fa31f079d8e2e71cd63206");
  expect(image.rawEncodedBytes).toEqual(raw);
});

it("retains the matching JBIG2 globals from a wrapped filter's parameter slot", () => {
  const doc = PdfDocument.create();
  const page = doc.addPage([64, 32]);
  const globals = fixture("jbig2-symbols.sym");
  const encoded = fixture("jbig2-symbols.0000");
  const ref = doc.cos.allocateObject(cosStream(new TextEncoder().encode(encoded.toString("hex") + ">"), { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(64), Height: cosNumber(32),
    ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(1),
    Filter: cosArray([cosName("ASCIIHexDecode"), cosName("JBIG2Decode")]),
    DecodeParms: cosArray([cosDict({}), cosDict({ JBIG2Globals: doc.cos.allocateObject(cosStream(globals)) })]),
  }) }));
  const name = page.ensureXObjectResource(ref); page.setRawContentStream(`/${name} Do`);
  const image = extractDocumentImages(doc.cos)[0]!;
  expect(image.jbig2GlobalsBytes).toEqual(globals);
  expect(Array.from(image.rawEncodedBytes!)).toEqual([...encoded]);
  expect(digest(image.bitmap.data)).toBe("2f6fdd7e5b7bf087b4c8511e64986052aa0cbd4f267346c39906e27bc99d21ce");
});

it.each(["JPXDecode", "JBIG2Decode"])("decodes %s inline images through rendering and extraction", filter => {
  const doc = PdfDocument.create(); const page = doc.addPage([64, 32]);
  const isJpx = filter === "JPXDecode";
  const bytes = fixture(isJpx ? "gray-lossless.jp2" : "jbig2-generic-stream.bin");
  const width = isJpx ? 8 : 64, height = isJpx ? 6 : 32;
  const bpc = isJpx ? 8 : 1;
  page.setRawContentStream(`BI /W ${width} /H ${height} /BPC ${bpc} /CS /G /F [/AHx /${filter}] ID ${bytes.toString("hex")}> EI`);
  const expected = isJpx ? "e683562d04502a4e06ba8d48dbbf86df106e31bc53fa31f079d8e2e71cd63206" : "52aa3d11825fe6ce1c8608026db9e9cd7b69a1348dd2c37de6b216948a98eed5";
  expect(digest(extractDocumentImages(doc.cos)[0]!.bitmap.data)).toBe(expected);
  expect(digest(page.evaluateDisplayList().images[0]!.decodedRgba!)).toBe(expected);
  expect(Array.from(extractDocumentImages(doc.cos)[0]!.rawEncodedBytes!)).toEqual([...bytes]);
});

it("decodes standalone inline images with filter arrays and color-space aliases", () => {
  const bytes = fixture("gray-lossless.jp2");
  const dict = cosDict({ F: cosArray([cosName("AHx"), cosName("JPXDecode")]) });
  const image = decodeInlineImageNodeToRgba(undefined, dict, new TextEncoder().encode(bytes.toString("hex") + ">"), undefined);
  expect(image).toMatchObject({ width: 8, height: 6, colorSpace: "gray" });
  expect(digest(image.rgba)).toBe("e683562d04502a4e06ba8d48dbbf86df106e31bc53fa31f079d8e2e71cd63206");
});

it("combines a JPX image with a smaller soft mask during extraction", () => {
  const doc = PdfDocument.create(); const page = doc.addPage([8, 6]);
  const mask = doc.cos.allocateObject(cosStream(Uint8Array.of(64), { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(1), Height: cosNumber(1),
    ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(8),
  }) }));
  const ref = doc.cos.allocateObject(cosStream(fixture("rgb-lossless.jp2"), { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Image"), Filter: cosName("JPXDecode"), SMask: mask,
  }) }));
  const name = page.ensureXObjectResource(ref); page.setRawContentStream(`/${name} Do`);
  const image = extractDocumentImages(doc.cos)[0]!;
  const expected = Array.from({ length: 48 }, (_, i) => [i % 8 * 31, Math.floor(i / 8) * 47, (i % 8 + Math.floor(i / 8)) * 19, 64]).flat();
  expect([...image.bitmap.data]).toEqual(expected);
});

it("enforces header-derived budgets through the extraction API", () => {
  const doc = PdfDocument.create(); const page = doc.addPage([8, 6]);
  const ref = doc.cos.allocateObject(cosStream(fixture("rgb-lossless.jp2"), { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Image"), Filter: cosName("JPXDecode"),
  }) }));
  const name = page.ensureXObjectResource(ref); page.setRawContentStream(`/${name} Do`);
  expect(() => extractDocumentImages(PdfDocument.load(doc.save(), { maxDecompressedBytes: 32 }).cos)).toThrow(/budget/);
});

it("keeps indexed palette and color-key mask behavior through the shared decoder", () => {
  const doc = PdfDocument.create(); const page = doc.addPage([2, 1]);
  const ref = doc.cos.allocateObject(cosStream(Uint8Array.of(0, 1), { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(2), Height: cosNumber(1), BitsPerComponent: cosNumber(8),
    ColorSpace: cosArray([cosName("Indexed"), cosName("DeviceRGB"), cosNumber(1), cosStream(Uint8Array.of(255, 0, 0, 0, 255, 0))]),
    Mask: cosArray([cosNumber(0), cosNumber(0)]),
  }) }));
  dictSet(page.pageDict, "Resources", cosDict({ XObject: cosDict({ Im: ref }) }));
  page.setRawContentStream("/Im Do");
  expect([...extractDocumentImages(doc.cos)[0]!.bitmap.data]).toEqual([255, 0, 0, 0, 0, 255, 0, 255]);
});
