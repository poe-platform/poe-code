import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosStream, cosHexString, dictGet, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { encodeFlate } from "../cos/filters.js";
import { resolveRetainedMaskParameters, resolveRetainedImageColor } from "./retained-color.js";
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
  return { doc, resources: (await retained.attributes()).resources, storage, palette, unused, sampled,
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

it("reads only the selected vector palette entry into admitted memory", async () => {
  const { convertRetainedContentColor } = await import("./retained-color.js");
  const f = await fixture();
  const original = f.doc.objects.decodeStream.bind(f.doc.objects);
  const decode = vi.spyOn(f.doc.objects, "decodeStream").mockImplementation(function (objectNumber, generationNumber, options) {
    if (objectNumber !== f.palette.objectNumber) return original(objectNumber, generationNumber, options);
    return (async function* () {
      const bytes = new Uint8Array(4096).fill(127);
      for (let i = 0; i < 32; i++) yield bytes;
    })();
  });
  try {
    expect(await convertRetainedContentColor(f.doc, undefined, "Palette", [1], f.resources, f.storage, { maxWorkingBytes: 16384, chunkBytes: 4096 })).toEqual([127 / 255, 127 / 255, 127 / 255]);
    expect(decode).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it("validates the palette tail and preserves cancellation and owner rejection", async () => {
  const { convertRetainedContentColor } = await import("./retained-color.js");
  const f = await fixture(); const failure = new Error("bad palette tail");
  const decode = vi.spyOn(f.doc.objects, "decodeStream").mockImplementation(() => (async function* () {
    yield new Uint8Array([255, 0, 0, 0, 255, 0]); throw failure;
  })());
  try {
    await expect(convertRetainedContentColor(f.doc, undefined, "Palette", [0], f.resources, f.storage)).rejects.toBe(failure);
    decode.mockClear();
    await expect(convertRetainedContentColor(f.doc, undefined, "Palette", [0], f.resources, f.storage, { onAllocation() { throw failure; } })).rejects.toBe(failure);
    expect(decode).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort(failure);
    await expect(convertRetainedContentColor(f.doc, undefined, "DeviceRGB", [1, 0, 0], undefined, f.storage, { signal: controller.signal })).rejects.toBe(failure);
  } finally { await f.close(); }
});

it("resolves soft-mask backdrop and transfer without reading Form payloads", async () => {
  const f = await fixture();
  const decode = vi.spyOn(f.doc.objects, "decodeStream");
  const form = cosStream(cosDict({ Group: cosDict({ CS: cosName("DeviceRGB") }) }), new Uint8Array([255]));
  const mask = cosDict({ BC: cosArray([0.25, 0.5, 0.75].map(value => cosNumber(value))), TR: cosDict({
    FunctionType: cosNumber(2), C0: cosArray([cosNumber(1)]), C1: cosArray([cosNumber(0)]), N: cosNumber(1),
  }) });
  const result = await resolveRetainedMaskParameters(f.doc, mask, form, f.resources, f.storage);
  expect(result.backdrop).toEqual({ r: 0.25, g: 0.5, b: 0.75 });
  expect(result.transferMap).toEqual(Uint8Array.from({ length: 256 }, (_, i) => Math.floor(Math.fround(1 - Math.fround(i / 255)) * 255)));
  expect(decode).not.toHaveBeenCalled();
  await f.close();
});
it("admits mask transfer storage before allocation and preserves rejection identity", async () => {
  const f = await fixture(); const rejection = { rejected: true };
  const mask = cosDict({ TR: cosDict({ FunctionType: cosNumber(2), N: cosNumber(1) }) });
  const form = cosStream(cosDict(), new Uint8Array());
  await expect(resolveRetainedMaskParameters(f.doc, mask, form, f.resources, f.storage, {
    onAllocation(bytes) { if (bytes === 256) throw rejection; },
  })).rejects.toBe(rejection);
  const abort = new AbortController(); abort.abort(rejection);
  await expect(resolveRetainedMaskParameters(f.doc, mask, form, f.resources, f.storage, { signal: abort.signal })).rejects.toBe(rejection);
  await f.close();
});

it("decodes an indirect sampled mask transfer once and retains exact bytes", async () => {
  const f = await fixture(); const decode = vi.spyOn(f.doc.objects, "decodeStream");
  const result = await resolveRetainedMaskParameters(f.doc, cosDict({ TR: f.sampled }), cosStream(cosDict(), new Uint8Array()), f.resources, f.storage);
  expect(result.transferMap?.[0]).toBe(255);
  expect(result.transferMap?.[255]).toBe(0);
  expect(decode.mock.calls.map(call => call[0])).toEqual([f.sampled.objectNumber]);
  await f.close();
});

it("shares admission across mask backdrop and transfer resolution", async () => {
  const f = await fixture();
  const mask = cosDict({ BC: cosArray([cosNumber(1)]), TR: f.sampled });
  const form = cosStream(cosDict({ Group: cosDict({ CS: cosName("Palette") }) }), new Uint8Array());
  let admitted = 0;
  const result = await resolveRetainedMaskParameters(f.doc, mask, form, f.resources, f.storage, { onAllocation(bytes) { admitted += bytes; } });
  expect(result.backdrop).toEqual({ r: 0, g: 1, b: 0 });
  await expect(resolveRetainedMaskParameters(f.doc, mask, form, f.resources, f.storage, { maxWorkingBytes: admitted - 1 })).rejects.toThrow("limit");
  expect(await resolveRetainedMaskParameters(f.doc, mask, form, f.resources, f.storage, { maxWorkingBytes: admitted })).toEqual(result);
  await f.close();
});
it("preserves late mask transfer decode failures and cleans staging", async () => {
  const f = await fixture(); const rejection = new Error("transfer tail"); let closed = false;
  vi.spyOn(f.doc.objects, "decodeStream").mockImplementation(async function* () {
    try { yield new Uint8Array([255, 0, 0]); throw rejection; } finally { closed = true; }
  });
  await expect(resolveRetainedMaskParameters(f.doc, cosDict({ TR: f.sampled }), cosStream(cosDict(), new Uint8Array()), f.resources, f.storage)).rejects.toBe(rejection);
  expect(closed).toBe(true); await f.close();
});
