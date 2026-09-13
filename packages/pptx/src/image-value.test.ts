import { expect, it } from "vitest";
import { Image } from "./image-value.js";
import { admitImage } from "./image-admission.js";

function bitmap(): Uint8Array {
  const bytes = new Uint8Array(78),
    view = new DataView(bytes.buffer);
  bytes.set([66, 77]);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 2, true);
  view.setInt32(22, -3, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setInt32(38, 3780, true);
  view.setInt32(42, 1890, true);
  return bytes;
}
function tagged(little: boolean): Uint8Array {
  const bytes = new Uint8Array(38),
    view = new DataView(bytes.buffer);
  bytes.set(little ? [73, 73] : [77, 77]);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 2, little);
  for (const [offset, tag, value] of [
    [10, 256, 2],
    [22, 257, 3]
  ]) {
    view.setUint16(offset!, tag!, little);
    view.setUint16(offset! + 2, 4, little);
    view.setUint32(offset! + 4, 1, little);
    view.setUint32(offset! + 8, value!, little);
  }
  return bytes;
}
function metafile(): Uint8Array {
  const bytes = new Uint8Array(46),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x9ac6cdd7, true);
  view.setInt16(10, 200, true);
  view.setInt16(12, 300, true);
  view.setUint16(14, 100, true);
  let checksum = 0;
  for (let i = 0; i < 20; i += 2) checksum ^= view.getUint16(i, true);
  view.setUint16(20, checksum, true);
  view.setUint16(22, 1, true);
  view.setUint16(24, 9, true);
  view.setUint16(26, 0x300, true);
  view.setUint32(28, 12, true);
  view.setUint32(34, 3, true);
  view.setUint32(40, 3, true);
  return bytes;
}
it.each([
  [bitmap(), "image/bmp", "bmp", [2, 3], [96, 48]],
  [tagged(true), "image/tiff", "tiff", [2, 3], [72, 72]],
  [tagged(false), "image/tiff", "tiff", [2, 3], [72, 72]],
  [metafile(), "image/x-wmf", "wmf", [144, 216], [72, 72]]
] as const)("characterizes inert format metadata %s", (bytes, type, ext, size, dpi) => {
  const value = new Image(bytes, "drawing.any");
  expect(value.content_type).toBe(type);
  expect(value.ext).toBe(ext);
  expect(value.size).toEqual(size);
  expect(value.dpi).toEqual(dpi);
  expect(value.filename).toBe("drawing.any");
  expect(value.blob).toEqual(bytes);
  expect(admitImage(bytes, type).extension).toBe(ext);
});
it("owns bytes and provides SHA-1 compatibility metadata", () => {
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const value = new Image(bytes);
  expect(value.sha1).toBe("d7c0d8f45ae77f941630f3e0db922800c1ce1bee");
  bytes[0] = 0;
  value.blob[1] = 0;
  expect(value.blob).toEqual(new Uint8Array([255, 216, 255, 217]));
  expect(value.filename).toBeNull();
  expect(() => value.size).toThrow();
});
it.each([bitmap(), tagged(true), tagged(false), metafile()])(
  "bounds truncated container input",
  (bytes) => {
    for (let length = 0; length < bytes.length; length++)
      expect(() => new Image(bytes.subarray(0, length))).toThrow();
  }
);
it("rejects malformed pointers, wrong MIME and non-string names", () => {
  const bytes = tagged(true);
  new DataView(bytes.buffer).setUint32(4, 0xffffffff, true);
  expect(() => new Image(bytes)).toThrow();
  expect(() => new Image(bitmap(), null, "image/png")).toThrow();
  expect(() => new Image(bitmap(), 12 as unknown as string)).toThrow();
});
it("rejects cyclic TIFF directories and overflowing field payloads", () => {
  const cycle = tagged(true),
    pointer = tagged(true);
  new DataView(cycle.buffer).setUint32(34, 8, true);
  const view = new DataView(pointer.buffer);
  view.setUint32(14, 2, true);
  view.setUint32(18, 0xfffffffe, true);
  expect(() => new Image(cycle)).toThrow();
  expect(() => new Image(pointer)).toThrow();
});
it("rejects WMF checksum, record and dimension corruption", () => {
  for (const offset of [20, 40, 14]) {
    const bytes = metafile();
    bytes[offset] = 0;
    expect(() => new Image(bytes)).toThrow();
  }
});
it("returns the GIF value interface without a supplied MIME or name", () => {
  const bytes = Uint8Array.from([
    71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59
  ]);
  const value = new Image(bytes);
  expect(value.content_type).toBe("image/gif");
  expect(value.ext).toBe("gif");
  expect(value.dpi).toEqual([72, 72]);
  expect(value.size).toEqual([1, 1]);
});
it("rejects mutation of value properties and returned tuples", () => {
  const value = new Image(bitmap());
  expect(() => Object.assign(value, { filename: "changed" })).toThrow();
  expect(() => Object.assign(value.size, { 0: 900 })).toThrow();
  expect(() => Object.assign(value.dpi, { 1: 900 })).toThrow();
});
