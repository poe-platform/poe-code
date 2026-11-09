import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {decodeNetpbmImage} from "./netpbm.js";
import {decodeNetpbmToStorage} from "./netpbm-storage.js";

for (const magic of ["P2", "P5"]) for (const maxval of [15, 1023]) {
  it(`saturates ${magic} samples above ${maxval} in both decoder paths`, async () => {
    const samples = [0, Math.ceil(maxval / 2), maxval, maxval + 1, maxval > 255 ? 65535 : 255];
    const raster = Buffer.alloc(samples.length * (maxval > 255 ? 2 : 1));
    samples.forEach((value, index) => maxval > 255 ? raster.writeUInt16BE(value, index * 2) : raster.writeUInt8(value, index));
    const bytes = Buffer.concat([Buffer.from(`${magic}\n5 1\n${maxval}\n`), magic === "P2" ? Buffer.from(samples.join(" ")) : raster]);
    const expected = [0, maxval === 15 ? 136 : 128, 255, 255, 255].flatMap(value => [value, value, value, 255]);
    const decoded = decodeNetpbmImage(bytes);
    expect(Array.from(decoded.data)).toEqual(expected);
    const expected16 = [0, 32800, 65535, 65535, 65535].flatMap(value => [value, value, value, 65535]);
    if (maxval > 255) expect(Array.from(decoded.data16!)).toEqual(expected16);
    const signal = new AbortController().signal;
    const storage = new PagedStorage({fs: new MemoryFileSystem(), cwd: "/", env: {}, signal}, 1);
    try {
      const image = await decodeNetpbmToStorage({size: bytes.length, async read(position, length) {return bytes.subarray(position, position + length);}}, storage, signal);
      expect(Array.from(await storage.read(image.position, expected.length))).toEqual(expected);
      if (maxval > 255) {
        const raw = await storage.read(image.storedData16!.position, expected16.length * 2);
        expect(Array.from(new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2))).toEqual(expected16);
      }
    } finally {await storage.close();}
  });
}
