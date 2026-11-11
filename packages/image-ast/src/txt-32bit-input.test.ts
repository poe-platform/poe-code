import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readTxtFromSource } from "./codecs/txt.js";

it.each([false, true])("preserves 32-bit TXT color and alpha across storage chunks (reordered=%s)", async reordered => {
  const count = 1025;
  const rows = Array.from({ length: count }, (_, y) => `0,${y}: (${y + 1},4294967295,0,1)\n`);
  if (reordered) rows.reverse();
  const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,${count},0,4294967295,srgba\n` + rows.join(""));
  const metadata = { depth: "uint", bitsPerSample: 32, channels: 4, hasAlpha: true };
  expect(readImageMetadata(bytes)).toMatchObject(metadata);
  const decoded = decodeImage(bytes);
  expect(decoded).toMatchObject(metadata);
  const expected = Float64Array.from(Array.from({ length: count }, (_, y) => [y + 1,4294967295,0,1]).flat(), value => Math.fround(value / 65537) / 257);
  expect(decoded.evaluateSamples).toEqual(expected);
  const memory = new Uint8Array(count * 44);
  let allocated = 0;
  const stored = await readTxtFromSource({ size: bytes.length, async read(position, length) { return bytes.slice(position, position + length); } }, {
    allocate(length) { const position = allocated; allocated += length; return position; },
    async write(position, bytes) { memory.set(bytes, position); },
    async read(position, length) { return memory.slice(position, position + length); },
  }, new AbortController().signal);
  expect(stored).toMatchObject(metadata);
  expect(stored.storedEvaluateSamples).toBeDefined();
  expect(new Float64Array(memory.slice(stored.storedEvaluateSamples!, stored.storedEvaluateSamples! + count * 32).buffer)).toEqual(expected);
  expect(memory.slice(stored.position, stored.position + count * 4)).toEqual(decoded.data);
  expect(new Uint16Array(memory.slice(stored.storedData16!.position, stored.storedData16!.position + count * 8).buffer)).toEqual(decoded.data16);
});

it.each(["4294967296", "Infinity", "NaN", "0", "-1"])("rejects invalid TXT maximum %s", maximum => {
  const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,0,${maximum},srgb\n0,0: (1,0,0)\n`);
  expect(() => decodeImage(bytes)).toThrow("Invalid TXT dimensions or maximum");
});
