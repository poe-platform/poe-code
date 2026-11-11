import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeImage, readImageMetadata } from "./index.js";
import { decodeImageToStorage } from "./source-decode.js";
import { readImageMetadataFromSource } from "./metadata-source.js";

function tga(width: number, height: number, payload: number[], rle = false, descriptor = 0x30): Uint8Array {
  const header = new Uint8Array(18), view = new DataView(header.buffer);
  header[2] = rle ? 10 : 2; view.setUint16(12, width, true); view.setUint16(14, height, true);
  header[16] = 24; header[17] = descriptor;
  return Uint8Array.from([...header, ...payload]);
}

for (const retained of [false, true]) {
  async function decode(bytes: Uint8Array, limitInputPixels?: number) {
    if (!retained) return decodeImage(bytes, { limitInputPixels });
    const signal = new AbortController().signal;
    const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal });
    const source = { size: bytes.length, async read(position: number, length: number) { return bytes.slice(position, position + length); } };
    try {
      expect(await readImageMetadataFromSource(source, signal)).toEqual(readImageMetadata(bytes));
      const image = await decodeImageToStorage(source, storage, signal, { limitInputPixels });
      return { ...image, data: await storage.read(image.position, image.width * image.height * 4) };
    } finally { await storage.close(); }
  }

  for (const rle of [false, true]) {
    for (const descriptor of [0, 16, 32, 48]) {
      it(`reads grayscale packets and origin (${retained}, ${rle}, ${descriptor})`, async () => {
        const bytes = tga(3, 2, rle ? [0x82, 76, 2, 150, 29, 216] : [76, 76, 76, 150, 29, 216], rle, descriptor);
        bytes[2] = rle ? 11 : 3; bytes[16] = 8;
        const rows = [[76, 76, 76], [150, 29, 216]];
        if (!(descriptor & 32)) rows.reverse();
        if (descriptor & 16) rows.forEach(row => row.reverse());
        const image = await decode(bytes);
        expect(image).toMatchObject({ channels: 1, hasAlpha: false, space: "b-w", depth: "uchar" });
        expect(image.data).toEqual(Uint8Array.from(rows.flat().flatMap(gray => [gray, gray, gray, 255])));
      });
    }
  }

  for (const rle of [false, true]) {
    for (const alpha of [false, true]) {
      it(`reads packed RGB555 pixels and alpha (${retained}, ${rle}, ${alpha})`, async () => {
        const bytes = tga(3, 1, rle ? [0x81, 0x04, 0xc1, 0, 0x1f, 0] : [0x04, 0xc1, 0x04, 0xc1, 0x1f, 0], rle, alpha ? 0x31 : 0x30);
        bytes[16] = 16;
        const image = await decode(bytes);
        expect(image).toMatchObject({ channels: alpha ? 4 : 3, hasAlpha: alpha });
        expect(image.data).toEqual(Uint8Array.from([0, 0, 255, alpha ? 0 : 255, 132, 66, 33, 255, 132, 66, 33, 255]));
      });
    }
    it(`rejects truncated packed TGA pixels (${retained}, ${rle})`, async () => {
      const bytes = tga(1, 1, rle ? [0x80, 0] : [0], rle);
      bytes[16] = 16;
      await expect(decode(bytes)).rejects.toThrow("Truncated TGA pixels");
    });
  }

  for (const [name, payload] of [["packet", []], ["pixel", [0x80]], ["oversized run", [0x81, 76]]] as const) {
    it(`rejects malformed grayscale RLE ${name} (${retained})`, async () => {
      const bytes = tga(1, 1, [...payload], true);
      bytes[2] = 11; bytes[16] = 8;
      await expect(decode(bytes)).rejects.toThrow("TGA");
    });
  }

  it(`reads right-origin 24-bit pixels across bounded spans (${retained})`, async () => {
    const pixels = Array.from({ length: 1025 }, (_, i) => [i % 256, 10, 20]);
    const image = await decode(tga(1025, 1, pixels.flat()));
    expect(image.data).toEqual(Uint8Array.from(pixels.reverse().flatMap(([b, g, r]) => [r!, g!, b!, 255])));
  });

  it(`reads an RLE packet crossing rows (${retained})`, async () => {
    const image = await decode(tga(2, 2, [0x82, 1, 2, 3, 0, 4, 5, 6], true, 0));
    expect(image.data).toEqual(Uint8Array.from([3, 2, 1, 255, 6, 5, 4, 255, 3, 2, 1, 255, 3, 2, 1, 255]));
  });

  for (const [name, bytes] of [
    ["raw pixels", tga(1, 1, [1, 2])],
    ["RLE header", tga(1, 1, [], true)],
    ["RLE pixels", tga(1, 1, [0x80, 1, 2], true)],
    ["oversized RLE run", tga(1, 1, [0x81, 1, 2, 3], true)]
  ] as const) {
    it(`rejects malformed ${name} (${retained})`, async () => {
      await expect(decode(bytes)).rejects.toThrow(/TGA/);
    });
  }

  it(`checks the pixel limit before decoding (${retained})`, async () => {
    await expect(decode(tga(2, 2, []), 3)).rejects.toThrow("pixel limit");
  });
}
