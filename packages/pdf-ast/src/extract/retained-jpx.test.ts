import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfError } from "../errors.js";
import { PdfFileSource } from "../source.js";
import { JpxImage } from "../vendor/pdfjs-image-decoders.mjs";
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));

it("admits a cropped image's entire tile grid before constructing it", () => {
  const bytes = fixture("gray-lossless.jp2");
  let marker = -1;
  for (let i = 0; i + 1 < bytes.length; i++) if (bytes[i] === 255 && bytes[i + 1] === 81) { marker = i + 2; break; }
  expect(marker).toBeGreaterThan(0);
  const view = new DataView(bytes.buffer);
  view.setUint32(marker + 4, 4097); view.setUint32(marker + 12, 4096); view.setUint32(marker + 20, 1); view.setUint32(marker + 28, 0);
  const dimensions = vi.fn(); const allocations: number[] = [];
  const decoder = new JpxImage(dimensions, bytes => { allocations.push(bytes); if (bytes > 65536) throw new PdfError("E_LIMIT", "tile budget"); });
  expect(() => decoder.parse(bytes)).toThrow("tile budget");
  expect(dimensions).toHaveBeenCalledWith(1, expect.any(Number));
  expect(Math.max(...allocations)).toBeGreaterThan(65536);
});

import { PdfRetainedJpx } from "./retained-jpx.js";
import { decodeJpxToRgba } from "./images.js";
async function source(bytes: Uint8Array) { const fs = createMemoryFileSystem(); await fs.writeFile("/jpx", bytes); return PdfFileSource.open(fs, "/jpx", { chunkBytes: 31, cacheBytes: 62 }); }
it.each(["rgb-lossless.j2k", "rgb-lossless.jp2", "rgb-tiled.jp2", "gray-lossless.jp2"])("decodes owned rows with buffered parity for %s", async name => {
  const bytes = fixture(name); const input = await source(bytes); const expected = decodeJpxToRgba(bytes);
  const image = await PdfRetainedJpx.open(input); await input.close(); const actual: number[] = [];
  for await (const row of image.rows()) { expect(row.buffer.byteLength).toBe(image.width * 4); actual.push(...row); }
  expect(actual).toEqual([...expected]); image.close(); await expect(image.rows().next()).rejects.toThrow("closed");
});
it("admits encoded input before reading and output before decoding", async () => {
  const input = await source(fixture("rgb-tiled.jp2")); const read = vi.spyOn(input, "read");
  await expect(PdfRetainedJpx.open(input, { maxWorkingBytes: input.size - 1 })).rejects.toThrow("limit"); expect(read).not.toHaveBeenCalled();
  await expect(PdfRetainedJpx.open(input, { maxOutputBytes: 1 })).rejects.toThrow("limit"); await input.close();
});
it("admits row scratch separately, reuses its allowance, and cancels between rows", async () => {
  const input = await source(fixture("rgb-tiled.jp2")); const measured = await PdfRetainedJpx.open(input); const base = measured.decoderBytes; const width = measured.width; measured.close();
  const image = await PdfRetainedJpx.open(input, { maxWorkingBytes: base + width * 7 }); let count = 0;
  for await (const row of image.rows()) { expect(row.length).toBe(width * 4); count++; }
  expect(count).toBe(image.height); image.close();
  const tight = await PdfRetainedJpx.open(input, { maxWorkingBytes: base + width * 7 - 1 }); await expect(tight.rows().next()).rejects.toThrow("limit"); tight.close();
  const controller = new AbortController(); const cancelled = await PdfRetainedJpx.open(input, { signal: controller.signal }); const rows = cancelled.rows();
  await rows.next(); controller.abort(new Error("cancel jpx")); await expect(rows.next()).rejects.toThrow("cancel jpx"); cancelled.close(); await input.close();
});
it("preserves gaps and last-tile precedence without collecting a sample plane", async () => {
  const parse = vi.spyOn(JpxImage.prototype, "parse").mockImplementation(function (this: JpxImage) {
    this.width = 3; this.height = 2; this.componentsCount = 1;
    this.tiles = [{ left: 1, top: 0, width: 2, height: 2, items: new Uint8ClampedArray([10, 20, 30, 40]) }, { left: 2, top: 1, width: 1, height: 1, items: new Uint8ClampedArray([90]) }];
  });
  try {
    const input = await source(new Uint8Array()); const image = await PdfRetainedJpx.open(input); const result: number[] = [];
    for await (const row of image.rows()) result.push(...row);
    expect(result).toEqual([0, 10, 20, 0, 30, 90].flatMap(n => [n, n, n, 255])); image.close(); await input.close();
  } finally { parse.mockRestore(); }
});
it("preserves allocation failures throughout tile, tag-tree and wavelet decoding", () => {
  const bytes = fixture("rgb-tiled.jp2"); const sizes: number[] = []; new JpxImage(undefined, bytes => { sizes.push(bytes); }).parse(bytes);
  expect(sizes.length).toBeGreaterThan(30);
  for (const stopAt of [0, Math.floor(sizes.length / 3), Math.floor(sizes.length * 2 / 3), sizes.length - 1]) {
    let index = 0; const stopped = new PdfError("E_LIMIT", `allocation ${stopAt}`);
    expect(() => new JpxImage(undefined, () => { if (index++ === stopAt) throw stopped; }).parse(bytes)).toThrow(stopped);
    expect(index).toBe(stopAt + 1);
  }
});
it("uses caller color state and rejects a component mismatch", async () => {
  const input = await source(fixture("gray-lossless.jp2"));
  await expect(PdfRetainedJpx.open(input, { color: { colorSpace: "rgb", components: 3 } })).rejects.toThrow("component mismatch");
  const image = await PdfRetainedJpx.open(input, { color: { colorSpace: "index", components: 1, palette: new Uint8Array(768).fill(42) } });
  for await (const row of image.rows()) for (let x = 0; x < image.width; x++) expect([...row.subarray(x * 4, x * 4 + 4)]).toEqual([42, 42, 42, 255]);
  image.close(); await input.close();
});
