import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeImage, readImageMetadata } from "./index.js";
import { decodeImageToStorage } from "./source-decode.js";
import { readImageMetadataFromSource } from "./metadata-source.js";

function indexedTga(payload: number[], rle = false, indexDepth = 8, paletteDepth = 24, first = 7): Uint8Array {
  const header = new Uint8Array(18), view = new DataView(header.buffer);
  header[0] = 3; header[1] = 1; header[2] = rle ? 9 : 1;
  view.setUint16(3, first, true); view.setUint16(5, 2, true); header[7] = paletteDepth;
  view.setUint16(12, 2, true); view.setUint16(14, 2, true);
  header[16] = indexDepth; header[17] = paletteDepth === 32 ? 8 : 0;
  const palette = paletteDepth === 32 ? [30, 20, 10, 127, 60, 50, 40, 0] : [30, 20, 10, 60, 50, 40];
  return Uint8Array.from([...header, 65, 66, 67, ...palette, ...payload]);
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
    for (const indexDepth of [8, 16]) {
      for (const paletteDepth of [24, 32]) {
        it(`reads indexed TGA with an ID and palette offset (${retained}, ${rle}, ${indexDepth}, ${paletteDepth})`, async () => {
          const first = indexDepth === 16 ? 300 : 7;
          const index = (value: number) => indexDepth === 16 ? [value % 256, Math.floor(value / 256)] : [value];
          // The repeated packet crosses the row boundary; the last packet is raw.
          const payload = rle ? [0x82, ...index(first), 0, ...index(first + 1)]
            : [first, first, first, first + 1].flatMap(index);
          const image = await decode(indexedTga(payload, rle, indexDepth, paletteDepth, first));
          const a = [10, 20, 30, paletteDepth === 32 ? 127 : 255];
          const b = [40, 50, 60, paletteDepth === 32 ? 0 : 255];
          expect(image).toMatchObject({ width: 2, height: 2, hasAlpha: paletteDepth === 32 });
          expect(image.data).toEqual(Uint8Array.from([...a, ...b, ...a, ...a]));
        });
      }
    }
  }

  for (const [name, bytes, message] of [
    ["palette", indexedTga([]).slice(0, 26), "Truncated TGA color map"],
    ["index", indexedTga([7, 7, 7]), "Truncated TGA pixels"],
    ["16-bit index", indexedTga([7], false, 16), "Truncated TGA pixels"],
    ["index below palette", indexedTga([6, 7, 7, 7]), "TGA color map index out of range"],
    ["index past palette", indexedTga([9, 7, 7, 7]), "TGA color map index out of range"],
    ["indexed RLE packet", indexedTga([], true), "Truncated TGA packet"],
    ["indexed RLE pixels", indexedTga([0x83], true), "Truncated TGA pixels"],
    ["oversized indexed RLE run", indexedTga([0x84, 7], true), "TGA packet exceeds image dimensions"]
  ] as const) {
    it(`rejects malformed indexed ${name} (${retained})`, async () => {
      await expect(decode(bytes)).rejects.toThrow(message);
    });
  }

  it(`checks indexed pixel limits before reading the palette (${retained})`, async () => {
    await expect(decode(indexedTga([]).slice(0, 18), 3)).rejects.toThrow("pixel limit");
  });

}
