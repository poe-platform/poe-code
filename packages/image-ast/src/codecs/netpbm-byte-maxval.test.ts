import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeNetpbmImage } from "./netpbm.js";
import { decodeNetpbmToStorage } from "./netpbm-storage.js";

// Q16 output verified against ImageMagick 7.1.2-35, including both byte-depth boundaries.
for (const magic of ["P2", "P3", "P5", "P6", "P7"]) {
  for (const [maxval, sample, scaled, binary] of [
    [127, 63, 0x7efd, 0x7efd],
    [128, 64, 0x8000, 0x4040],
    [200, 100, 0x8000, 0x6464],
    [254, 127, 0x8000, 0x7f7f],
    [255, 127, 0x7f7f, 0x7f7f],
    [256, 128, 0x8000, 0x8000]
  ] as const) {
    it(`decodes ${magic} maxval=${maxval} in buffer and storage paths`, async () => {
      const ascii = magic === "P2" || magic === "P3";
      const channels = magic === "P2" || magic === "P5" ? 1 : 3;
      const header = magic === "P7"
        ? `P7\nWIDTH 1\nHEIGHT 1\nDEPTH 3\nMAXVAL ${maxval}\nTUPLTYPE RGB\nENDHDR\n`
        : `${magic}\n1 1\n${maxval}\n`;
      const raster = maxval > 255 ? Buffer.from([sample >>> 8, sample & 255]) : Buffer.from([sample]);
      const bytes = Buffer.concat([Buffer.from(header), ascii ? Buffer.from(Array(channels).fill(sample).join(" ") + "\n") : Buffer.concat(Array(channels).fill(raster))]);
      const value = ascii ? scaled : binary;
      const expected16 = [value, value, value, 65535];
      const expected8 = expected16.map(value => Math.round(value / 257));
      const decoded = decodeNetpbmImage(bytes);
      expect(Array.from(decoded.data)).toEqual(expected8);
      expect(decoded.data16 ? Array.from(decoded.data16) : Array.from(decoded.data, value => value * 257)).toEqual(expected16);
      const signal = new AbortController().signal;
      const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal }, 1);
      try {
        const image = await decodeNetpbmToStorage({ size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } }, storage, signal);
        const pixels = await storage.read(image.position, 4);
        expect(Array.from(pixels)).toEqual(expected8);
        const samples = image.storedData16 ? await storage.read(image.storedData16.position, 8) : undefined;
        expect(samples ? Array.from(new Uint16Array(samples.slice().buffer)) : Array.from(pixels, value => value * 257)).toEqual(expected16);
      } finally { await storage.close(); }
    });
  }
}
