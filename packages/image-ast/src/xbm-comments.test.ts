import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readImageMetadataFromSource } from "./codecs/metadata-source.js";
import { isXbmBytes, isXbmSource } from "./codecs/xbm.js";

it.each([`/* ${"bitmap ".repeat(1000)}*/\n`, "// icon\n", "// icon\r\n/* tile */\n"])("reads metadata and pixels after comments", async comment => {
  const bytes = new TextEncoder().encode(`${comment}#define tile_width 9\n#define tile_height 2\nstatic unsigned char tile_bits[] = { 0x81, 0x01, 0x02, 0x00 };`);
  const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
  const metadata = { format: "xbm", width: 9, height: 2 };
  expect(readImageMetadata(bytes)).toMatchObject(metadata);
  expect(await readImageMetadataFromSource(source, new AbortController().signal)).toMatchObject(metadata);
  const pixels = decodeImage(bytes).data.filter((_, index) => index % 4 === 0);
  expect(Buffer.from(pixels).toString("hex")).toBe("00ffffffffffff0000ff00ffffffffffffff");
});

it.each(["/* unfinished", "// no header", "/* done */", "// icon\n#defineSomething 1", "// icon\n#define"])("rejects incomplete comment-prefixed signatures", async input => {
  const bytes = new TextEncoder().encode(input);
  const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
  expect(isXbmBytes(bytes)).toBe(false);
  expect(await isXbmSource(source, new AbortController().signal)).toBe(false);
});

it("honors cancellation and rejects truncated source reads during detection", async () => {
  const source = { size: 5000, async read() { return new Uint8Array(); } };
  await expect(isXbmSource(source, new AbortController().signal)).rejects.toThrow("Truncated XBM source");
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await expect(isXbmSource(source, controller.signal)).rejects.toThrow("cancelled");
});
