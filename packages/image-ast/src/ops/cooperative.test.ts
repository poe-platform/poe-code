import { expect, test } from "vitest";
import type { RgbaImage } from "../ast.js";
import { extractImageSteps, flipImageSteps, flopImageSteps, rotateImageSteps } from "./transform.js";

function image(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4).fill(255), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true };
}

for (const [name, operation, minimum] of [
  ["flip scanlines", () => flipImageSteps(image(256, 256)), 4],
  ["flop pixels", () => flopImageSteps(image(256, 256)), 4],
  ["crop scanlines", () => extractImageSteps(image(256, 256), { left: 0, top: 0, width: 192, height: 192 }), 2],
  ["rotate pixels", () => rotateImageSteps(image(256, 256), 90), 4],
  ["a wide scanline", () => flipImageSteps(image(100000, 1)), 6],
] as const) {
  test(`${name} counts pixel work independently of scanline count`, () => {
    const steps = operation();
    let next = steps.next();
    let turns = 0;
    while (!next.done) { turns++; next = steps.next(); }
    expect(turns).toBeGreaterThanOrEqual(minimum);
    expect(next.value.data.length).toBe(next.value.width * next.value.height * 4);
  });
}
