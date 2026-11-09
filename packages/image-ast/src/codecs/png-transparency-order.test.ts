import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { makeChunk, PNG_SIGNATURE } from "./png-chunks.js";
import { readPngMetadata } from "./png.js";
import { decodePngImage, decodePngToCanvas } from "./png.js";
import { decodePngToStorage } from "./png-storage.js";

for (const color of [0, 2, 3]) {
  for (const placement of ["valid", "late", "none", ...(color === 3 ? ["before-palette"] : [])]) {
    it(`handles ${placement} transparency for PNG color ${color}`, async () => {
      const key = makeChunk("tRNS", Uint8Array.from(color === 3 ? [0, 128] : color === 0 ? [0, 17] : [0, 17, 0, 34, 0, 51]));
      const png = Buffer.concat([
        PNG_SIGNATURE,
        makeChunk("IHDR", Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 1, 8, color, 0, 0, 0)),
        ...(placement === "before-palette" ? [key] : []),
        ...(color === 3 ? [makeChunk("PLTE", Uint8Array.of(17, 34, 51, 68, 85, 102))] : []),
        ...(placement === "valid" ? [key] : []),
        makeChunk("IDAT", deflateSync(Uint8Array.from(color === 3 ? [0, 0, 1] : color === 0 ? [0, 17, 68] : [0, 17, 34, 51, 68, 85, 102]))),
        ...(placement === "late" ? [key] : []),
        makeChunk("IEND", new Uint8Array())
      ]);
      const valid = placement === "valid";
      const expected = Uint8Array.of(17, color === 0 ? 17 : 34, color === 0 ? 17 : 51, valid ? 0 : 255,
        68, color === 0 ? 68 : 85, color === 0 ? 68 : 102, valid && color === 3 ? 128 : 255);
      const metadata = readPngMetadata(png);
      expect(metadata.hasAlpha).toBe(valid);
      expect(metadata.channels).toBe(color === 0 ? valid ? 2 : 1 : valid ? 4 : 3);
      expect(metadata.decodeWarnings ?? []).toEqual(placement === "late" || placement === "before-palette" ? ["tRNS: out of place"] : []);
      expect(decodePngImage(png).data).toEqual(expected);
      if (color === 2 && !valid) {
        const canvas = {...decodePngImage(png), data: new Uint8Array(8)};
        expect(decodePngToCanvas(png, canvas, 0, 0)).toBeDefined();
        expect(canvas.data).toEqual(expected);
      }
      const signal = new AbortController().signal;
      const storage = new PagedStorage({fs: new MemoryFileSystem(), cwd: "/", env: {}, signal}, 1);
      try {
        const image = await decodePngToStorage({size: png.length, read: async (offset, length) => png.slice(offset, offset + length)}, storage, signal);
        expect(await storage.read(image.position, 8)).toEqual(expected);
        expect(image.hasAlpha).toBe(valid);
        expect(image.decodeWarnings).toEqual(metadata.decodeWarnings);
      } finally { await storage.close(); }
    });
  }
}
