import { expect, it } from "vitest";
import { buildExifApp1Segment, parseExifBuffer } from "./exif.js";
import { encodeJpegImage } from "./jpeg.js";

it("updates orientation and resolution without mutating or growing an existing profile", () => {
  const exif = buildExifApp1Segment({ orientation: 6, density: 72 }).slice(6);
  const original = exif.slice();
  const result = buildExifApp1Segment({ exif, orientation: 1, resolution: { x: 120, y: 150, unit: "cm" } });
  expect(parseExifBuffer(result)).toEqual({ orientation: 1, density: 305, resolution: { x: 120, y: 150, unit: "cm" } });
  expect(result.length).toBe(exif.length + 6);
  expect(exif).toEqual(original);
});

it("adds missing orientation while retaining existing offsets and the next directory", () => {
  const exif = buildExifApp1Segment({ density: 72 }).slice(6), view = new DataView(exif.buffer);
  view.setUint16(10, 0x0131, true); // Replace Orientation with an unrelated inline tag.
  view.setUint32(58, 8, true); // Preserve the next-directory pointer, without traversing cycles.
  const result = buildExifApp1Segment({ exif, orientation: 8, density: 144 });
  expect(parseExifBuffer(result)).toEqual({ orientation: 8, density: 144, resolution: { x: 144, y: 144, unit: "inch" } });
  const tiff = result.subarray(6), output = new DataView(tiff.buffer, tiff.byteOffset);
  const directory = output.getUint32(4, true);
  expect(output.getUint16(directory + 2, true)).toBe(0x0131);
  expect(output.getUint32(directory + 2 + 5 * 12, true)).toBe(8);
  expect(buildExifApp1Segment({ exif: tiff, orientation: 1, density: 144 }).length).toBe(result.length);
});

it.each([new Uint8Array(), Uint8Array.of(73, 73, 42, 0, 255, 255, 255, 255), Uint8Array.of(73, 73, 42, 0, 8, 0, 0, 0, 1, 0)])("rejects malformed EXIF without out-of-bounds access", exif => {
  expect(() => buildExifApp1Segment({ exif })).toThrow(/EXIF/);
});

it("rejects EXIF too large for a JPEG APP1 segment", () => {
  const exif = new Uint8Array(65533);
  exif.set(buildExifApp1Segment({ orientation: 6 }).subarray(6));
  expect(() => encodeJpegImage({ width: 1, height: 1, data: Uint8Array.of(0, 0, 0, 255), format: "jpeg", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, exif })).toThrow(/segment/);
});
