import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { makeChunk } from "./png-chunks.js";
import { decodePngImage, decodePngToCanvas, encodePngImage } from "./png.js";

for (const decode of ["image", "canvas"] as const) {
  for (const placement of ["before IDAT", "after IDAT"] as const) {
    it.each(["ABCD", "aBCD"])(`handles unknown chunk %s ${placement} during ${decode} decoding`, type => {
      const source: RgbaImage = {
        width: 1, height: 1, data: Uint8Array.of(17, 34, 51, 255),
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
      };
      const original = encodePngImage(source);
      const offset = placement === "before IDAT" ? 33 : original.length - 12;
      const chunk = makeChunk(type, Uint8Array.of(120));
      const png = new Uint8Array(original.length + chunk.length);
      png.set(original.subarray(0, offset));
      png.set(chunk, offset);
      png.set(original.subarray(offset), offset + chunk.length);
      const canvas = { ...source, data: new Uint8Array(4) };
      const run = () => decode === "image" ? decodePngImage(png) : decodePngToCanvas(png, canvas, 0, 0);
      if (type === "ABCD") {
        expect(run).toThrow("PNG unhandled critical chunk ABCD");
        expect(canvas.data).toEqual(new Uint8Array(4));
      } else {
        const result = run();
        expect(result).toBeDefined();
        expect(decode === "image" ? (result as RgbaImage).data : canvas.data).toEqual(source.data);
      }
    });
  }
}
