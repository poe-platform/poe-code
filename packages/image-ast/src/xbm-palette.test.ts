import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readXbmFromSource } from "./codecs/xbm.js";

it.each(["unsigned char", "unsigned short"])("retains both XBM palette entries for white %s bitmaps", async declaration => {
  const bytes = new TextEncoder().encode(`#define tile_width 9\n#define tile_height 2\nstatic ${declaration} tile_bits[] = { ${declaration.endsWith("short") ? "0x0000, 0x0000" : "0x00, 0x00, 0x00, 0x00"} };`);
  const metadata = { format: "xbm", width: 9, height: 2, space: "srgb", channels: 3, depth: "uchar", bitsPerSample: 8, isPalette: true, hasAlpha: false, indexedColors: [0xffffffff, 0xff000000] };
  expect(readImageMetadata(bytes)).toMatchObject(metadata);
  expect(decodeImage(bytes)).toMatchObject({ ...metadata, data: new Uint8Array(72).fill(255) });
  const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
  const signal = new AbortController().signal;
  expect(await readXbmFromSource(source, undefined, signal)).toMatchObject(metadata);
  const pixels = new Uint8Array(72);
  const stored = await readXbmFromSource(source, {
    allocate(length) { expect(length).toBe(pixels.length); return 0; },
    async read(position, length) { return pixels.slice(position, position + length); },
    async write(position, chunk) { pixels.set(chunk, position); },
  }, signal);
  expect(stored).toMatchObject({ ...metadata, position: 0 });
  expect(pixels).toEqual(new Uint8Array(72).fill(255));
});
