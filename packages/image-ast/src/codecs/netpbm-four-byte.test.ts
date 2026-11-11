import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {decodeNetpbmImage, readNetpbmMetadata} from "./netpbm.js";
import {decodeNetpbmToStorage} from "./netpbm-storage.js";

function ppm(maxval: number, samples: number[]): Buffer {
  const sampleBytes = maxval > 65535 ? 4 : 2;
  const raster = Buffer.alloc(samples.length * sampleBytes);
  samples.forEach((value, index) => raster.writeUIntBE(value, index * sampleBytes, sampleBytes));
  return Buffer.concat([Buffer.from(`P6\n${samples.length / 3} 1\n${maxval}\n`), raster]);
}

for (const mode of ["buffered", "storage"] as const) {
  it.each([65535, 65536, 131071, 4294967295])(`${mode}: decodes all P6 components at MAXVAL %i`, async maxval => {
    const pixels = [[0, Math.floor(maxval / 2), maxval], [maxval, 1, 0]];
    // Cross both source-page and output-chunk boundaries.
    const samples = Array.from({length: 1026}, (_, index) => pixels[index % 2]!).flat();
    const bytes = ppm(maxval, samples);
    const expected = samples.flatMap((sample, index) => [Math.round(sample * 65535 / maxval), ...(index % 3 === 2 ? [65535] : [])]);
    if (mode === "buffered") {
      expect(Array.from(decodeNetpbmImage(bytes).data16!)).toEqual(expected);
      return;
    }
    const signal = new AbortController().signal;
    const storage = new PagedStorage({fs: new MemoryFileSystem(), cwd: "/", env: {}, signal}, 1);
    try {
      const image = await decodeNetpbmToStorage({size: bytes.length, async read(position, length) {return bytes.subarray(position, position + length);}}, storage, signal);
      const raw = await storage.read(image.storedData16!.position, expected.length * 2);
      expect(Array.from(new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2))).toEqual(expected);
    } finally {await storage.close();}
  });

  it(`${mode}: locates the frame after a four-byte P6 raster`, async () => {
    const bytes = Buffer.concat([ppm(65536, [32768, 32768, 32768]), ppm(65535, [65535, 0, 0])]);
    if (mode === "buffered") {
      expect(readNetpbmMetadata(bytes).pages).toBe(2);
      expect(Array.from(decodeNetpbmImage(bytes, 1).data)).toEqual([255, 0, 0, 255]);
      return;
    }
    const signal = new AbortController().signal;
    const storage = new PagedStorage({fs: new MemoryFileSystem(), cwd: "/", env: {}, signal}, 1);
    try {
      const image = await decodeNetpbmToStorage({size: bytes.length, async read(position, length) {return bytes.subarray(position, position + length);}}, storage, signal, {page: 1});
      expect(Array.from(await storage.read(image.position, 4))).toEqual([255, 0, 0, 255]);
    } finally {await storage.close();}
  });

  it(`${mode}: rejects an incomplete four-byte P6 raster`, async () => {
    const bytes = ppm(65536, [32768, 32768, 32768]).subarray(0, -1);
    if (mode === "buffered") {
      expect(() => decodeNetpbmImage(bytes)).toThrow("Truncated PPM raster");
      return;
    }
    const signal = new AbortController().signal;
    const storage = new PagedStorage({fs: new MemoryFileSystem(), cwd: "/", env: {}, signal}, 1);
    try {
      await expect(decodeNetpbmToStorage({size: bytes.length, async read(position, length) {return bytes.subarray(position, position + length);}}, storage, signal)).rejects.toThrow("Truncated PPM raster");
    } finally {await storage.close();}
  });
}
