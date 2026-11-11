import { expect, it } from "vitest";
import { readXpmImage } from "./xpm.js";
import type { RgbaImage } from "../ast.js";
import { encodeXpmImage, encodeXpmFromStorage } from "./xpm-output.js";

it("uses multi-character keys across bounded pixel chunks", async () => {
  const image: RgbaImage = { width: 1100, height: 2, data: Uint8Array.from(Array.from({ length: 2200 }, (_, i) => [i % 256, Math.floor(i / 256), 12, 255]).flat()), format: "raw", space: "srgb", channels: 4, depth: "uchar", hasAlpha: false, density: 72 };
  const expected = encodeXpmImage(image), chunks: Uint8Array[] = [];
  for await (const chunk of encodeXpmFromStorage({ ...image, position: 0 }, {
    allocate() { throw new Error("Unexpected allocation"); },
    async read(position, length) { expect(length).toBeLessThanOrEqual(4096); return image.data.slice(position, position + length); },
    async write() { throw new Error("Unexpected write"); },
  }, new AbortController().signal)) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected));
  const strings = new TextDecoder().decode(expected).split("\n").filter(line => line.startsWith('"')).map(line => line.slice(1, line.lastIndexOf('"')));
  expect(strings[0]).toBe("1100 2 2200 2 ");
  const palette = new Map(strings.slice(1, 2201).map(line => [line.slice(0, 2), line.slice(5)]));
  expect(palette.size).toBe(2200);
  for (let y = 0; y < 2; y++) {
    const row = strings[2201 + y]!;
    expect(row.length).toBe(2200);
    for (let x = 0; x < 1100; x++) {
      const i = y * 1100 + x;
      expect(palette.get(row.slice(x * 2, x * 2 + 2))).toBe(`#${(i % 256).toString(16).padStart(2, "0")}${Math.floor(i / 256).toString(16).padStart(2, "0")}0c`.toUpperCase());
    }
  }
});

it.each([63, 64, 65, 70, 90, 92, 93, 100])("preserves pixels with native XPM symbol widths for %i colors", colors => {
  const image: RgbaImage = { width: colors, height: 1,
    data: Uint8Array.from(Array.from({ length: colors }, (_, i) => [3 * i % 256, i, 255 - i, 255]).flat()),
    format: "raw", space: "srgb", channels: 4, depth: "uchar", hasAlpha: false, density: 72 };
  const bytes = encodeXpmImage(image);
  expect(new TextDecoder().decode(bytes).split("\n")[3]).toBe(`"${colors} 1 ${colors} ${colors <= 92 ? 1 : 2} ",`);
  expect(readXpmImage(bytes).data).toEqual(image.data);
});
