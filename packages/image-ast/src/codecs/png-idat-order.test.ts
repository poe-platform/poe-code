import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { makeChunk, PNG_SIGNATURE } from "./png-chunks.js";
import { decodePngImage, decodePngToCanvas } from "./png.js";

for (const decode of ["image", "canvas"] as const) {
  it.each(["consecutive", "text", "bad-crc", "unknown"])(`checks IDAT ordering across %s chunks (${decode})`, separator => {
    const compressed = deflateSync(Uint8Array.of(0, 17, 34, 51, 255));
    const extra = makeChunk(separator === "unknown" ? "aBCD" : "tEXt", new TextEncoder().encode("Note\0x"));
    if (separator === "bad-crc") extra[extra.length - 1]! ^= 1;
    const png = Buffer.concat([
      PNG_SIGNATURE,
      makeChunk("IHDR", Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0)),
      makeChunk("IDAT", compressed),
      ...(separator === "consecutive" ? [] : [extra]),
      makeChunk("IDAT", new Uint8Array()),
      makeChunk("IEND", new Uint8Array())
    ]);
    const canvas: RgbaImage = {
      width: 1, height: 1, data: new Uint8Array(4),
      format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
    };
    const run = () => decode === "image" ? decodePngImage(png) : decodePngToCanvas(png, canvas, 0, 0);
    if (separator === "consecutive") {
      const result = run();
      expect(result).toBeDefined();
      expect(decode === "image" ? (result as RgbaImage).data : canvas.data).toEqual(Uint8Array.of(17, 34, 51, 255));
    } else {
      expect(run).toThrow("PNG IDAT chunks must be consecutive");
      expect(canvas.data).toEqual(new Uint8Array(4));
    }
  });
}
