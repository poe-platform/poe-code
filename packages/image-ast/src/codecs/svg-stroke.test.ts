import { expect, test } from "vitest";
import sharp from "../index.js";

test.each([
  '<rect x="10" y="10" width="40" height="40"/>',
  '<rect x="10" y="10" width="40" height="40" rx="8"/>',
  '<ellipse cx="30" cy="30" rx="20" ry="15"/>',
  '<circle cx="30" cy="30" r="20"/>'
])("rasterizes unfilled primitive outlines: %s", async (shape) => {
  const svg = `<svg width="60" height="60">${shape.replace("/>", ' fill="none" stroke="red" stroke-width="2"/>')}</svg>`;
  const pixels = await sharp(new TextEncoder().encode(svg)).raw().toBuffer();
  const alpha = Array.from(pixels).filter((_, i) => i % 4 === 3);
  expect(alpha.filter((a) => a > 0).length).toBeGreaterThan(60);
  expect(pixels[(30 * 60 + 30) * 4 + 3]).toBe(0);
  expect(alpha.filter((a) => a > 0).length).toBeLessThan(500);
});
