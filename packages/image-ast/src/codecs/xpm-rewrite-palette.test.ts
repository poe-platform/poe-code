import { expect, it } from "vitest";
import { readXpmImage } from "./xpm.js";
import { encodeXpmImage, encodeXpmFromStorage } from "./xpm-output.js";

it("rewrites duplicate and unused palette indices across bounded storage chunks", async () => {
  const row = "bab".repeat(1400);
  const input = new TextEncoder().encode(`/* XPM */\nstatic char *icon[] = {"${row.length} 1 3 1", "a c blue", "b c blue", ". c white", "${row}"};`);
  const image = readXpmImage(input), indices = image.pngIndices!;
  const expected = encodeXpmImage(image), chunks: Uint8Array[] = [];
  for await (const chunk of encodeXpmFromStorage({ ...image, position: 0, storedPngIndices: { position: image.data.length, width: image.width, height: image.height } }, {
    allocate() { throw new Error("Unexpected allocation"); },
    async read(position, length) {
      expect(length).toBeLessThanOrEqual(4096);
      return position >= image.data.length ? indices.slice(position - image.data.length, position - image.data.length + length) : image.data.slice(position, position + length);
    },
    async write() { throw new Error("Unexpected write"); }
  }, new AbortController().signal)) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected));
  const rewritten = readXpmImage(expected);
  expect(rewritten.data).toEqual(image.data);
  expect(rewritten.indexedColors).toEqual(image.indexedColors);
  expect(rewritten.pngIndices).toEqual(indices);
});
