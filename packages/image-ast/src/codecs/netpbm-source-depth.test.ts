import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeNetpbmImage, readNetpbmMetadata } from "./netpbm.js";
import { decodeNetpbmToStorage } from "./netpbm-storage.js";
import { readImageMetadataFromSource } from "./metadata-source.js";

for (const magic of ["P2", "P3", "P5", "P6", "P7"]) {
  it.each([[1, 1], [2, 2], [15, 4], [31, 5], [255, 8], [256, 9], [511, 9], [1023, 10], [65535, 16]])(
    `${magic} retains MAXVAL %i as %i-bit source depth in metadata and decoded images`, async (maxval, bitsPerSample) => {
      const channels = magic === "P2" || magic === "P5" ? 1 : 3;
      const header = magic === "P7"
        ? `P7\nWIDTH 1\nHEIGHT 1\nDEPTH 3\nMAXVAL ${maxval}\nTUPLTYPE RGB\nENDHDR\n`
        : `${magic}\n1 1\n${maxval}\n`;
      const bytes = Buffer.concat([Buffer.from(header), magic === "P2" || magic === "P3"
        ? Buffer.from(Array(channels).fill(0).join(" ") + "\n") : Buffer.alloc(channels * (maxval > 255 ? 2 : 1))]);
      const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
      const expected = { bitsPerSample, depth: maxval > 255 ? "ushort" : "uchar", channels, hasAlpha: false };
      const signal = new AbortController().signal;
      const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal }, 1);
      try {
        expect(readNetpbmMetadata(bytes)).toMatchObject(expected);
        expect(decodeNetpbmImage(bytes)).toMatchObject(expected);
        expect(await readImageMetadataFromSource(source, signal)).toMatchObject(expected);
        expect(await decodeNetpbmToStorage(source, storage, signal)).toMatchObject(expected);
      } finally { await storage.close(); }
    }
  );
}
