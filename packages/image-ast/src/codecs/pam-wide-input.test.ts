import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeNetpbmImage, readNetpbmMetadata } from "./netpbm.js";
import { decodeNetpbmToStorage } from "./netpbm-storage.js";

const header = Buffer.from("P7\nWIDTH 1\nHEIGHT 1\nDEPTH 1\nMAXVAL 65536\nTUPLTYPE GRAYSCALE\nENDHDR\n");

it("locates adjacent four-byte PAM frames and decodes selected samples in both paths", async () => {
  const bytes = Buffer.concat([header, Buffer.from("00008000", "hex"), header, Buffer.from("00010000", "hex")]);
  expect(readNetpbmMetadata(bytes)).toMatchObject({ pages: 2, bitsPerSample: 17 });
  const signal = new AbortController().signal;
  const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal }, 1);
  try {
    for (const [page, sample] of [[0, 32768], [1, 65535]] as const) {
      expect(Array.from(decodeNetpbmImage(bytes, page).data16!)).toEqual([sample, sample, sample, 65535]);
      const image = await decodeNetpbmToStorage({ size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } }, storage, signal, { page });
      const samples = await storage.read(image.storedData16!.position, 8);
      expect(Array.from(new Uint16Array(samples.slice().buffer))).toEqual([sample, sample, sample, 65535]);
    }
  } finally { await storage.close(); }
});

it.each([0, 1, 2, 3])("rejects four-byte PAM samples truncated to %i bytes", async length => {
  const bytes = Buffer.concat([header, Buffer.alloc(length)]);
  expect(() => readNetpbmMetadata(bytes)).toThrow("Truncated PAM raster");
  expect(() => decodeNetpbmImage(bytes)).toThrow("Truncated PAM raster");
  const signal = new AbortController().signal;
  const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal }, 1);
  try {
    await expect(decodeNetpbmToStorage({ size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } }, storage, signal)).rejects.toThrow("Truncated PAM raster");
  } finally { await storage.close(); }
});
