import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfFileSource } from "../source.js";
import { decodeJpegToRgba } from "./images.js";
import { PdfRetainedJpeg } from "./retained-jpeg.js";
import { JpegImage } from "../vendor/pdfjs-image-decoders.mjs";
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}.jpg`, import.meta.url)));
async function source(bytes: Uint8Array) { const fs = createMemoryFileSystem(); await fs.writeFile("/jpeg", bytes); return PdfFileSource.open(fs, "/jpeg", { chunkBytes: 31, cacheBytes: 62 }); }

it.each(["jpeg-L-0-0-17", "jpeg-L-1-0-17", "jpeg-RGB-0-0-17", "jpeg-RGB-1-0-17", "jpeg-CMYK-0-0-17", "jpeg-CMYK-1-0-17", "jpeg-rgb-direct"])("decodes owned rows matching buffered %s", async name => {
  const bytes = fixture(name); const input = await source(bytes); const expected = decodeJpegToRgba(bytes);
  const jpeg = await PdfRetainedJpeg.open(input); await input.close(); const actual: number[] = [];
  for await (const row of jpeg.rows()) { expect(row.buffer.byteLength).toBe(expected.width * 4); actual.push(...row); }
  expect(jpeg.width).toBe(expected.width); expect(jpeg.height).toBe(expected.height); expect(actual).toEqual([...expected.data]);
  jpeg.close(); await expect(jpeg.rows().next()).rejects.toThrow("closed");
});
it("admits fixed input scratch before reads and output dimensions before coefficient buffers", async () => {
  const input = await source(fixture("jpeg-RGB-0-0-17")); const read = vi.spyOn(input, "read");
  await expect(PdfRetainedJpeg.open(input, { maxWorkingBytes: 1 })).rejects.toThrow("limit"); expect(read).not.toHaveBeenCalled();
  await expect(PdfRetainedJpeg.open(input, { maxOutputBytes: 1 })).rejects.toThrow("limit");
  await input.close();
});
it("decodes row windows without allocating a complete linearized sample plane", () => {
  const decoder = new JpegImage(); decoder.parse(fixture("jpeg-RGB-0-0-17"));
  const full = decoder.getData({ width: decoder.width, height: decoder.height, forceRGB: true });
  const row = decoder.getData({ width: decoder.width, height: decoder.height, rowStart: 1, rowCount: 1, forceRGB: true });
  expect(row.length).toBe(decoder.width * 3); expect(row).toEqual(full.slice(decoder.width * 3, decoder.width * 6));
});
it("reports codec allocations before allocating coefficient planes", () => {
  const stop = new Error("allocation stopped"); let largest = 0;
  const decoder = new JpegImage({ onAllocation(bytes) { largest = Math.max(largest, bytes); if (bytes > 512) throw stop; } });
  expect(() => decoder.parse(fixture("jpeg-RGB-0-0-17"))).toThrow(stop); expect(largest).toBeGreaterThan(512);
});
it("honors cancellation between rows and preserves PDF Decode/color transforms", async () => {
  const bytes = fixture("jpeg-CMYK-0-0-17"); const input = await source(bytes); const abort = new AbortController();
  const options = { isSourcePdf: true, colorTransform: 0, decode: [[1, 0], [1, 0], [1, 0], [1, 0]] as const };
  const expected = decodeJpegToRgba(bytes, 1, 1, Infinity, options);
  const jpeg = await PdfRetainedJpeg.open(input, { ...options, signal: abort.signal }); const rows = jpeg.rows();
  expect((await rows.next()).value).toEqual(expected.data.slice(0, expected.width * 4));
  abort.abort(new Error("cancel jpeg")); await expect(rows.next()).rejects.toThrow("cancel jpeg"); jpeg.close(); await input.close();
});
it("reuses a fixed row allocation allowance across the image", async () => {
  const input = await source(fixture("jpeg-CMYK-1-0-17"));
  const measured = await PdfRetainedJpeg.open(input); const base = measured.decoderBytes, width = measured.width; measured.close();
  const bounded = await PdfRetainedJpeg.open(input, { maxWorkingBytes: base + width * 12 + 32 });
  let count = 0; for await (const row of bounded.rows()) { expect(row.length).toBe(width * 4); count++; }
  expect(count).toBe(bounded.height); bounded.close();
  const insufficient = await PdfRetainedJpeg.open(input, { maxWorkingBytes: base + width * 4 - 1 });
  await expect(insufficient.rows().next()).rejects.toThrow("limit"); insufficient.close(); await input.close();
});
it("reports only row-sized linearization allocations and rejects invalid windows", () => {
  const allocations: number[] = []; const decoder = new JpegImage({ onAllocation: bytes => { allocations.push(bytes); } });
  decoder.parse(fixture("jpeg-RGB-0-0-17")); allocations.length = 0;
  decoder.getData({ width: decoder.width, height: decoder.height, rowStart: 1, rowCount: 1, forceRGB: true });
  expect(Math.max(...allocations)).toBe(decoder.width * 7);
  expect(() => decoder.getData({ width: decoder.width, height: decoder.height, rowStart: decoder.height, rowCount: 1 })).toThrow("row range");
});
it("preserves row windows when scaling the full image", () => {
  const decoder = new JpegImage(); decoder.parse(fixture("jpeg-RGB-1-0-17"));
  for (const [width, height] of [[7, 9], [31, 27]]) {
    const full = decoder.getData({ width: width!, height: height!, forceRGB: true });
    const partial = decoder.getData({ width: width!, height: height!, rowStart: 2, rowCount: 3, forceRGB: true });
    expect(partial).toEqual(full.slice(width! * 6, width! * 15));
  }
});


it("admits decoder allocations to the containing owner before reads and preserves rejection", async () => {
  const input = await source(fixture("jpeg-RGB-0-0-17")); const read = vi.spyOn(input, "read");
  const firstFailure = new Error("owner rejected input");
  await expect(PdfRetainedJpeg.open(input, { onDecoderAllocation() { throw firstFailure; } })).rejects.toBe(firstFailure);
  expect(read).not.toHaveBeenCalled();
  const allocations: number[] = [];
  const image = await PdfRetainedJpeg.open(input, { onDecoderAllocation(bytes) { allocations.push(bytes); } });
  expect(allocations.reduce((a, b) => a + b, 0)).toBe(image.decoderBytes);
  expect(allocations.length).toBeGreaterThan(3);
  const count = allocations.length;
  for await (const ignored of image.rows()) void ignored;
  expect(allocations).toHaveLength(count); image.close();
  for (const failure of [new Error("owner rejected decoder state"), undefined, NaN]) {
    let called = 0;
    await expect(PdfRetainedJpeg.open(input, { onDecoderAllocation() { if (++called === count) throw failure; } })).rejects.toBe(failure);
    expect(called).toBe(count);
  }
  await input.close();
});


it("admits old/new range caches and the live retained-read result before reading", async () => {
  const input = await source(fixture("jpeg-RGB-0-0-17")); const read = vi.spyOn(input, "read");
  try {
    await expect(PdfRetainedJpeg.open(input, { maxWorkingBytes: input.chunkBytes * 3 - 1 })).rejects.toThrow("limit");
    expect(read).not.toHaveBeenCalled();
  } finally { await input.close(); }
});

it.each([131072,524288])('decodes a generated %i-byte prefix without admitting the encoded payload',async prefix=>{
 const bytes=fixture('jpeg-RGB-1-0-17'),expected=decodeJpegToRgba(bytes);let peak=0,reads=0;
 const input={size:prefix+bytes.length,chunkBytes:512,async read(position:number,length:number){reads++;if(length>512)throw Error('whole encoded read');const result=new Uint8Array(length);for(let i=0;i<length;i++)result[i]=bytes[position+i-prefix]??0;return result;},async *stream(){for(let at=0;at<this.size;at+=512)yield await this.read(at,Math.min(512,this.size-at));}} as PdfFileSource;
 const jpeg=await PdfRetainedJpeg.open(input,{onDecoderAllocation(length){peak=Math.max(peak,length);if(length>65536)throw Error('whole encoded allocation');}}),rows=[];
 for await(const row of jpeg.rows())rows.push(...row);expect(rows).toEqual([...expected.data]);expect(peak).toBeLessThanOrEqual(65536);expect(reads).toBeGreaterThan(1);jpeg.close();
});

it.each([131072,524288])('skips malformed comment padding across %i bytes with bounded range reads',async padding=>{
 const original=fixture('jpeg-RGB-0-0-17'),bytes=new Uint8Array(original.length+padding+4);bytes.set([255,216,255,254,0,4]);bytes.set(original.subarray(2),padding+6);
 const input=await source(bytes),expected=decodeJpegToRgba(original);let peak=0;
 try{const image=await PdfRetainedJpeg.open(input,{onDecoderAllocation(length){peak=Math.max(peak,length);if(length>65536)throw Error('whole metadata');}}),actual=[];for await(const row of image.rows())actual.push(...row);expect(actual).toEqual([...expected.data]);expect(peak).toBeLessThanOrEqual(65536);image.close();}finally{await input.close();}
});
it.each(['read','cancel'])('preserves JPEG source %s failure identity',async mode=>{
 const original=await source(fixture('jpeg-RGB-0-0-17')),failure=new Error('range failed'),controller=new AbortController(),read=original.read.bind(original);let reads=0;
 vi.spyOn(original,'read').mockImplementation(async(...args)=>{if(++reads===2){if(mode==='cancel')controller.abort(failure);else throw failure;}return read(...args);});
 try{await expect(PdfRetainedJpeg.open(original,{signal:controller.signal})).rejects.toBe(failure);}finally{await original.close();}
});
