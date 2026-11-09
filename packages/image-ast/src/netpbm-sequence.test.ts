import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readImageMetadataFromSource } from "./codecs/metadata-source.js";
import { decodeNetpbmToStorage } from "./codecs/netpbm-storage.js";

const frames = [
  { header: "P1\n4 1\n", raster: Buffer.from("0110\n"), pixels: [255,255,255,255,0,0,0,255,0,0,0,255,255,255,255,255] },
  { header: "P1\n4 1\n", raster: Buffer.from("0 2 # nonzero is black\n0 3\n"), pixels: [255,255,255,255,0,0,0,255,255,255,255,255,0,0,0,255] },
  { header: "P1\n2 1\n", raster: Buffer.from("0 # white\n1\n"), pixels: [255,255,255,255,0,0,0,255] },
  { header: "P2\n1 1\n255\n", raster: Buffer.from("17\n"), pixels: [17,17,17,255] },
  { header: "P3\n1 1\n255\n", raster: Buffer.from("255 0 0\n"), pixels: [255,0,0,255] },
  { header: "P4\n9 1\n", raster: Buffer.from([0,128]), pixels: [...Array.from({ length: 8 }, () => [255,255,255,255]).flat(),0,0,0,255] },
  { header: "P5\n1 1\n65535\n", raster: Buffer.from([255,255]), pixels: [255,255,255,255] },
  { header: "P6\n1 1\n65535\n", raster: Buffer.from([0,0,0,0,255,255]), pixels: [0,0,255,255] },
  // Header-like bytes and whitespace in the raster must not split a frame.
  { header: "P6\n2 1\n255\n", raster: Buffer.from([80,54,10,32,35,13]), pixels: [80,54,10,255,32,35,13,255] }
];
const bytes = Buffer.concat(frames.flatMap(frame => [Buffer.from(frame.header), frame.raster]));
const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };

it("counts every Netpbm variant in buffered and source metadata", async () => {
  expect(readImageMetadata(bytes).pages).toBe(frames.length);
  expect((await readImageMetadataFromSource(source, new AbortController().signal)).pages).toBe(frames.length);
});

it.each(frames.map((frame, page) => ({ ...frame, page })))("selects page $page with exact raster boundaries in both readers", async ({ page, pixels }) => {
  expect(Array.from(decodeImage(bytes, { page }).data)).toEqual(pixels);
  const memory = new Uint8Array(1024);
  let end = 0;
  const storage = {
    allocate(length: number) { const position = end; end += length; return position; },
    async write(position: number, data: Uint8Array) { memory.set(data, position); },
    async read(position: number, length: number) { return memory.slice(position, position + length); }
  };
  const image = await decodeNetpbmToStorage(source, storage, new AbortController().signal, { page });
  expect(Array.from(memory.subarray(image.position, image.position + image.width * image.height * 4))).toEqual(pixels);
});

it("rejects a page beyond the sequence", () => {
  expect(() => decodeImage(bytes, { page: frames.length })).toThrow("page out of range");
});
