import { describe, expect, it } from "vitest";
import { characterizeRasterHeader } from "./raster-header.js";
import { textContext } from "../tests/fixtures/text.js";
import { joinBytes, jpegSegment, pngChunk, rasterBmp, rasterDirectory, rasterGif, rasterJpeg, rasterPng, rasterTiff } from "../tests/fixtures/raster.js";

const dimensionEntries = [{ tag: 256, type: 3, values: [42] }, { tag: 257, type: 4, values: [24] }];

describe("raster characterization observable cases", () => {
  it("reads independent PNG header dimensions and raw physical density fields", () => {
    expect(characterizeRasterHeader(rasterPng(42, 24, [42, 24, 1]), textContext)).toMatchObject({ pixelWidth: 42, pixelHeight: 24, horizontalDpi: 42 * 0.0254, verticalDpi: 24 * 0.0254 });
    expect(characterizeRasterHeader(rasterPng(42, 24, [1417, 2480, 1]), textContext)).toMatchObject({ pixelWidth: 42, pixelHeight: 24, horizontalDpi: 1417 * 0.0254, verticalDpi: 2480 * 0.0254 });
  });
  it("retains fractional physical PNG and BMP densities without rounding or format-specific fallback", () => {
    const png = characterizeRasterHeader(rasterPng(12, 34, [1654, 945, 1]), textContext);
    expect(png).toMatchObject({ mime: "image/png", pixelWidth: 12, pixelHeight: 34 });
    expect(png.horizontalDpi).toBeCloseTo(42.0116, 10); expect(png.verticalDpi).toBeCloseTo(24.003, 10);
    const bmp = characterizeRasterHeader(rasterBmp(26, 43, 7864, 0), textContext);
    expect(bmp).toMatchObject({ mime: "image/bmp", pixelWidth: 26, pixelHeight: 43, verticalDpi: null });
    expect(bmp.horizontalDpi).toBeCloseTo(199.7456, 10);
  });
  it("retains independently missing PNG axes and aspect-only density", () => {
    for (const input of [rasterPng(), rasterPng(12, 34, [1000, 1000, 0]), rasterPng(12, 34, [0, 0, 1])]) {
      expect(characterizeRasterHeader(input, textContext)).toMatchObject({ horizontalDpi: null, verticalDpi: null });
    }
    expect(characterizeRasterHeader(rasterPng(12, 34, [1654, 0, 1]), textContext).verticalDpi).toBeNull();
    expect(characterizeRasterHeader(rasterPng(12, 34, [0, 945, 1]), textContext).horizontalDpi).toBeNull();
  });
  it("traverses original ancillary chunk intervals and requires dimension-bearing and terminal chunks", () => {
    const bytes = rasterPng(12, 34), extra = pngChunk("tEXt", Uint8Array.of(107, 0, 118));
    expect(characterizeRasterHeader(joinBytes(bytes.slice(0, 33), extra, bytes.slice(33)), textContext)).toEqual(characterizeRasterHeader(bytes, textContext));
    for (const broken of [joinBytes(bytes.slice(0, 8), bytes.slice(33)), bytes.slice(0, -12), joinBytes(bytes.slice(0, 33), bytes.slice(8, 33), bytes.slice(33))]) expect(() => characterizeRasterHeader(broken, textContext)).toThrow();
    const huge = new Uint8Array(extra); new DataView(huge.buffer).setUint32(0, 0xffffffff);
    expect(() => characterizeRasterHeader(joinBytes(bytes.slice(0, 33), huge, bytes.slice(33)), textContext)).toThrow();
  });
  it("validates ancillary name reads and truncated or invalid density payloads", () => {
    const bytes = rasterPng(42, 24), unknown = pngChunk("rNDm", Uint8Array.of(7, 14, 21, 28, 35));
    expect(characterizeRasterHeader(joinBytes(bytes.slice(0, 33), unknown, bytes.slice(33)), textContext)).toMatchObject({ pixelWidth: 42, pixelHeight: 24 });
    for (const payload of [new Uint8Array(8), Uint8Array.of(0, 0, 0, 42, 0, 0, 0, 24, 2)]) expect(() => characterizeRasterHeader(joinBytes(bytes.slice(0, 33), pngChunk("pHYs", payload), bytes.slice(33)), textContext)).toThrow();
    expect(() => characterizeRasterHeader(joinBytes(bytes.slice(0, 33), unknown.slice(0, 6)), textContext)).toThrow();
  });
  for (const [unit, x, y] of [[0, null, null], [1, 100, 200], [2, 254, 508]] as const) it(`reads JFIF density unit ${unit} per axis`, () => {
    expect(characterizeRasterHeader(rasterJpeg(111, 222, [unit, 100, 200]), textContext)).toMatchObject({ pixelWidth: 111, pixelHeight: 222, horizontalDpi: x, verticalDpi: y });
  });
  it("reads unequal JFIF density and independently legal zero axes", () => {
    expect(characterizeRasterHeader(rasterJpeg(111, 222, [1, 333, 444]), textContext)).toMatchObject({ pixelWidth: 111, pixelHeight: 222, horizontalDpi: 333, verticalDpi: 444 });
    expect(characterizeRasterHeader(rasterJpeg(111, 222, [1, 333, 0]), textContext)).toMatchObject({ horizontalDpi: 333, verticalDpi: null });
    expect(characterizeRasterHeader(rasterJpeg(111, 222, [1, 0, 444]), textContext)).toMatchObject({ horizontalDpi: null, verticalDpi: 444 });
  });
  it("admits JPEG without optional density markers and traverses nonmetadata segments inertly", () => {
    const bytes = rasterJpeg(111, 222), withoutDensity = joinBytes(bytes.slice(0, 2), bytes.slice(20));
    expect(characterizeRasterHeader(withoutDensity, textContext)).toMatchObject({ pixelWidth: 111, pixelHeight: 222, horizontalDpi: null, verticalDpi: null });
    const extra = joinBytes(jpegSegment(225, Uint8Array.of(78, 0, 84)), jpegSegment(254, Uint8Array.of(42, 24, 12, 6)));
    expect(characterizeRasterHeader(joinBytes(bytes.slice(0, 2), extra, bytes.slice(2)), textContext)).toEqual(characterizeRasterHeader(bytes, textContext));
    expect(characterizeRasterHeader(joinBytes(bytes.slice(0, 2), Uint8Array.of(255, 255), bytes.slice(2)), textContext)).toEqual(characterizeRasterHeader(bytes, textContext));
  });
  for (const marker of [192, 199]) it(`reads encoded frame marker ${marker}`, () => {
    const bytes = rasterJpeg(42, 24); bytes[21] = marker;
    expect(characterizeRasterHeader(bytes, textContext)).toMatchObject({ pixelWidth: 42, pixelHeight: 24 });
  });
  it("reads vertical frame orientation and standalone marker traversal", () => {
    const bytes = rasterJpeg(24, 42, [1, 42, 24]);
    expect(characterizeRasterHeader(joinBytes(bytes.slice(0, 2), Uint8Array.of(255, 1), bytes.slice(2)), textContext)).toMatchObject({ pixelWidth: 24, pixelHeight: 42, horizontalDpi: 42, verticalDpi: 24 });
  });
  it("rejects missing frame dimensions and unsafe JPEG segment lengths", () => {
    const bytes = rasterJpeg(), noFrame = joinBytes(bytes.slice(0, 20), bytes.slice(33));
    expect(() => characterizeRasterHeader(noFrame, textContext)).toThrow();
    for (const length of [0, 1, 65535]) { const broken = new Uint8Array(bytes); new DataView(broken.buffer).setUint16(4, length); expect(() => characterizeRasterHeader(broken, textContext)).toThrow(); }
    for (const marker of [0, 216, 208]) expect(() => characterizeRasterHeader(joinBytes(bytes.slice(0, 2), Uint8Array.of(255, marker), bytes.slice(2)), textContext)).toThrow();
  });
  for (const version of ["87a", "89a"]) it(`reads original GIF${version} logical dimensions at bounded offsets`, () => {
    const bytes = rasterGif(version); new DataView(bytes.buffer).setUint16(6, 42, true); new DataView(bytes.buffer).setUint16(8, 24, true);
    expect(characterizeRasterHeader(bytes, textContext)).toEqual({ mime: "image/gif", pixelWidth: 42, pixelHeight: 24, horizontalDpi: null, verticalDpi: null });
    expect(() => characterizeRasterHeader(bytes.slice(0, 15), textContext)).toThrow();
  });
  for (const little of [false, true]) {
    const order = little ? "little" : "big";
    it(`reads ${order}-endian SHORT/LONG dimensions and missing density`, () => {
      expect(characterizeRasterHeader(rasterDirectory(little, dimensionEntries), textContext)).toEqual({ mime: "image/tiff", pixelWidth: 42, pixelHeight: 24, horizontalDpi: null, verticalDpi: null });
    });
    it(`reads ${order}-endian constructor metadata and independently missing resolution`, () => {
      const entries = [{ tag: 256, type: 4, values: [111] }, { tag: 257, type: 4, values: [222] }, { tag: 282, type: 5, values: [333] }, { tag: 283, type: 5, values: [444] }];
      expect(characterizeRasterHeader(rasterDirectory(little, entries), textContext)).toMatchObject({ pixelWidth: 111, pixelHeight: 222, horizontalDpi: 333, verticalDpi: 444 });
      for (const missing of [282, 283]) expect(characterizeRasterHeader(rasterDirectory(little, entries.filter(entry => entry.tag !== missing)), textContext)).toMatchObject(missing === 282 ? { horizontalDpi: null, verticalDpi: 444 } : { horizontalDpi: 333, verticalDpi: null });
      expect(characterizeRasterHeader(rasterDirectory(little, [...dimensionEntries, { tag: 296, type: 3, values: [2] }]), textContext)).toMatchObject({ horizontalDpi: null, verticalDpi: null });
    });
    it(`reads ${order}-endian LONG value and nonintegral rational resolution`, () => {
      const bytes = rasterTiff(little, 2, [42, 84], [24, 48]);
      expect(characterizeRasterHeader(bytes, textContext)).toMatchObject({ horizontalDpi: 0.5, verticalDpi: 0.5 });
      expect(characterizeRasterHeader(rasterDirectory(little, [{ tag: 256, type: 4, values: [42] }, { tag: 257, type: 3, values: [24] }]), textContext)).toMatchObject({ pixelWidth: 42, pixelHeight: 24 });
    });
    it(`selects ${order}-endian directory tags independent of order and does not retain result aliases`, () => {
      const entries = [{ tag: 1, type: 1, values: [2] }, { tag: 2, type: 2, values: [65, 67, 69, 71, 73, 75, 0] }, ...dimensionEntries];
      const bytes = rasterDirectory(little, entries), before = new Uint8Array(bytes);
      const first = characterizeRasterHeader(bytes, textContext);
      expect(characterizeRasterHeader(rasterDirectory(little, [...entries].reverse()), textContext)).toEqual(first);
      Object.assign(first, { pixelWidth: 999 });
      expect(characterizeRasterHeader(bytes, textContext).pixelWidth).toBe(42); expect(bytes).toEqual(before);
      expect(() => characterizeRasterHeader(rasterDirectory(little, [...entries, { tag: 256, type: 4, values: [24] }]), textContext)).toThrow();
    });
    for (const [unit, x, y, expectedX, expectedY] of [[1, 150, 240, null, null], [2, 42, 24, 42, 24], [3, 100, 200, 254, 508], [null, 96, 100, 96, 100]] as const) it(`reads ${order}-endian rational density unit ${unit}`, () => {
      const entries = [...dimensionEntries, { tag: 282, type: 5, values: [x] }, { tag: 283, type: 5, values: [y] }, ...(unit === null ? [] : [{ tag: 296, type: 3, values: [unit] }])];
      expect(characterizeRasterHeader(rasterDirectory(little, entries), textContext)).toMatchObject({ horizontalDpi: expectedX, verticalDpi: expectedY });
      expect(characterizeRasterHeader(rasterJpeg(111, 222, [0, 1, 1], rasterDirectory(little, entries)), textContext)).toMatchObject({ pixelWidth: 111, pixelHeight: 222, horizontalDpi: expectedX, verticalDpi: expectedY });
    });
    for (const type of [1, 2, 3, 4, 5, 6]) it(`traverses inert ${order}-endian TIFF type ${type} without exposing private entries`, () => {
      const bytes = rasterDirectory(little, [{ tag: 65000, type, values: type === 2 ? [65, 66, 67, 68, 0] : [42] }, ...dimensionEntries]);
      expect(characterizeRasterHeader(bytes, textContext)).toMatchObject({ pixelWidth: 42, pixelHeight: 24 });
      expect(() => characterizeRasterHeader(bytes.slice(0, -1), textContext)).toThrow();
    });
  }
  it("rejects unknown signatures and bounded metadata slices with nonzero byte offsets", () => {
    expect(() => characterizeRasterHeader(Uint8Array.of(42, 24, 12), textContext)).toThrow();
    const payload = rasterDirectory(false, dimensionEntries), backing = joinBytes(Uint8Array.of(7, 8, 9), payload, Uint8Array.of(10));
    expect(characterizeRasterHeader(backing.subarray(3, -1), textContext)).toEqual(characterizeRasterHeader(payload, textContext));
  });
});
