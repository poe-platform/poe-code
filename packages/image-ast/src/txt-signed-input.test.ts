import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readTxtFromSource } from "./codecs/txt.js";

// ImageMagick 7.1.2-35 Q16-HDRI: txt:- -depth 8 rgba:-.
it.each([
  ["1,+2,3", [1, 3, 0, 255]],
  ["1,-2,3", [1, 3, 0, 255]],
  ["-1,2,3", [2, 3, 0, 255]],
  ["1,2,-3", [1, 2, 0, 255]],
  ["+1,+2,+3", [0, 0, 0, 255]],
  ["1, -2, 3", [1, 3, 0, 255]],
  ["1,-0.1%,3", [1, 3, 0, 255]],
  ["1,+2.5,3", [1, 3, 0, 255]],
  ["1,2,3", [1, 2, 3, 255]],
  ["1,2e+1,3", [1, 20, 3, 255]],
  ["1,2e-1,3", [1, 0, 3, 255]],
] as const)("reads signed TXT tuple (%s) through buffered and stored decoders", async (tuple, samples) => {
  const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,0,255,srgb\n0,0: (${tuple})\n`);
  const expected = Uint8Array.from(samples);
  expect(decodeImage(bytes).data).toEqual(expected);
  expect(readImageMetadata(bytes)).toMatchObject({ width: 1, height: 1, channels: 3 });
  const memory = new Uint8Array(4);
  const stored = await readTxtFromSource({
    size: bytes.length,
    async read(position, length) { return bytes.subarray(position, position + length); },
  }, {
    allocate() { return 0; },
    async write(position, chunk) { memory.set(chunk, position); },
    async read(position, length) { return memory.slice(position, position + length); },
  }, new AbortController().signal);
  expect(stored.position).toBe(0);
  expect(memory).toEqual(expected);
});
