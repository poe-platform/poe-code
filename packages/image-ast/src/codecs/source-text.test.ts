import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { decodeImage, encodeImage, readImageMetadata } from "./index.js";
import { makeChunk } from "./png-chunks.js";
import type { RgbaImage } from "../ast.js";

const raster: RgbaImage = { width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true };

it("reads Latin-1, compressed and international PNG text, including after IDAT", () => {
  const png = encodeImage(raster, { format: "png" }).data;
  const input = Buffer.concat([
    png.subarray(0, -12),
    makeChunk("tEXt", Buffer.from("label\0caf\xe9", "latin1")),
    makeChunk("zTXt", Buffer.concat([Buffer.from("comment\0\0"), deflateSync(Buffer.from("old-note"))])),
    makeChunk("iTXt", Buffer.concat([Buffer.from("asset\0\x01\0en\0Asset\0"), deflateSync(Buffer.from("雪"))])),
    png.subarray(-12)
  ]);
  const properties = { label: "café", comment: "old-note", asset: "雪" };
  expect(readImageMetadata(input).properties).toEqual(properties);
  const decoded = decodeImage(input);
  expect(decoded.properties).toEqual(properties);
  expect(readImageMetadata(encodeImage(decoded, { format: "png" }).data).properties).toEqual(properties);
});

for (const format of ["png", "jpeg", "gif", "tiff"] as const) {
  it.each(["hi", "comment".repeat(100)])(`preserves short and multi-block comments in ${format}`, comment => {
    const bytes = encodeImage({ ...raster, properties: { comment } }, { format }).data;
    expect(readImageMetadata(bytes).properties?.comment).toBe(comment);
    const decoded = decodeImage(bytes);
    expect(decoded.properties?.comment).toBe(comment);
    expect(readImageMetadata(encodeImage(decoded, { format: "png" }).data).properties?.comment).toBe(comment);
  });
}

it("keeps UTF-8 characters intact across JPEG comment segments", () => {
  const comment = "雪".repeat(22000);
  const bytes = encodeImage({ ...raster, properties: { comment } }, { format: "jpeg" }).data;
  expect(readImageMetadata(bytes).properties?.comment).toBe(comment);
});
