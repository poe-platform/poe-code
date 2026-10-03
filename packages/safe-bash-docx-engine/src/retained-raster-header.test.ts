import {storyRasterCases} from "../tests/fixtures/story-raster-variants.js";
import {invalidStoryRasters} from "../tests/fixtures/story-raster-invalid.js";
import {expect, it} from "vitest";
import {characterizeRasterHeader} from "./raster-header.js";
import {characterizeRetainedRasterHeader} from "./retained-raster-header.js";
import {rasterPng, rasterJpeg, rasterGif, rasterBmp, rasterTiff, pngChunk, joinBytes} from "../tests/fixtures/raster.js";
import {textContext} from "../tests/fixtures/text.js";
import type {ZipMetadataStorage} from "@poe-code/office-package/zip";
function storage(): ZipMetadataStorage {
  let next = 1; const bytes = new Map<number, number>();
  return {allocate(length) {const position = next; next += length; return position;}, async read(position, length) {return Uint8Array.from({length}, (_, i) => bytes.get(position+i) ?? 0);}, async write(position, value) {for (let i = 0; i < value.length; i++) bytes.set(position+i, value[i]!);}};
}
it("preserves PNG/JPEG/GIF/BMP/TIFF metadata and invalid-header errors with bounded source reads", async () => {
  const png = rasterPng(), values = [png, rasterJpeg(150,75,[1,72,200]), rasterGif(), rasterBmp(), rasterTiff(), new Uint8Array(), png.slice(0,-1), joinBytes(png.subarray(0,33), pngChunk("tEXt", new Uint8Array(50000).fill(97)), png.subarray(33))];
  for (const bytes of values) {
    let expected: unknown; try {expected = characterizeRasterHeader(bytes, textContext);} catch (error) {expected = error;}
    let largest = 0; const reused = new Uint8Array(4096);
    const actual = await characterizeRetainedRasterHeader({size: bytes.length, async read(position, length) {largest = Math.max(largest, length); reused.fill(0); reused.set(bytes.subarray(position,position+length)); return reused.subarray(0,length);}}, storage(), textContext).catch(error => error);
    expect(largest).toBeLessThanOrEqual(4096);
    if (expected instanceof Error) expect(actual).toMatchObject({name: expected.name, message: expected.message}); else expect(actual).toEqual(expected);
  }
});

it("retains long TIFF directory chains and rejects cycles after cache eviction", async () => {
  const first = rasterTiff(), bytes = new Uint8Array(first.length + 500 * 6), view = new DataView(bytes.buffer); bytes.set(first); view.setUint32(70, first.length, true);
  for (let i = 0; i < 500; i++) view.setUint32(first.length + i * 6 + 2, i === 499 ? 0 : first.length + (i+1)*6, true);
  const source = {size: bytes.length, async read(position: number,length: number) {return bytes.slice(position,position+length);}};
  expect(await characterizeRetainedRasterHeader(source, storage(), textContext)).toEqual(characterizeRasterHeader(bytes,textContext));
  view.setUint32(bytes.length-4,first.length,true);
  await expect(characterizeRetainedRasterHeader(source, storage(), textContext)).rejects.toMatchObject({message: "Raster header or density metadata is invalid or unsupported."});
});
it("preserves source failures and observes cancellation after borrowed reads", async () => {
  const bytes = rasterPng(), failure = new Error("Source failed");
  await expect(characterizeRetainedRasterHeader({size: bytes.length, async read() {throw failure;}}, storage(), textContext)).rejects.toBe(failure);
  const controller = new AbortController();
  await expect(characterizeRetainedRasterHeader({size: bytes.length, async read(position,length) {controller.abort(); return bytes.slice(position,position+length);}}, storage(), {...textContext,signal:controller.signal})).rejects.toThrow();
});

it.each([...storyRasterCases, ...invalidStoryRasters])("preserves raster metadata profile: $name", async ({bytes}) => {
  let expected: unknown; try {expected = characterizeRasterHeader(bytes, textContext);} catch(error) {expected = error;}
  const actual = await characterizeRetainedRasterHeader({size: bytes.length, async read(position,length) {return bytes.slice(position,position+length);}}, storage(), textContext).catch(error => error);
  if(expected instanceof Error) expect(actual).toMatchObject({name:expected.name,message:expected.message}); else expect(actual).toEqual(expected);
});
