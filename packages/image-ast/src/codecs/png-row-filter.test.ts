import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { makeChunk, PNG_SIGNATURE } from "./png-chunks.js";
import { decodePngImage, decodePngToCanvas } from "./png.js";

for (const mode of ["image", "canvas", "adam7"] as const) {
  it.each([0, 1, 2, 3, 4, 5, 255])(`validates row filter %s (${mode})`, filter => {
    const png = Buffer.concat([
      PNG_SIGNATURE,
      makeChunk("IHDR", Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, Number(mode === "adam7"))),
      makeChunk("IDAT", deflateSync(Uint8Array.of(filter, 17, 34, 51, 255))),
      makeChunk("IEND", new Uint8Array())
    ]);
    const canvas: RgbaImage = {
      width: 1, height: 1, data: new Uint8Array(4),
      format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
    };
    const run = () => mode === "canvas" ? decodePngToCanvas(png, canvas, 0, 0) : decodePngImage(png);
    if (filter > 4) {
      expect(run).toThrow("PNG row filter");
    } else {
      const result = run();
      expect(mode === "canvas" ? canvas.data : (result as RgbaImage).data).toEqual(Uint8Array.of(17, 34, 51, 255));
    }
  });
}
