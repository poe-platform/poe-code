import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readXbmFromSource } from "./codecs/xbm.js";

it("rejects a const-qualified XBM declaration before reading pixels or metadata", async () => {
  const bytes = new TextEncoder().encode("#define tile_width 9\n#define tile_height 2\nstatic const unsigned char tile_bits[] = { 0x81, 0x01, 0x02, 0x00 };");
  expect(() => decodeImage(bytes)).toThrow("improper image header");
  expect(() => readImageMetadata(bytes)).toThrow("improper image header");
  const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
  await expect(readXbmFromSource(source, undefined, new AbortController().signal)).rejects.toThrow("improper image header");
});

it("allows const in XBM comments and bitmap identifiers", () => {
  const bytes = new TextEncoder().encode("#define const_width 1\n#define const_height 1\nstatic /* const */ unsigned char const_bits[] = { 0x01 };");
  expect([...decodeImage(bytes).data]).toEqual([0, 0, 0, 255]);
});
