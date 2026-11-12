import { expect, it } from "vitest";
import { decodeImage } from "../index.js";

function render(attributes: string) {
  return decodeImage(new TextEncoder().encode(`<svg width="30" height="24"><text x="5" y="18" font-size="18" ${attributes}>I</text></svg>`));
}

it("outlines bitmap text while retaining its fill", () => {
  const image = render('fill="blue" stroke="lime" stroke-width="0.5"');
  const pixels = Array.from({ length: image.width * image.height }, (_, index) => Array.from(image.data.slice(index * 4, index * 4 + 4)));
  expect(pixels.some(([r, g, b]) => r === 0 && g! > 0 && b! < 255)).toBe(true);
  expect(pixels).toContainEqual([0, 0, 255, 255]);
});

it("renders outlines without fill and respects stroke opacity", () => {
  const image = render('fill="none" stroke="lime" stroke-opacity="0.5" stroke-width="2"');
  expect(Math.max(...image.data.filter((_, index) => index % 4 === 3))).toBe(128);
  expect(image.data.some((value, index) => index % 4 === 1 && value === 255)).toBe(true);
});

it("keeps absent, transparent and zero-width strokes identical", () => {
  const plain = render('fill="blue"');
  for (const attributes of ['stroke="none"', 'stroke="lime" stroke-opacity="0"', 'stroke="lime" stroke-width="0"']) {
    expect(render(`fill="blue" ${attributes}`).data).toEqual(plain.data);
  }
});

it("moves text outlines with the glyph transform", () => {
  const plain = render('fill="none" stroke="lime"');
  const shifted = render('fill="none" stroke="lime" transform="translate(2 1)"');
  expect(plain.data.some(value => value !== 0)).toBe(true);
  for (let y = 0; y < 23; y++) for (let x = 0; x < 28; x++) {
    expect(shifted.data.slice(((y + 1) * 30 + x + 2) * 4, ((y + 1) * 30 + x + 3) * 4))
      .toEqual(plain.data.slice((y * 30 + x) * 4, (y * 30 + x + 1) * 4));
  }
});
