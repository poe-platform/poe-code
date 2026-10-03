import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosNumber, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { renderDisplayListToBitmap, type RenderToPngOptions } from "./raster.js";
import { renderRetainedPagePixels } from "./retained-page-pixels.js";

async function fixture(rotation = 0) {
  const original = PdfDocument.create(), page = original.addPage();
  dictSet(page.pageDict, "MediaBox", cosArray([-5, -7, 32, 22].map(value => cosNumber(value))));
  dictSet(page.pageDict, "CropBox", cosArray([0, 0, 28, 18].map(value => cosNumber(value)))); dictSet(page.pageDict, "Rotate", cosNumber(rotation));
  page.drawText("Test", { x: 1, y: 9, size: 8 }); page.drawRect({ x: 5, y: 2, width: 7, height: 9, fill: { r: 0.2, g: 0.6, b: 0.9 } });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input"), storage = { fs, directory: "/scratch" };
  const document = await PdfRetainedDocument.open(source, storage); const retained = (await document.pages().next()).value!;
  return { page, retained, storage, async close() { await document.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]); } };
}
for (const rotation of [0, 90, 180, 270]) for (const options of [{ scale: 0.7 }, { dpiX: 90, dpiY: 47, useCropBox: true }, { scale: 1, cropRect: { x: 3, y: 2, width: 13, height: 11 }, transparent: true }] satisfies RenderToPngOptions[]) {
  it(`streams exact retained pixels across tile edges: rotation=${rotation}, ${JSON.stringify(options)}`, async () => {
    const f = await fixture(rotation); const expected = renderDisplayListToBitmap(f.page.evaluateDisplayList(), options);
    const image = await renderRetainedPagePixels(f.retained, f.storage, { ...options, tileSize: 8, chunkBytes: 31 });
    expect([image.width, image.height]).toEqual([expected.width, expected.height]); const chunks = [];
    for await (const chunk of image.pixels) { expect(chunk.length).toBeLessThanOrEqual(31); chunks.push(chunk.slice()); await Promise.resolve(); }
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected.data); await f.close();
  });
}
it("cleans staged pixels when the consumer returns and preserves cancellation identity", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch");
  const controller = new AbortController(), reason = { reason: "stop pixels" };
  const image = await renderRetainedPagePixels(f.retained, f.storage, { scale: 1, tileSize: 8, chunkBytes: 32, signal: controller.signal });
  const stream = image.pixels[Symbol.asyncIterator](); await stream.next(); controller.abort(reason);
  await expect(stream.next()).rejects.toBe(reason); expect(await f.storage.fs.readdir("/scratch")).toEqual(before);
  const second = await renderRetainedPagePixels(f.retained, f.storage, { scale: 1, tileSize: 8, chunkBytes: 32 });
  for await (const ignored of second.pixels) { void ignored; break; }
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});

it.each([32, 128])("uses fixed driver scratch and scalar external pixel storage at %i pixels", async dimension => {
  const chunkBytes = 64, tileSize = 16, scope = {}; let size = 0, revision = 0, live = false, writing = false, reads = 0, peak = 0;
  const stat = () => ({ type: "file" as const, size, revision, identityScope: scope, opaqueIdentity: "pixels" });
  const fs = {
    capabilities: { retainedRead: true, retainedStagingWrite: true, retainedStagingCleanup: true },
    stat: async () => ({ type: "directory", size: 0 }),
    async createStagedFile(path: string) {
      expect(live).toBe(false); live = true;
      return { file: { path, stat: stat() }, cleanup: { remove: async () => { live = false; }, close: async () => {} }, writer: {
        async write(bytes: Uint8Array) {
          expect(writing).toBe(false); writing = true; peak = Math.max(peak, bytes.buffer.byteLength);
          expect(bytes.every(value => value === 255)).toBe(true); await Promise.resolve(); size += bytes.length; revision++; writing = false;
        }, finish: async () => stat(),
      } };
    },
    async openReadFile() { return { stat: async () => stat(), close: async () => {}, async read(at: number, count: number) {
      reads++; expect(count).toBeLessThanOrEqual(chunkBytes); return new Uint8Array(Math.min(count, size - at)).fill(255);
    } }; },
    readFile() { throw new Error("whole read forbidden"); }, writeFile() { throw new Error("whole write forbidden"); },
  } as unknown as import("@poe-code/safe-fs/contracts").FileSystem;
  const page = { async attributes() { return { mediaBox: [0, 0, dimension, dimension], rotation: 0 }; },
    async *evaluateSteps() { expect(writing).toBe(false); yield* []; } } as unknown as import("../retained-document.js").PdfRetainedPage;
  const image = await renderRetainedPagePixels(page, { fs, directory: "/external" }, { scale: 1, tileSize, chunkBytes, maxPixelWorkingBytes: tileSize * tileSize * 4 + chunkBytes * 6 });
  let total = 0;
  for await (const chunk of image.pixels) { expect(chunk.every(value => value === 255)).toBe(true); total += chunk.length;
    const before = reads; await Promise.resolve(); expect(reads).toBe(before); chunk.fill(0); }
  expect(total).toBe(dimension * dimension * 4); expect(size).toBe(total); expect(peak).toBeLessThanOrEqual(chunkBytes); expect(live).toBe(false);
});

it("admits driver scratch before page access and preserves producer errors through cleanup", async () => {
  const f = await fixture(); const attributes = vi.spyOn(f.retained, "attributes");
  await expect(renderRetainedPagePixels(f.retained, f.storage, { maxPixelWorkingBytes: 1 })).rejects.toMatchObject({ code: "E_LIMIT" });
  expect(attributes).not.toHaveBeenCalled();
  const reason = { reason: "paint producer" };
  const page = { attributes: f.retained.attributes.bind(f.retained), async *evaluateSteps() { yield* []; throw reason; } } as unknown as import("../retained-document.js").PdfRetainedPage;
  const before = await f.storage.fs.readdir("/scratch");
  const image = await renderRetainedPagePixels(page, f.storage, { scale: 1, tileSize: 8 });
  await expect(image.pixels[Symbol.asyncIterator]().next()).rejects.toBe(reason);
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});
