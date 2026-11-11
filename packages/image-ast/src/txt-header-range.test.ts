import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readTxtFromSource } from "./codecs/txt.js";

it.each([
  [1, 1], [2, 1], [3, 2], [4, 2], [7, 3], [8, 3], [15, 4],
  [100, 7], [128, 7], [255, 8], [256, 8], [257, 9], [65535, 16]
])("derives TXT depth from maximum %s", async (maximum, bitsPerSample) => {
  const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,0,${maximum},srgb\n0,0: (1,0,0)\n`);
  const source = { size: bytes.length, async read(position: number, length: number) { return bytes.slice(position, position + length); } };
  const metadata = { bitsPerSample, depth: bitsPerSample > 8 ? "ushort" : "uchar" };
  for (const image of [decodeImage(bytes), readImageMetadata(bytes), await readTxtFromSource(source, undefined, new AbortController().signal)]) {
    expect(image).toMatchObject(metadata);
  }
});

it.each([false, true])("retains fractional Q16 samples, alpha and derived-range percentages across TXT chunks (reordered=%s)", async reordered => {
  const count = 1025;
  const rows = Array.from({ length: count }, (_, y) => `0,${y}: (1,50%,100,3)\n`);
  if (reordered) rows.reverse();
  const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,${count},0,100,srgba\n` + rows.join(""));
  const decoded = decodeImage(bytes);
  const expected = [1, 63, 100, 3].map(value => Math.fround(65535 * (value / 127)) / 257);
  expect(Array.from(decoded.evaluateSamples!.slice(0, 4))).toEqual(expected);
  expect(Array.from(decoded.evaluateSamples!.slice(-4))).toEqual(expected);
  const memory = new Uint8Array(count * 36);
  let allocated = 0;
  const stored = await readTxtFromSource({ size: bytes.length, async read(position, length) { return bytes.slice(position, position + length); } }, {
    allocate(length) { const position = allocated; allocated += length; return position; },
    async write(position, bytes) { memory.set(bytes, position); },
    async read(position, length) { return memory.slice(position, position + length); }
  }, new AbortController().signal);
  expect(memory.slice(stored.position, stored.position + count * 4)).toEqual(decoded.data);
  expect(new Float64Array(memory.slice(stored.storedEvaluateSamples!, stored.storedEvaluateSamples! + count * 32).buffer)).toEqual(decoded.evaluateSamples);
});

it("clamps integer samples at the derived range and retains each page's range", () => {
  const bytes = new TextEncoder().encode("# ImageMagick pixel enumeration: 1,1,0,256,srgba\n0,0: (256,1,0,256)\n# ImageMagick pixel enumeration: 1,1,0,100,gray\n0,0: (1)\n");
  expect(decodeImage(bytes).data).toEqual(Uint8Array.of(255, 1, 0, 255));
  expect(decodeImage(bytes, { page: 1 })).toMatchObject({ bitsPerSample: 7, evaluateSamples: Float64Array.of(...[1, 1, 1, 127].map(value => Math.fround(65535 * (value / 127)) / 257)) });
});
