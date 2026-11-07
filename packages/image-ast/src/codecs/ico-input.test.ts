import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeImage, readImageMetadata } from "./index.js";
import { decodeImageToStorage } from "./source-decode.js";
import { readImageMetadataFromSource } from "./metadata-source.js";

function dibIcon(bits = 32, width = 2) {
  const palette = bits <= 8 ? 2 ** bits * 4 : 0, stride = Math.ceil(width * bits / 32) * 4;
  const bytes = new Uint8Array(22 + 40 + palette + stride + Math.ceil(width / 32) * 4), view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true); view.setUint16(4, 1, true); bytes[6] = width % 256; bytes[7] = 1;
  view.setUint32(14, bytes.length - 22, true); view.setUint32(18, 22, true);
  view.setUint32(22, 40, true); view.setInt32(26, width, true); view.setInt32(30, 2, true); view.setUint16(34, 1, true); view.setUint16(36, bits, true);
  const pixel = 62 + palette;
  if (bits <= 8) { bytes[66] = 255; bytes[pixel] = bits === 1 ? 128 : bits === 4 ? 16 : 1; }
  else { bytes[pixel] = 255; bytes[pixel + bits / 8 + 2] = 255; }
  bytes[pixel + stride] = 64;
  return bytes;
}

it.each([1, 4, 8, 24, 32])("decodes %i-bit DIB palettes, zero-alpha legacy pixels and AND masks", async bits => {
  const bytes = dibIcon(bits), expected = decodeImage(bytes);
  expect([...expected.data.slice(0, 4)]).toEqual([0, 0, 255, 255]);
  expect(expected.data[7]).toBe(0);
  const signal = new AbortController().signal, storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal });
  const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.slice(offset, offset + length); } };
  try {
    expect(await readImageMetadataFromSource(source, signal)).toEqual(readImageMetadata(bytes));
    const stored = await decodeImageToStorage(source, storage, signal);
    expect(await storage.read(stored.position, expected.data.length)).toEqual(expected.data);
  } finally { await storage.close(); }
});

it("interprets a zero directory dimension as 256 and enforces pixel and page limits", () => {
  const bytes = dibIcon(32, 256);
  expect(decodeImage(bytes).width).toBe(256);
  expect(() => decodeImage(bytes, { limitInputPixels: 255 })).toThrow();
  for (const page of [-1, 1, 0.5]) expect(() => decodeImage(bytes, { page })).toThrow("page out of range");
});

it("rejects truncated directories, invalid payload ranges and mismatched DIB dimensions", () => {
  const bytes = dibIcon();
  for (const length of [6, 21, bytes.length - 1]) expect(() => decodeImage(bytes.slice(0, length))).toThrow();
  for (const [offset, value] of [[18, 0], [18, 0xffffffff], [26, 3], [30, 1000], [22, 0xffffffff]]) {
    const bad = bytes.slice(); new DataView(bad.buffer).setUint32(offset!, value!, true);
    expect(() => decodeImage(bad)).toThrow();
  }
});
