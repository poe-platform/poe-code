import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, decodeJbig2ToRgba, decodeJpxToRgba,
} from "../index.js";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

it.each(["rgb-lossless.jp2", "rgb-lossless.j2k", "rgb-tiled.jp2"])("decodes independently encoded JPEG 2000 pixels: %s", file => {
  const expected = Array.from({ length: 48 }, (_, i) => {
    const x = i % 8, y = Math.floor(i / 8);
    return [x * 31, y * 47, (x + y) * 19, 255];
  }).flat();
  expect([...decodeJpxToRgba(fixture(file), 8, 6)]).toEqual(expected);
});

it.each(["pdfjs-jbig2-symbol-offset.pdf", "pdfjs-jp2-resetprob.pdf"])("matches independently decoded PDF.js regression pixels: %s", file => {
  const doc = PdfDocument.load(fixture(file));
  const image = doc.getPage(0).evaluateDisplayList().images[0]!;
  // Reference pixels from PyMuPDF 1.28.2, converted to non-premultiplied RGBA.
  const expected = file.includes("jbig2")
    ? "ea0b15437343b56b23a6e0c2674c919058b7ca95a295c9a712caffff44bc9cf8"
    : "656979fe916cbf4ef6bcee5bfaa6afa0ab7c09c1556c0c73eb45584e75ea2caf";
  expect(digest(image.decodedRgba!)).toBe(expected);
});

it.each(["jbig2-generic.jb2", "jbig2-generic-stream.bin", "jbig2-mmr-stream.bin"])("decodes an independently encoded JBIG2 bitmap: %s", file => {
  expect(digest(decodeJbig2ToRgba(fixture(file), 64, 32))).toBe("52aa3d11825fe6ce1c8608026db9e9cd7b69a1348dd2c37de6b216948a98eed5");
});

it.each([false, true])("uses JBIG2Globals through filter arrays: %s", wrapped => {
  const doc = PdfDocument.create();
  const page = doc.addPage([64, 32]);
  const globals = doc.cos.allocateObject(cosStream(fixture("jbig2-symbols.sym")));
  const bytes = fixture("jbig2-symbols.0000");
  const encoded = wrapped ? new TextEncoder().encode(bytes.toString("hex") + ">") : bytes;
  const params = cosDict({ JBIG2Globals: globals });
  const stream = doc.cos.allocateObject(cosStream(encoded, { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(64), Height: cosNumber(32),
    ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(1),
    Filter: wrapped ? cosArray([cosName("ASCIIHexDecode"), cosName("JBIG2Decode")]) : cosName("JBIG2Decode"),
    DecodeParms: wrapped ? cosArray([{ kind: "null" }, params]) : params,
  }) }));
  const name = page.ensureXObjectResource(stream);
  page.setRawContentStream(`64 0 0 32 0 0 cm /${name} Do`);
  // jbig2enc symbol mode is lossy; these pixels were independently verified with PyMuPDF.
  expect(digest(page.evaluateDisplayList().images[0]!.decodedRgba!)).toBe("2f6fdd7e5b7bf087b4c8511e64986052aa0cbd4f267346c39906e27bc99d21ce");
});

it.each([new Uint8Array(), new Uint8Array([0xaa, 0x55])])("rejects invalid JBIG2 instead of fabricating pixels", bytes => {
  expect(() => decodeJbig2ToRgba(bytes, 8, 2)).toThrow();
});

it.each([new Uint8Array(), new Uint8Array([0xff, 0x4f, 0xff, 0x93, 200, 100, 50])])("rejects invalid JPEG 2000 instead of fabricating pixels", bytes => {
  expect(() => decodeJpxToRgba(bytes, 4, 4)).toThrow();
});

it("decodes grayscale JPEG 2000 pixels", () => {
  expect(digest(decodeJpxToRgba(fixture("gray-lossless.jp2")))).toBe("e683562d04502a4e06ba8d48dbbf86df106e31bc53fa31f079d8e2e71cd63206");
});

it("gets omitted JPEG 2000 dimensions and color space from the codestream", () => {
  const doc = PdfDocument.create();
  const page = doc.addPage([8, 6]);
  const image = doc.cos.allocateObject(cosStream(fixture("gray-lossless.jp2"), { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Image"), Filter: cosName("JPXDecode"),
  }) }));
  const name = page.ensureXObjectResource(image);
  page.setRawContentStream(`8 0 0 6 0 0 cm /${name} Do`);
  const decoded = page.evaluateDisplayList().images[0]!;
  expect(decoded).toMatchObject({ width: 8, height: 6, colorSpace: "gray", bitsPerComponent: 8 });
  expect(digest(decoded.decodedRgba!)).toBe("e683562d04502a4e06ba8d48dbbf86df106e31bc53fa31f079d8e2e71cd63206");
});

it.each(["rgb-lossless.jp2", "rgb-lossless.j2k"])("rejects truncated JPEG 2000 headers before tile allocation: %s", file => {
  const bytes = fixture(file);
  // The 101-byte JP2 prefix previously exhausted a 64 MB subprocess heap.
  for (let length = 0; length < Math.min(bytes.length, 130); length++) {
    expect(() => decodeJpxToRgba(bytes.subarray(0, length))).toThrow();
  }
});

it.each([22, 26, 41, 42])("rejects zero JPEG 2000 tile or subsampling dimensions at SIZ offset %s", offset => {
  const bytes = Uint8Array.from(fixture("rgb-lossless.j2k"));
  const marker = bytes.findIndex((byte, i) => byte === 0xff && bytes[i + 1] === 0x51);
  bytes.fill(0, marker + offset, marker + offset + (offset < 40 ? 4 : 1));
  expect(() => decodeJpxToRgba(bytes)).toThrow("dimensions");
});
