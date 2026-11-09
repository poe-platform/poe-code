import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { decodePngImage, decodePngToCanvas, encodePngImage } from "./png.js";

it("preserves canvas write failures while retiring the incremental decoder", () => {
  const source: RgbaImage = {
    width: 1, height: 1, data: Uint8Array.of(1, 2, 3, 255),
    format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
  };
  const png = encodePngImage(source);
  const failure = new Error("canvas write failed");
  const data = new Proxy(new Uint8Array(4), { set() { throw failure; } });
  let caught: unknown;
  try { decodePngToCanvas(png, { ...source, data }, 0, 0); }
  catch (error) { caught = error; }
  expect(caught).toBe(failure);
});

for (const decode of ["image", "canvas"] as const) {
  it.each(["IHDR", "IDAT", "IEND"])(`rejects a damaged %s checksum before ${decode} decoding`, type => {
    const source: RgbaImage = {
      width: 1, height: 1, data: Uint8Array.of(1, 2, 3, 255),
      format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
    };
    const png = encodePngImage(source);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    for (let offset = 8; offset < png.length;) {
      const length = view.getUint32(offset);
      if (new TextDecoder().decode(png.subarray(offset + 4, offset + 8)) === type) {
        png[offset + 8 + length]! ^= 1;
        break;
      }
      offset += length + 12;
    }
    expect(() => decode === "image" ? decodePngImage(png) : decodePngToCanvas(png, source, 0, 0)).toThrow(`PNG ${type} CRC mismatch`);
    expect(source.data).toEqual(Uint8Array.of(1, 2, 3, 255));
  });
}
