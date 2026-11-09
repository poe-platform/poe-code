import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {decodeNetpbmImage} from "./netpbm.js";
import {decodeNetpbmToStorage} from "./netpbm-storage.js";

for (const magic of ["P2", "P5"]) {
  it(`rejects zero ${magic} maxval in both decoder paths`, async () => {
    const bytes = Buffer.concat([Buffer.from(`${magic}\n3 1\n0\n`), magic === "P2" ? Buffer.from("1 2 3\n") : Buffer.from([1, 2, 3])]);
    expect(() => decodeNetpbmImage(bytes)).toThrow("Invalid Netpbm maxval");
    const signal = new AbortController().signal;
    const storage = new PagedStorage({fs: new MemoryFileSystem(), cwd: "/", env: {}, signal}, 1);
    try {
      await expect(decodeNetpbmToStorage({size: bytes.length, async read(position, length) {return bytes.subarray(position, position + length);}}, storage, signal)).rejects.toThrow("Invalid Netpbm maxval");
    } finally {await storage.close();}
  });
}
