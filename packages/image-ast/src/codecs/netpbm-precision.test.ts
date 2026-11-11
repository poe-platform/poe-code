import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {decodeNetpbmImage} from "./netpbm.js";
import {decodeNetpbmToStorage} from "./netpbm-storage.js";

it.each(["P2", "P3", "P5", "P6"].flatMap(magic => [65535, 1023, 2, 7].flatMap(maxval => [2, 1026].map(width => ({magic, maxval, width})))))("retains $magic samples at maxval=$maxval and width=$width in both decoder paths", async ({magic, maxval, width}) => {
  const channels = magic === "P3" || magic === "P6" ? 3 : 1;
  const values = [0x1234, 0x4567, 0x89ab, 0xcdef, 0x1379, 0x2468];
  const samples = Array.from({length: width * channels}, (_, index) => values[index % values.length]! % (maxval + 1));
  const raster = maxval > 255 ? Buffer.alloc(samples.length * 2) : Buffer.from(samples);
  if (maxval > 255) samples.forEach((value, index) => raster.writeUInt16BE(value, index * 2));
  const bytes = Buffer.concat([Buffer.from(`${magic}\n${width} 1\n${maxval}\n`), magic === "P2" || magic === "P3" ? Buffer.from(samples.join(" ")) : raster]);
  const expected = Array.from({length: width}, (_, pixel) => [...Array.from({length: 3}, (_, channel) => Math.round(samples[pixel * channels + (channels === 1 ? 0 : channel)]! * 65535 / maxval)), 65535]).flat();
  expect(Array.from(decodeNetpbmImage(bytes).data16 ?? [])).toEqual(expected);
  const signal = new AbortController().signal;
  const storage = new PagedStorage({fs: new MemoryFileSystem(), cwd: "/", env: {}, signal}, 1);
  try {
    const image = await decodeNetpbmToStorage({size: bytes.length, async read(position, length) {return bytes.subarray(position, position + length);}}, storage, signal);
    expect(image.storedData16).toBeDefined();
    const raw = await storage.read(image.storedData16!.position, expected.length * 2);
    expect(Array.from(new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2))).toEqual(expected);
  } finally {await storage.close();}
});
