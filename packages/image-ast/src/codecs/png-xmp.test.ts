import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { decodeImage, encodeImage, readImageMetadata } from "./index.js";
import { makeChunk } from "./png-chunks.js";
import type { RgbaImage } from "../ast.js";

const raster: RgbaImage = { width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true };
const profile = Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/">雪</x:xmpmeta>\n');
const png = encodeImage(raster, { format: "png" }).data;
const withChunk = (chunk: Uint8Array) => new Uint8Array(Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]));

for (const type of ["tEXt", "zTXt", "iTXt"] as const) {
  it(`reads and rewrites exact XMP bytes from ${type}`, () => {
    const raw = Buffer.from(`\nxmp\n${profile.length}\n${profile.toString("hex")}\n`);
    const chunk = type === "iTXt"
      ? makeChunk(type, Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\0\0\0\0"), profile]))
      : makeChunk(type, Buffer.concat([Buffer.from(`Raw profile type xmp\0${type === "zTXt" ? "\0" : ""}`), type === "zTXt" ? deflateSync(raw) : raw]));
    const input = withChunk(chunk);
    expect(readImageMetadata(input).xmp).toEqual(new Uint8Array(profile));
    const image = decodeImage(input);
    expect(image.xmp).toEqual(new Uint8Array(profile));
    expect(readImageMetadata(encodeImage(image, { format: "png" }).data).xmp).toEqual(new Uint8Array(profile));
  });
}

it("reads compressed standard XMP without altering bytes", () => {
  const input = withChunk(makeChunk("iTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\x01\0\0\0"), deflateSync(profile)])));
  expect(readImageMetadata(input).xmp).toEqual(new Uint8Array(profile));
});

it.each(["999999999999999999", "-1", "NaN", "1.5", "0x1", "2"])("ignores raw XMP with invalid length %s", length => {
  const input = withChunk(makeChunk("tEXt", Buffer.from(`Raw profile type xmp\0\nxmp\n${length}\n61\n`)));
  expect(readImageMetadata(input).xmp).toBeUndefined();
});

it("ignores non-hex raw XMP without losing the image", () => {
  const input = withChunk(makeChunk("tEXt", Buffer.from("Raw profile type xmp\0\nxmp\n2\n61zz\n")));
  expect(readImageMetadata(input).xmp).toBeUndefined();
  expect(decodeImage(input).data).toEqual(raster.data);
});
