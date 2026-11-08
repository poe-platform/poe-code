import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { decodePngToCanvas, encodePngImage } from "./png.js";

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
