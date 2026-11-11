import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readXbmFromSource } from "./codecs/xbm.js";

it("rejects height-first XBM headers in pixel and metadata readers", async () => {
  const bytes = new TextEncoder().encode("#define tile_height 2\n#define tile_width 9\nstatic unsigned char tile_bits[] = { 0x81, 0x01, 0x02, 0x00 };");
  expect(() => decodeImage(bytes)).toThrow("XBM");
  expect(() => readImageMetadata(bytes)).toThrow("XBM");
  const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
  await expect(readXbmFromSource(source, undefined, new AbortController().signal)).rejects.toThrow("XBM");
});
