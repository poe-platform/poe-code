import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { decodePngToCanvas, encodePngImage } from "./png.js";

it.each(["duplicate header", "missing end"])("rejects %s before changing the canvas", problem => {
  const canvas: RgbaImage = {
    width: 1, height: 1, data: Uint8Array.of(17, 34, 51, 255),
    format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
  };
  const original = encodePngImage({ ...canvas, data: Uint8Array.of(255, 0, 0, 255) });
  const input = problem === "missing end" ? original.subarray(0, -12)
    : Uint8Array.from([...original.subarray(0, 33), ...original.subarray(8)]);
  expect(() => decodePngToCanvas(input, canvas, 0, 0)).toThrow("PNG");
  expect(canvas.data).toEqual(Uint8Array.of(17, 34, 51, 255));
});
