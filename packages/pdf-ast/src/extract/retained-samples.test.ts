import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfFileSource } from "../source.js";
import { decodeRetainedSampleRows } from "./retained-samples.js";

async function fixture(bytes: number[]) {
  const fs = createMemoryFileSystem(); await fs.writeFile("/input", new Uint8Array(bytes));
  const source = await PdfFileSource.open(fs, "/input", { chunkBytes: 3, cacheBytes: 3 });
  return source;
}
async function collect(input: AsyncIterable<Uint8Array>) { const rows = []; for await (const row of input) rows.push([...row]); return rows; }
it("decodes packed gray rows independently of byte padding and applies Decode", async () => {
  const source = await fixture([0b10100000, 0b01011111]);
  expect(await collect(decodeRetainedSampleRows(source, 3, 2, 1, { colorSpace: "gray", components: 1 }, { decode: [[1, 0]] })))
    .toEqual([[0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255], [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]]);
  await source.close();
});
it("preserves document-wide truncated RGB and sixteen-bit fallback decisions", async () => {
  const short = await fixture([20, 40, 60, 80, 100]);
  expect(await collect(decodeRetainedSampleRows(short, 1, 2, 8, { colorSpace: "rgb", components: 3 })))
    .toEqual([[0, 0, 0, 255], [0, 0, 0, 255]]);
  await short.close();
  const fallback = await fixture([20, 40, 60, 80, 100, 120]);
  expect(await collect(decodeRetainedSampleRows(fallback, 1, 2, 16, { colorSpace: "rgb", components: 3 })))
    .toEqual([[20, 40, 60, 255], [80, 100, 120, 255]]);
  await fallback.close();
});
it("preserves gray sixteen-bit fallback and whole-image alpha admission", async () => {
  const source = await fixture([5, 6, 7]); const alpha = await fixture([50]);
  expect(await collect(decodeRetainedSampleRows(source, 1, 2, 16, { colorSpace: "gray", components: 1 }, { alpha })))
    .toEqual([[5, 5, 5, 255], [6, 6, 6, 255]]);
  await source.close(); await alpha.close();
});
it("decodes indexed rows with palette and packed padding", async () => {
  const source = await fixture([0x10, 0x01]);
  const palette = new Uint8Array([255, 0, 0, 0, 255, 0]);
  expect(await collect(decodeRetainedSampleRows(source, 2, 2, 4, { colorSpace: "index", components: 1, palette })))
    .toEqual([[0, 255, 0, 255, 255, 0, 0, 255], [255, 0, 0, 255, 0, 255, 0, 255]]);
  await source.close();
});
it("admits working and output budgets before reading and stops pulling at cancellation", async () => {
  const source = await fixture([1, 2, 3, 4, 5, 6]); const read = vi.spyOn(source, "read");
  await expect(decodeRetainedSampleRows(source, 1, 2, 8, { colorSpace: "rgb", components: 3 }, { maxWorkingBytes: 6 }).next()).rejects.toThrow("limit");
  await expect(decodeRetainedSampleRows(source, 1, 2, 8, { colorSpace: "rgb", components: 3 }, { maxOutputBytes: 7 }).next()).rejects.toThrow("limit");
  expect(read).not.toHaveBeenCalled();
  const abort = new AbortController(); const rows = decodeRetainedSampleRows(source, 1, 2, 8, { colorSpace: "rgb", components: 3 }, { signal: abort.signal });
  expect((await rows.next()).value).toEqual(new Uint8Array([1, 2, 3, 255])); expect(read).toHaveBeenCalledTimes(1);
  abort.abort(new Error("cancel pixels")); await expect(rows.next()).rejects.toThrow("cancel pixels"); expect(read).toHaveBeenCalledTimes(1);
  await source.close();
});

it.each(["rgb", "gray", "cmyk", "index"] as const)("matches buffered %s conversion across bit depths and truncation", async colorSpace => {
  const { decodeSamplesToRgbaSteps } = await import("./images.js"); const { drainWork } = await import("../work.js");
  const color = { colorSpace, components: colorSpace === "rgb" ? 3 : colorSpace === "cmyk" ? 4 : 1, palette: new Uint8Array([0, 10, 20, 30, 40, 50]) };
  for (const bpc of [1, 2, 4, 8, 16]) for (const size of [0, 1, 7, 29, 43, 44, 65, 66, 87, 88, 131, 132]) {
    const samples = Array.from({ length: size }, (_, i) => (i * 37 + 11) & 255); const source = await fixture(samples);
    const expected = drainWork(decodeSamplesToRgbaSteps(new Uint8Array(samples), 11, 2, bpc, color, undefined, [[1, 0]]));
    const actual = (await collect(decodeRetainedSampleRows(source, 11, 2, bpc, color, { decode: [[1, 0]] }))).flat();
    expect(actual).toEqual([...expected]); await source.close();
  }
});

it.each([128, 4096])("converts %i generated rows with fixed working memory and backpressure", async height => {
  const width = 17; let reads = 0; let closed = false;
  const scratch = new Uint8Array(64);
  const fs = {
    capabilities: { retainedRead: true },
    async openReadFile() { return {
      stat: async () => ({ type: "file", size: width * height * 3 }), close: async () => { closed = true; },
      async read(position: number, length: number) {
        reads++; expect(length).toBeLessThanOrEqual(64);
        for (let i = 0; i < length; i++) scratch[i] = (position + i) % 251;
        return scratch.subarray(0, length);
      },
    }; },
    readFile() { throw new Error("whole read forbidden"); },
  } as unknown as import("@poe-code/safe-fs/contracts").FileSystem;
  const source = await PdfFileSource.open(fs, "/generated", { chunkBytes: 64, cacheBytes: 64 });
  const rows = decodeRetainedSampleRows(source, width, height, 8, { colorSpace: "rgb", components: 3 }, { maxWorkingBytes: 170 });
  let count = 0; let first: Uint8Array | undefined;
  for await (const row of rows) {
    expect(row.buffer.byteLength).toBe(68);
    if (!first) { first = row; expect(reads).toBe(1); }
    for (let x = 0; x < width; x++) expect([...row.subarray(x * 4, x * 4 + 4)]).toEqual([(count * width * 3 + x * 3) % 251, (count * width * 3 + x * 3 + 1) % 251, (count * width * 3 + x * 3 + 2) % 251, 255]);
    const before = reads; await Promise.resolve(); expect(reads).toBe(before); count++;
  }
  expect(count).toBe(height); expect([...first!.subarray(0, 4)]).toEqual([0, 1, 2, 255]); expect(closed).toBe(false);
  await source.close(); expect(closed).toBe(true);
});

it("admits tint-channel scratch before converting missing samples", async () => {
  const source = await fixture([]);
  await expect(decodeRetainedSampleRows(source, 1, 1, 8, { colorSpace: "rgb", components: 100, isDeviceN: true }, { maxWorkingBytes: 8 }).next()).rejects.toMatchObject({ code: "E_LIMIT" });
  await source.close();
});

it("shares calibrated and tint color conversion with the buffered decoder", async () => {
  const { PdfDocument } = await import("../document.js");
  const { cosArray, cosDict, cosNumber } = await import("../ast.js");
  const { createCalibratedColorSpace } = await import("../content/calibrated-color.js");
  const { decodeSamplesToRgbaSteps } = await import("./images.js"); const { drainWork } = await import("../work.js");
  const doc = PdfDocument.create().cos;
  const tint = cosDict({ FunctionType: cosNumber(2), C0: cosArray([0, 0, 0].map(n => cosNumber(n))), C1: cosArray([1, 0.5, 0.2].map(n => cosNumber(n))), N: cosNumber(1) });
  const colors: import("./images.js").ResolvedColorSpace[] = [
    { colorSpace: "gray", components: 1, calibrated: createCalibratedColorSpace(doc, "CalGray", undefined) },
    { colorSpace: "rgb", components: 3, calibrated: createCalibratedColorSpace(doc, "CalRGB", undefined) },
    { colorSpace: "rgb", components: 3, calibrated: createCalibratedColorSpace(doc, "Lab", undefined) },
    { colorSpace: "rgb", components: 1, isSeparation: true, tintFunctionDoc: doc, tintFunctionNode: tint },
    { colorSpace: "rgb", components: 2, isDeviceN: true, tintFunctionDoc: doc, tintFunctionNode: tint },
  ];
  for (const color of colors) for (const bpc of [8, 16]) for (const size of [0, 3, 6, 12]) {
    const samples = Array.from({ length: size }, (_, i) => (i * 37 + 20) & 255); const source = await fixture(samples);
    const alpha = await fixture([25, 50]);
    const expected = drainWork(decodeSamplesToRgbaSteps(new Uint8Array(samples), 1, 2, bpc, color, new Uint8Array([25, 50])));
    const actual = (await collect(decodeRetainedSampleRows(source, 1, 2, bpc, color, { alpha }))).flat();
    expect(actual).toEqual([...expected]); await source.close(); await alpha.close();
  }
});
