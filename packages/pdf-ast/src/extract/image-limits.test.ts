import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  PdfDocument, ParsedCosDocument, cosDict, cosName, cosNumber, cosRef, cosStream, dictSet,
  decodeInlineImageNodeToRgba, decodeXObjectImageToRgba, encodeJpeg, extractDocumentImages,
} from "../index.js";

const limited = (maxDecompressedBytes: number) => new ParsedCosDocument({
  version: "1.7", bytes: new Uint8Array(), objects: new Map(), revisions: [], rootRef: cosRef(1), maxDecompressedBytes,
});
const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const imageDict = (filter?: string) => cosDict({
  Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(8), Height: cosNumber(6),
  ColorSpace: cosName("DeviceRGB"), BitsPerComponent: cosNumber(8), ...(filter ? { Filter: cosName(filter) } : {}),
});

it.each(["raw", "JPEG", "JPX", "JBIG2"])("enforces the requested budget for %s image buffers", kind => {
  let dict = imageDict();
  let bytes: Uint8Array = new Uint8Array(144);
  if (kind === "JPEG") { dict = imageDict("DCTDecode"); bytes = encodeJpeg({ width: 8, height: 6, data: new Uint8Array(192) }); }
  if (kind === "JPX") { dict = imageDict("JPXDecode"); bytes = fixture("rgb-lossless.jp2"); }
  if (kind === "JBIG2") {
    dict = imageDict("JBIG2Decode"); bytes = fixture("jbig2-generic-stream.bin");
    dictSet(dict, "Width", cosNumber(64)); dictSet(dict, "Height", cosNumber(32));
    dictSet(dict, "ColorSpace", cosName("DeviceGray")); dictSet(dict, "BitsPerComponent", cosNumber(1));
  }
  expect(() => decodeXObjectImageToRgba(limited(16), cosStream(bytes, { dict }), undefined)).toThrow(/budget/);
});

it("uses JPX header dimensions when the dictionary understates image size", () => {
  const dict = imageDict("JPXDecode");
  dictSet(dict, "Width", cosNumber(1)); dictSet(dict, "Height", cosNumber(1));
  expect(() => decodeXObjectImageToRgba(limited(16), cosStream(fixture("rgb-lossless.jp2"), { dict }), undefined)).toThrow(/budget/);
});

it("uses JBIG2 page dimensions before allocation when the dictionary understates image size", () => {
  const dict = imageDict("JBIG2Decode");
  dictSet(dict, "Width", cosNumber(1)); dictSet(dict, "Height", cosNumber(1));
  expect(() => decodeXObjectImageToRgba(limited(16), cosStream(fixture("jbig2-generic-stream.bin"), { dict }), undefined)).toThrow(/budget/);
});

it("applies image budgets to inline images", () => {
  expect(() => decodeInlineImageNodeToRgba(limited(16), imageDict(), new Uint8Array(144), undefined)).toThrow(/budget/);
});

it("applies budgets to cached and unfiltered decoded streams", () => {
  const doc = limited(16);
  expect(() => doc.decodeStream(cosStream(new Uint8Array(32)))).toThrow(/budget/);
  expect(() => doc.decodeStream({ kind: "stream", dict: cosDict({}), rawBytes: new Uint8Array(32) })).toThrow(/budget/);
});

it("does not swallow a decompression budget error and use compressed pixels", () => {
  const dict = imageDict(); dictSet(dict, "Width", cosNumber(1)); dictSet(dict, "Height", cosNumber(1));
  const stream = cosStream(new Uint8Array(1000), { dict, compress: true });
  // A loaded stream has no decoded-byte cache.
  const loaded = { kind: "stream" as const, dict: stream.dict, rawBytes: stream.rawBytes };
  expect(() => decodeXObjectImageToRgba(limited(32), loaded, undefined)).toThrow(/budget/);
});

it("retains unlimited defaults and accepts images exactly at the RGBA budget", () => {
  const doc = PdfDocument.create();
  const stream = cosStream(fixture("rgb-lossless.jp2"), { dict: imageDict("JPXDecode") });
  expect(decodeXObjectImageToRgba(doc.cos, stream, undefined).rgba).toHaveLength(192);
  expect(decodeXObjectImageToRgba(limited(192), stream, undefined).rgba).toHaveLength(192);
});

it("rejects an oversized soft mask even when the parent image fits", () => {
  const doc = limited(32);
  const dict = imageDict(); dictSet(dict, "Width", cosNumber(1)); dictSet(dict, "Height", cosNumber(1));
  const mask = cosStream(fixture("gray-lossless.jp2"), { dict: imageDict("JPXDecode") });
  dictSet(mask.dict, "ColorSpace", cosName("DeviceGray"));
  dictSet(dict, "SMask", doc.allocateObject(mask));
  expect(() => decodeXObjectImageToRgba(doc, cosStream(new Uint8Array(3), { dict }), undefined)).toThrow(/budget/);
});

it("applies the budget to the document image extraction API", () => {
  const doc = PdfDocument.create();
  const page = doc.addPage([8, 6]);
  const stream = doc.cos.allocateObject(cosStream(new Uint8Array(144), { dict: imageDict() }));
  const name = page.ensureXObjectResource(stream);
  page.setRawContentStream(`/${name} Do`);
  const loaded = PdfDocument.load(doc.save(), { maxDecompressedBytes: 16 });
  expect(() => extractDocumentImages(loaded.cos)).toThrow(/budget/);
});

it("uses JPEG header dimensions before allocation when the dictionary understates image size", () => {
  const dict = imageDict("DCTDecode");
  dictSet(dict, "Width", cosNumber(1)); dictSet(dict, "Height", cosNumber(1));
  const jpeg = encodeJpeg({ width: 8, height: 6, data: new Uint8Array(192) });
  expect(() => decodeXObjectImageToRgba(limited(16), cosStream(jpeg, { dict }), undefined)).toThrow(/budget/);
});
