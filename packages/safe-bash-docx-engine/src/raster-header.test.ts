import { describe, expect, it } from "vitest";
import { characterizeRasterHeader } from "./raster-header.js";
import { DocumentBudget } from "./budget.js";
import { textContext } from "../tests/fixtures/text.js";
import { rasterPng, rasterJpeg, rasterGif, rasterBmp, rasterTiff, pngChunk, joinBytes } from "../tests/fixtures/raster.js";

describe("bounded raster header metadata", () => {
  it("characterizes original transparent PNG without decoding pixels", () => {
    expect(characterizeRasterHeader(rasterPng(), textContext)).toEqual({ mime: "image/png", pixelWidth: 1, pixelHeight: 1, horizontalDpi: null, verticalDpi: null });
    const metadata = characterizeRasterHeader(rasterPng(1, 1, [6000, 3000, 1]), textContext);
    expect(metadata.horizontalDpi).toBeCloseTo(152.4); expect(metadata.verticalDpi).toBeCloseTo(76.2);
    expect(characterizeRasterHeader(rasterPng(1, 1, [0, 3000, 1]), textContext).horizontalDpi).toBeNull();
    expect(characterizeRasterHeader(rasterPng(1, 1, [6000, 3000, 0]), textContext).verticalDpi).toBeNull();
  });
  it("reads JPEG portrait/landscape and independent JFIF density axes", () => {
    expect(characterizeRasterHeader(rasterJpeg(2, 3, [1, 144, 72]), textContext)).toEqual({ mime: "image/jpeg", pixelWidth: 2, pixelHeight: 3, horizontalDpi: 144, verticalDpi: 72 });
    expect(characterizeRasterHeader(rasterJpeg(3, 2, [2, 0, 30]), textContext)).toMatchObject({ pixelWidth: 3, pixelHeight: 2, horizontalDpi: null, verticalDpi: 76.2 });
    expect(characterizeRasterHeader(rasterJpeg(), textContext).horizontalDpi).toBeNull();
  });
  for (const little of [true, false]) it(`reads ${little ? "little" : "big"}-endian TIFF and JPEG Exif rationals`, () => {
    expect(characterizeRasterHeader(rasterTiff(little), textContext)).toEqual({ mime: "image/tiff", pixelWidth: 1, pixelHeight: 1, horizontalDpi: 144, verticalDpi: 72 });
    expect(characterizeRasterHeader(rasterJpeg(2, 3, [0, 1, 1], rasterTiff(little, 3, [30, 1], [60, 1])), textContext)).toMatchObject({ horizontalDpi: 76.2, verticalDpi: 152.4 });
    expect(characterizeRasterHeader(rasterTiff(little, 1), textContext).horizontalDpi).toBeNull();
  });
  for (const version of ["87a", "89a"]) it(`reads GIF${version} logical dimensions`, () => {
    expect(characterizeRasterHeader(rasterGif(version), textContext)).toEqual({ mime: "image/gif", pixelWidth: 1, pixelHeight: 1, horizontalDpi: null, verticalDpi: null });
  });
  it("reads top-down BMP and metric density with legally unspecified zero axes", () => {
    expect(characterizeRasterHeader(rasterBmp(1, -1, 0, 3000), textContext)).toEqual({ mime: "image/bmp", pixelWidth: 1, pixelHeight: 1, horizontalDpi: null, verticalDpi: 76.2 });
  });
  it("rejects malformed headers, invalid dimensions, density units and rationals", () => {
    for (const bytes of [rasterPng(0), rasterPng(0x80000000), rasterPng(1, 1, [1, 1, 2]), rasterJpeg(0), rasterJpeg(1, 1, [3, 1, 1]), rasterGif().slice(0, 12), rasterBmp(-1), rasterBmp(1, 0), rasterBmp(1, 1, -1), rasterTiff(true, 9), rasterTiff(true, 2, [1, 0]), rasterTiff(true, 2, [0, 1])]) {
      expect(() => characterizeRasterHeader(bytes, textContext)).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
    }
  });
  it("rejects truncated recognized format intervals and unsafe metadata offsets", () => {
    for (const bytes of [rasterPng().slice(0, 30), rasterJpeg().slice(0, 16), rasterBmp().slice(0, 36), rasterTiff().slice(0, 80)]) expect(() => characterizeRasterHeader(bytes, textContext)).toThrow();
    const unsafe = rasterTiff(); new DataView(unsafe.buffer).setUint32(42, 0xffffffff, true);
    expect(() => characterizeRasterHeader(unsafe, textContext)).toThrow();
    const cycle = rasterTiff(); new DataView(cycle.buffer).setUint32(70, 8, true);
    expect(() => characterizeRasterHeader(cycle, textContext)).toThrow();
    const headerAlias = rasterTiff(); new DataView(headerAlias.buffer).setUint32(42, 0, true);
    expect(() => characterizeRasterHeader(headerAlias, textContext)).toThrow();
  });
  it("rejects conflicting duplicate metadata and checksum corruption", () => {
    const bytes = rasterPng(1, 1, [100, 100, 1]), density = new Uint8Array(9); new DataView(density.buffer).setUint32(0, 200); density[8] = 1;
    const duplicate = joinBytes(bytes.slice(0, 54), pngChunk("pHYs", density), bytes.slice(54));
    expect(() => characterizeRasterHeader(duplicate, textContext)).toThrow();
    const broken = rasterPng(); broken[29] = broken[29]! ^ 1; expect(() => characterizeRasterHeader(broken, textContext)).toThrow();
  });
  it("admits a legal leading empty IDAT chunk without changing its joined payload", () => {
    const bytes = rasterPng(), leading = joinBytes(bytes.slice(0, 33), pngChunk("IDAT", new Uint8Array()), bytes.slice(33));
    expect(characterizeRasterHeader(leading, textContext)).toEqual(characterizeRasterHeader(bytes, textContext));
  });
  it("rejects structurally malformed palettes before pixel decoding", () => {
    const bytes = rasterPng();
    for (const palette of [new Uint8Array(), Uint8Array.of(1), new Uint8Array(771)]) {
      expect(() => characterizeRasterHeader(joinBytes(bytes.slice(0, 33), pngChunk("PLTE", palette), bytes.slice(33)), textContext)).toThrow();
    }
    const palette = pngChunk("PLTE", Uint8Array.of(20, 40, 60));
    const duplicate = joinBytes(bytes.slice(0, 33), palette, palette, bytes.slice(33));
    const late = joinBytes(bytes.slice(0, -12), palette, bytes.slice(-12));
    for (const invalid of [duplicate, late]) expect(() => characterizeRasterHeader(invalid, textContext)).toThrow();
    const header = new Uint8Array(bytes.slice(16, 29)); header[9] = 0;
    expect(() => characterizeRasterHeader(joinBytes(bytes.slice(0, 8), pngChunk("IHDR", header), palette, bytes.slice(33)), textContext)).toThrow();
    header[9] = 3;
    expect(() => characterizeRasterHeader(joinBytes(bytes.slice(0, 8), pngChunk("IHDR", header), bytes.slice(33)), textContext)).toThrow();
  });
  it("uses existing media/work budgets, preserves input and checks cancellation", () => {
    const bytes = rasterPng(), before = new Uint8Array(bytes);
    characterizeRasterHeader(bytes, textContext); expect(bytes).toEqual(before);
    for (const budget of [new DocumentBudget({ embeddedMediaBytes: bytes.length - 1 }, textContext.signal), new DocumentBudget({ work: 1 }, textContext.signal)]) expect(() => characterizeRasterHeader(bytes, { ...textContext, budget })).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
    const controller = new AbortController(); controller.abort(); expect(() => characterizeRasterHeader(bytes, { ...textContext, signal: controller.signal })).toThrowError(expect.objectContaining({ code: "cancelled" }));
  });
});
