import { expect, it } from "vitest";
import { imageMetadata, normalizeImageDpi } from "./image-metadata.js";

it.each([
  [
    [42, 24],
    [42, 24]
  ],
  [
    [42.1, 23.6],
    [42, 24]
  ],
  [null, [72, 72]],
  [
    [3047, 2388],
    [72, 72]
  ],
  ["invalid", [72, 72]],
  [
    [0, 96],
    [72, 96]
  ],
  [
    [NaN, Infinity],
    [72, 72]
  ],
  [
    [1, 2048],
    [1, 2048]
  ]
])("normalizes density axes independently (%j)", (raw, expected) => {
  expect(normalizeImageDpi(raw)).toEqual(expected);
});

it("reads PNG dimensions and physical density without decoding pixels", () => {
  const bytes = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 44, 0, 0, 0, 150, 8, 2,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 112, 72, 89, 115, 0, 0, 14, 196, 0, 0, 7, 98, 1, 0, 0, 0, 0
  ]);
  expect(imageMetadata(bytes, "image/png")).toEqual({
    pixelWidth: 300,
    pixelHeight: 150,
    dpiX: 96,
    dpiY: 48
  });
});

it("reads JPEG frame dimensions and centimeter density", () => {
  const bytes = Uint8Array.from([
    255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 2, 2, 0, 40, 0, 20, 0, 0, 255, 194, 0, 11, 8,
    0, 25, 0, 50, 1, 1, 17, 0, 255, 218
  ]);
  expect(imageMetadata(bytes, "image/jpeg")).toEqual({
    pixelWidth: 50,
    pixelHeight: 25,
    dpiX: 102,
    dpiY: 51
  });
});

it("reads GIF logical canvas dimensions with default density", () => {
  expect(
    imageMetadata(Uint8Array.from([71, 73, 70, 56, 57, 97, 44, 1, 150, 0, 0, 0, 0]), "image/gif")
  ).toEqual({ pixelWidth: 300, pixelHeight: 150, dpiX: 72, dpiY: 72 });
});

it("reads top-down bitmap dimensions and density", () => {
  const bytes = new Uint8Array(54);
  const view = new DataView(bytes.buffer);
  bytes.set([66, 77]);
  view.setUint32(14, 40, true);
  view.setInt32(18, 300, true);
  view.setInt32(22, -150, true);
  view.setInt32(38, 3780, true);
  view.setInt32(42, 1890, true);
  expect(imageMetadata(bytes, "image/bmp")).toEqual({
    pixelWidth: 300,
    pixelHeight: 150,
    dpiX: 96,
    dpiY: 48
  });
});

function tiff(little: boolean): Uint8Array {
  const bytes = new Uint8Array(90),
    view = new DataView(bytes.buffer);
  bytes.set(little ? [73, 73] : [77, 77]);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 5, little);
  for (const [index, tag, type, value] of [
    [0, 256, 4, 300],
    [1, 257, 4, 150],
    [2, 282, 5, 74],
    [3, 283, 5, 82],
    [4, 296, 3, 2]
  ]) {
    const offset = 10 + index! * 12;
    view.setUint16(offset, tag!, little);
    view.setUint16(offset + 2, type!, little);
    view.setUint32(offset + 4, 1, little);
    if (type === 3) view.setUint16(offset + 8, value!, little);
    else view.setUint32(offset + 8, value!, little);
  }
  view.setUint32(74, 421, little);
  view.setUint32(78, 10, little);
  view.setUint32(82, 236, little);
  view.setUint32(86, 10, little);
  return bytes;
}
it.each([true, false])(
  "reads TIFF scalar dimensions and rational density in either byte order (%s)",
  (little) => {
    expect(imageMetadata(tiff(little), "image/tiff")).toEqual({
      pixelWidth: 300,
      pixelHeight: 150,
      dpiX: 42,
      dpiY: 24
    });
  }
);
it.each([
  "image/svg+xml",
  "image/x-wmf",
  "image/x-emf",
  "image/vnd.ms-photo",
  "application/octet-stream"
])("keeps opaque %s bytes uninterpreted", (type) => {
  expect(imageMetadata(new TextEncoder().encode('<svg onload="throw 1"/>'), type)).toEqual({
    pixelWidth: null,
    pixelHeight: null,
    dpiX: 72,
    dpiY: 72
  });
});
it("bounds every TIFF offset and handles truncated headers without throwing", () => {
  const bytes = tiff(true);
  new DataView(bytes.buffer).setUint32(4, 0xfffffff0, true);
  expect(imageMetadata(bytes, "image/tiff").pixelWidth).toBeNull();
  for (const type of ["image/png", "image/jpeg", "image/gif", "image/bmp", "image/tiff"])
    for (let size = 0; size < 12; size++)
      expect(() => imageMetadata(bytes.subarray(0, size), type)).not.toThrow();
});

it("reads JPEG embedded TIFF density while keeping frame dimensions authoritative", () => {
  const bytes = Uint8Array.from([
    255,
    216,
    255,
    225,
    0,
    98,
    69,
    120,
    105,
    102,
    0,
    0,
    ...tiff(false),
    255,
    192,
    0,
    11,
    8,
    0,
    20,
    0,
    40,
    1,
    1,
    17,
    0,
    255,
    218
  ]);
  expect(imageMetadata(bytes, "image/jpeg")).toEqual({
    pixelWidth: 40,
    pixelHeight: 20,
    dpiX: 42,
    dpiY: 24
  });
});
it("bounds truncated JPEG marker segments", () => {
  expect(
    imageMetadata(Uint8Array.from([255, 216, 255, 224, 255, 255, 74, 70]), "image/jpeg")
  ).toEqual({ pixelWidth: null, pixelHeight: null, dpiX: 72, dpiY: 72 });
});
it("treats zero rational denominators independently and ignores TIFF directory cycles", () => {
  const bytes = tiff(true),
    view = new DataView(bytes.buffer);
  view.setUint32(78, 0, true);
  view.setUint32(70, 8, true);
  expect(imageMetadata(bytes, "image/tiff")).toEqual({
    pixelWidth: 300,
    pixelHeight: 150,
    dpiX: 72,
    dpiY: 24
  });
});
it("converts TIFF centimeter resolutions", () => {
  const bytes = tiff(true);
  new DataView(bytes.buffer).setUint16(66, 3, true);
  expect(imageMetadata(bytes, "image/tiff")).toEqual({
    pixelWidth: 300,
    pixelHeight: 150,
    dpiX: 107,
    dpiY: 60
  });
});
it("reads compact bitmap headers and sliced input byte offsets", () => {
  const storage = new Uint8Array(31),
    bytes = storage.subarray(5),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  bytes.set([66, 77]);
  view.setUint32(14, 12, true);
  view.setUint16(18, 64, true);
  view.setUint16(20, 32, true);
  expect(imageMetadata(bytes, "image/bmp")).toEqual({
    pixelWidth: 64,
    pixelHeight: 32,
    dpiX: 72,
    dpiY: 72
  });
});

it.each([
  [
    [0.6, 2048.4],
    [1, 2048]
  ],
  [
    [0.4, 2048.5],
    [72, 2048]
  ],
  [
    [42.5, 23.5],
    [42, 24]
  ],
  [
    ["96", 96],
    [72, 96]
  ]
])("rounds numeric density before applying the supported range (%j)", (raw, expected) => {
  expect(normalizeImageDpi(raw)).toEqual(expected);
});

it.each([
  [
    [0.5, 1.5],
    [72, 2]
  ],
  [
    [2.5, 3.5],
    [2, 4]
  ],
  [
    [2047.5, 2049.5],
    [2048, 72]
  ],
  [
    [42.499999999, 42.500000001],
    [42, 43]
  ],
  [
    [-0.5, -1.5],
    [72, 72]
  ]
])("rounds density ties to even before independent fallback (%j)", (raw, expected) => {
  expect(normalizeImageDpi(raw)).toEqual(expected);
});

it.each([true, false])(
  "rounds TIFF rational density ties without changing bytes (%s)",
  (little) => {
    const bytes = tiff(little);
    const view = new DataView(bytes.buffer);
    view.setUint32(74, 85, little);
    view.setUint32(78, 2, little);
    view.setUint32(82, 47, little);
    view.setUint32(86, 2, little);
    const before = bytes.slice();
    expect(imageMetadata(bytes, "image/tiff")).toEqual({
      pixelWidth: 300,
      pixelHeight: 150,
      dpiX: 42,
      dpiY: 24
    });
    expect(bytes).toEqual(before);
  }
);

it("reads a square JPEG frame with absent density", () => {
  const bytes = Uint8Array.from([
    255, 216, 255, 192, 0, 11, 8, 0, 204, 0, 204, 1, 1, 17, 0, 255, 218
  ]);
  expect(imageMetadata(bytes, "image/jpeg")).toEqual({
    pixelWidth: 204,
    pixelHeight: 204,
    dpiX: 72,
    dpiY: 72
  });
});
