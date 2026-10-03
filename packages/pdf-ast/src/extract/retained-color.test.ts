import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosStream, cosHexString, dictGet, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { encodeFlate } from "../cos/filters.js";
import { resolveRetainedImageColor } from "./retained-color.js";
import { decodeSamplesToRgbaSteps } from "./images.js";
import { drainWork } from "../work.js";

async function fixture() {
  const original = PdfDocument.create(); const page = original.addPage();
  const palette = original.cos.allocateObject(cosStream(cosDict({ Filter: cosName("FlateDecode") }), encodeFlate(new Uint8Array([255, 0, 0, 0, 255, 0]))));
  const unused = original.cos.allocateObject(cosStream(cosDict({ N: cosNumber(1), Filter: cosName("Unsupported") }), new Uint8Array([1, 2, 3])));
  const sampled = original.cos.allocateObject(cosStream(cosDict({ FunctionType: cosNumber(0), BitsPerSample: cosNumber(8),
    Size: cosArray([cosNumber(2)]), Domain: cosArray([0, 1].map(n => cosNumber(n))), Range: cosArray([0, 1, 0, 1, 0, 1].map(n => cosNumber(n))), Filter: cosName("FlateDecode"),
  }), encodeFlate(new Uint8Array([255, 0, 0, 0, 255, 0]))));
  const colors = cosDict({
    Sampled: cosArray([cosName("Separation"), cosName("Spot"), cosName("DeviceRGB"), sampled]),
    CalibratedPalette: cosArray([cosName("Indexed"), cosArray([cosName("CalGray"), cosDict()]), cosNumber(1), cosHexString(new Uint8Array([0, 255]))]),
    Alias: cosName("Palette"), Palette: cosArray([cosName("Indexed"), cosName("DeviceRGB"), cosNumber(1), palette]),
    Profile: cosArray([cosName("ICCBased"), unused]),
    Cycle: cosName("Cycle"),
    Lab: cosArray([cosName("Lab"), cosDict()]),
    Tint: cosArray([cosName("Separation"), cosName("Spot"), cosName("DeviceRGB"), original.cos.allocateObject(cosDict({
      FunctionType: cosNumber(2), C0: cosArray([0, 0, 0].map(n => cosNumber(n))), C1: cosArray([1, 0.5, 0].map(n => cosNumber(n))), N: cosNumber(1),
    }))]),
  });
  dictSet(page.pageDict, "Resources", cosDict({ ColorSpace: colors }));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input", { chunkBytes: 32, cacheBytes: 64 });
  const storage = { fs, directory: "/scratch" };
  const doc = await PdfRetainedDocument.open(source, storage, { chunkBytes: 32, cacheBytes: 64 });
  const retained = (await doc.pages().next()).value!;
  return { doc, resources: (await retained.attributes()).resources, storage, palette, unused,
    async close() { await doc.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]); } };
}
it("resolves only the requested resource color and decoded palette", async () => {
  const f = await fixture(); const decode = vi.spyOn(f.doc.objects, "decodeStream");
  const color = await resolveRetainedImageColor(f.doc, cosName("Palette"), f.resources, f.storage);
  expect(color).toMatchObject({ colorSpace: "index", components: 1, baseComponents: 3, palette: new Uint8Array([255, 0, 0, 0, 255, 0]) });
  expect(decode.mock.calls.map(call => call[0])).toEqual([f.palette.objectNumber]); await f.close();
});
it("reads ICC component metadata without decoding the profile", async () => {
  const f = await fixture(); const decode = vi.spyOn(f.doc.objects, "decodeStream");
  expect(await resolveRetainedImageColor(f.doc, cosName("Profile"), f.resources, f.storage)).toMatchObject({ colorSpace: "gray", colorSpaceLabel: "icc", components: 1 });
  expect(decode).not.toHaveBeenCalled(); await f.close();
});
it("retains calibrated and tint state usable after closing the document", async () => {
  const f = await fixture();
  const lab = await resolveRetainedImageColor(f.doc, cosName("Lab"), f.resources, f.storage);
  const tint = await resolveRetainedImageColor(f.doc, cosName("Tint"), f.resources, f.storage);
  await f.close();
  expect(lab).toMatchObject({ colorSpaceLabel: "lab", calibrated: { name: "Lab" } });
  expect([...drainWork(decodeSamplesToRgbaSteps(new Uint8Array([255]), 1, 1, 8, tint))]).toEqual([255, 128, 0, 255]);
});
it("bounds aliases and codec-state admission and cleans staging on failure", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch");
  await expect(resolveRetainedImageColor(f.doc, cosName("Cycle"), f.resources, f.storage, { maxDepth: 3 })).rejects.toThrow("depth");
  await expect(resolveRetainedImageColor(f.doc, cosName("Palette"), f.resources, f.storage, { maxWorkingBytes: 1 })).rejects.toThrow("limit");
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});
it("honors cancellation even when the default color requires no lookups", async () => {
  const f = await fixture(); const abort = new AbortController(); abort.abort(new Error("cancel color"));
  await expect(resolveRetainedImageColor(f.doc, undefined, f.resources, f.storage, { signal: abort.signal })).rejects.toThrow("cancel color"); await f.close();
});
it("admits node and staging limits and cleans cancelled palette producers", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch");
  const lookup = vi.spyOn(f.doc, "lookup");
  await expect(resolveRetainedImageColor(f.doc, cosName("Palette"), f.resources, f.storage, { maxNodes: 0 })).rejects.toThrow("limit");
  expect(lookup).not.toHaveBeenCalled();
  await expect(resolveRetainedImageColor(f.doc, cosName("Palette"), f.resources, f.storage, { maxStagingBytes: 1 })).rejects.toThrow("limit");
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before);
  const abort = new AbortController(); let returned = false;
  vi.spyOn(f.doc.objects, "decodeStream").mockImplementation(async function* () {
    try { yield new Uint8Array([255]); abort.abort(new Error("cancel palette")); yield new Uint8Array([0, 0]); } finally { returned = true; }
  });
  await expect(resolveRetainedImageColor(f.doc, cosName("Palette"), f.resources, f.storage, { signal: abort.signal })).rejects.toThrow("cancel palette");
  expect(returned).toBe(true); expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});
it("owns decoded sampled tint functions and converts calibrated palettes", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch");
  const sampled = await resolveRetainedImageColor(f.doc, cosName("Sampled"), f.resources, f.storage);
  const indexed = await resolveRetainedImageColor(f.doc, cosName("CalibratedPalette"), f.resources, f.storage);
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
  expect(sampled.tintFunctionNode?.kind).toBe("stream");
  if (sampled.tintFunctionNode?.kind === "stream") expect(dictGet(sampled.tintFunctionNode.dict, "Filter")).toBeUndefined();
  expect([...drainWork(decodeSamplesToRgbaSteps(new Uint8Array([0, 255]), 2, 1, 8, sampled))]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  expect(indexed).toMatchObject({ baseComponents: 3, palette: new Uint8Array([0, 0, 0, 255, 255, 255]) });
});
it("retains only addressable palette entries while validating the remaining stream", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch"); let chunks = 0;
  const decode = vi.spyOn(f.doc.objects, "decodeStream").mockImplementation(async function* () {
    const reused = new Uint8Array(1024).fill(17);
    for (let i = 0; i < 1024; i++) { chunks++; yield reused; }
  });
  const color = await resolveRetainedImageColor(f.doc, cosName("Palette"), f.resources, f.storage, { maxWorkingBytes: 4096, maxStagingBytes: 768 });
  expect(color.palette).toEqual(new Uint8Array(768).fill(17)); expect(chunks).toBe(1024);
  decode.mockImplementation(async function* () { yield new Uint8Array(1024); throw new Error("malformed tail"); });
  await expect(resolveRetainedImageColor(f.doc, cosName("Palette"), f.resources, f.storage, { maxWorkingBytes: 4096, maxStagingBytes: 768 })).rejects.toThrow("malformed tail");
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});
