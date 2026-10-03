import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictSet, type PdfCosDict } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { decodeXObjectImageToRgba } from "./images.js";
import { PdfRetainedDecodedImage } from "./retained-decoded-image.js";
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
async function open(bytes: Uint8Array, entries: PdfCosDict, amend?: (doc: PdfDocument, dict: PdfCosDict) => void, password = "", compare = true) {
  const original = PdfDocument.create(); const page = original.addPage();
  const dict = cosDict({ Subtype: cosName("Image"), Width: cosNumber(2), Height: cosNumber(2), BitsPerComponent: cosNumber(8), ColorSpace: cosName("DeviceRGB") });
  for (const entry of entries.entries) dictSet(dict, entry.key.decoded, entry.value); amend?.(original, dict);
  const stream = cosStream(dict, bytes); const ref = original.cos.allocateObject(stream);
  const resources = cosDict({ XObject: cosDict({ I: ref }) }); dictSet(page.pageDict, "Resources", resources);
  dictSet(page.pageDict, "Contents", original.cos.allocateObject(cosStream(new TextEncoder().encode("/I Do"))));
  const expected = compare ? decodeXObjectImageToRgba(original.cos, stream, resources) : { width: 0, height: 0, rgba: new Uint8Array() };
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save(password ? { encrypt: { revision: 3, userPassword: password } } : undefined)); const storage = { fs, directory: "/scratch" };
  const source = await PdfFileSource.open(fs, "/input"); const document = await PdfRetainedDocument.open(source, storage, { password }); const images = document.images(); const image = (await images.next()).value!;
  return { image, document, storage, expected, async close() { await images.return(); await document.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]); } };
}
async function collect(input: AsyncIterable<Uint8Array>) { const result: number[] = []; for await (const row of input) result.push(...row); return new Uint8Array(result); }
it.each([
  ["jpeg-RGB-0-0-17.jpg", "DCTDecode"], ["rgb-tiled.jp2", "JPXDecode"], ["jbig2-generic-stream.bin", "JBIG2Decode"],
] as const)("assembles retained %s decoding with buffered pixels", async (name, filter) => {
  const f = await open(fixture(name), cosDict({ Filter: cosName(filter), ...(filter === "JBIG2Decode" ? { Width: cosNumber(64), Height: cosNumber(32), ColorSpace: cosName("DeviceGray") } : {}) }));
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage, { chunkBytes: 31 });
  expect(await collect(image.nativeContents())).toEqual(fixture(name));
  expect(image.width).toBe(f.expected.width); expect(image.height).toBe(f.expected.height); expect(await collect(image.rows())).toEqual(f.expected.rgba);
  await image.close(); await f.close();
});
it("applies retained resampled soft and explicit masks with matte correction", async () => {
  const f = await open(new Uint8Array([100, 120, 140, 10, 20, 30, 40, 50, 60, 70, 80, 90]), cosDict(), (doc, dict) => {
    const soft = cosStream(cosDict({ Width: cosNumber(1), Height: cosNumber(2), ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(8), Matte: cosArray([0.2, 0.2, 0.2].map(n => cosNumber(n))) }), new Uint8Array([128, 255]));
    const mask = cosStream(cosDict({ Width: cosNumber(2), Height: cosNumber(1), ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(8) }), new Uint8Array([0, 255]));
    dictSet(dict, "SMask", doc.cos.allocateObject(soft)); dictSet(dict, "Mask", doc.cos.allocateObject(mask));
  });
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage, { chunkBytes: 31 });
  expect(await collect(image.rows())).toEqual(f.expected.rgba); await image.close(); await f.close();
});
it("recovers unsupported sample filters using raw bytes", async () => {
  const f = await open(new Uint8Array(12).fill(37), cosDict({ Filter: cosName("Unsupported") }));
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage); expect(await collect(image.rows())).toEqual(f.expected.rgba); await image.close(); await f.close();
});
it("retains successful native transport stages when a later wrapper is unsupported", async () => {
  const { encodeAsciiHex } = await import("../cos/filters.js");
  const f = await open(encodeAsciiHex(fixture("jpeg-RGB-0-0-17.jpg")), cosDict({ Filter: cosArray([cosName("ASCIIHexDecode"), cosName("Unsupported"), cosName("DCTDecode")]) }));
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage); expect(await collect(image.rows())).toEqual(f.expected.rgba); await image.close(); await f.close();
});
it("resolves JBIG2 globals from the matching filter parameter slot", async () => {
  const { encodeAsciiHex } = await import("../cos/filters.js");
  const f = await open(encodeAsciiHex(fixture("jbig2-symbols.0000")), cosDict({ Width: cosNumber(64), Height: cosNumber(32), ColorSpace: cosName("DeviceGray"), Filter: cosArray([cosName("ASCIIHexDecode"), cosName("JBIG2Decode")]) }), (doc, dict) => {
    dictSet(dict, "DecodeParms", cosArray([cosDict(), cosDict({ JBIG2Globals: doc.cos.allocateObject(cosStream(fixture("jbig2-symbols.sym"))) })]));
  });
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage);
  expect(await collect(image.nativeContents("globals"))).toEqual(fixture("jbig2-symbols.sym"));
  expect(await collect(image.rows())).toEqual(f.expected.rgba); await image.close(); await f.close();
});
it("preserves RGB color keys and caller alpha", async () => {
  const f = await open(new Uint8Array([1, 2, 3, 4, 5, 6, 1, 2, 3, 7, 8, 9]), cosDict({ Mask: cosArray([1, 1, 2, 2, 3, 3].map(n => cosNumber(n))) }));
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage, { fillColor: { r: 0, g: 0, b: 0, alpha: 0.5 } });
  const expected = f.expected.rgba.slice(); for (let i = 3; i < expected.length; i += 4) expected[i] = Math.round(expected[i]! * 0.5);
  expect(await collect(image.rows())).toEqual(expected); await image.close(); await f.close();
});
it("cleans decoder-owned staging on admission failure, early return and cancellation", async () => {
  const f = await open(new Uint8Array(12).fill(37), cosDict()); const baseline = await f.storage.fs.readdir("/scratch");
  for (const options of [{ maxWorkingBytes: 1 }, { maxStagingBytes: 1 }, { maxOutputBytes: 15 }]) {
    await expect(PdfRetainedDecodedImage.open(f.document, f.image, f.storage, options)).rejects.toThrow("limit"); expect(await f.storage.fs.readdir("/scratch")).toEqual(baseline);
  }
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage); const rows = image.rows(); await rows.next(); await rows.return();
  expect(await f.storage.fs.readdir("/scratch")).toEqual(baseline); await image.close();
  const controller = new AbortController(); const cancelled = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage, { signal: controller.signal }); const output = cancelled.rows(); await output.next();
  controller.abort(new Error("cancel pixels")); await expect(output.next()).rejects.toThrow("cancel pixels"); expect(await f.storage.fs.readdir("/scratch")).toEqual(baseline); await cancelled.close(); await f.close();
});
it("decodes encrypted native transport wrappers", async () => {
  const { encodeAsciiHex } = await import("../cos/filters.js");
  const f = await open(encodeAsciiHex(fixture("jpeg-RGB-0-0-17.jpg")), cosDict({ Filter: cosArray([cosName("ASCIIHexDecode"), cosName("DCTDecode")]) }), undefined, "secret");
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage); expect(await collect(image.rows())).toEqual(f.expected.rgba); await image.close(); await f.close();
});
it("propagates staging failures instead of treating them as malformed filter recovery", async () => {
  const f = await open(new Uint8Array(12), cosDict()); const baseline = await f.storage.fs.readdir("/scratch"); const create = f.storage.fs.createStagedFile!.bind(f.storage.fs);
  const spy = vi.spyOn(f.storage.fs, "createStagedFile").mockImplementation(async (...args) => { const staged = await create(...args); return { ...staged, writer: { finish: options => staged.writer!.finish(options), write: async () => { throw new Error("storage write failed"); } } }; });
  await expect(PdfRetainedDecodedImage.open(f.document, f.image, f.storage)).rejects.toThrow("storage write failed"); expect(spy).toHaveBeenCalledOnce(); spy.mockRestore();
  expect(await f.storage.fs.readdir("/scratch")).toEqual(baseline); await f.close();
});
it("applies stencil fill and Decode before emitting owned rows", async () => {
  const f = await open(new Uint8Array([128, 64]), cosDict({ ImageMask: { kind: "boolean", value: true }, BitsPerComponent: cosNumber(1), Decode: cosArray([cosNumber(1), cosNumber(0)]) }));
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage, { fillColor: { r: 1, g: 0.5, b: 0, alpha: 0.5 } });
  expect(await collect(image.rows())).toEqual(new Uint8Array([255,128,0,128,255,255,255,0,255,255,255,0,255,128,0,128])); await image.close(); await f.close();
});
it("preserves input read failures without retrying raw input", async () => {
  const f = await open(new Uint8Array(12), cosDict());
  const failure = new Error("external read unavailable");
  const contents = vi.fn(async function* () { throw failure; yield new Uint8Array(); });
  await expect(PdfRetainedDecodedImage.open(f.document, { ...f.image, contents }, f.storage)).rejects.toBe(failure);
  expect(contents).toHaveBeenCalledOnce(); await f.close();
});
it("batches indexed color-key reads across bounded source chunks", async () => {
  const { cosString } = await import("../ast.js");
  const f = await open(new Uint8Array([0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0]), cosDict({ Width: cosNumber(6), Height: cosNumber(2), ColorSpace: cosArray([cosName("Indexed"), cosName("DeviceRGB"), cosNumber(1), cosString(new Uint8Array([0,0,0,255,255,255]))]), Mask: cosArray([cosNumber(1), cosNumber(1)]) }));
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage, { chunkBytes: 3 });
  expect(await collect(image.rows())).toEqual(f.expected.rgba); await image.close(); await f.close();
});
it.each([32, 4096])("decodes %i rows through external storage with fixed admission and a slow consumer", async height => {
  const f = await open(new Uint8Array(12), cosDict());
  const width = 17, chunkBytes = 64, scope = {}; let size = 0, revision = 0, live = false, pending = 0, reads = 0;
  const stat = () => ({ type: "file" as const, size, revision, identityScope: scope, opaqueIdentity: "samples", mode: 0o600, mtimeMs: revision, ctimeMs: revision, atimeMs: 0 });
  const fs = {
    capabilities: { retainedRead: true, retainedStagingWrite: true, retainedStagingCleanup: true },
    stat: async () => ({ type: "directory", size: 0 }),
    async createStagedFile(path: string) {
      live = true;
      return { file: { path, stat: stat() }, cleanup: { remove: async () => { live = false; }, close: async () => {} }, writer: {
        async write(bytes: Uint8Array) { expect(pending).toBe(0); pending++; expect(bytes.buffer.byteLength).toBeLessThanOrEqual(chunkBytes); expect(bytes.every(n => n === 37)).toBe(true); await Promise.resolve(); size += bytes.length; revision++; pending--; }, finish: async () => stat(),
      } };
    },
    async openReadFile() { return { stat: async () => stat(), close: async () => {}, async read(at: number, length: number) { reads++; expect(length).toBeLessThanOrEqual(chunkBytes); return new Uint8Array(Math.min(length, size - at)).fill(37); } }; },
    readFile() { throw new Error("whole read forbidden"); }, writeFile() { throw new Error("whole write forbidden"); },
  } as unknown as import("@poe-code/safe-fs/contracts").FileSystem;
  dictSet(f.image.dict, "Width", cosNumber(width)); dictSet(f.image.dict, "Height", cosNumber(height));
  async function* contents() { const chunk = new Uint8Array(chunkBytes).fill(37); for (let at = 0; at < width * height * 3; at += chunkBytes) { expect(pending).toBe(0); yield chunk.subarray(0, Math.min(chunkBytes, width * height * 3 - at)); } }
  const image = await PdfRetainedDecodedImage.open(f.document, { ...f.image, contents }, { fs, directory: "/external" }, { chunkBytes, maxWorkingBytes: 1024 });
  let count = 0;
  for await (const row of image.rows()) { expect(row.buffer.byteLength).toBe(width * 4); expect(row.every((n, i) => n === (i % 4 === 3 ? 255 : 37))).toBe(true); const before = reads; await Promise.resolve(); expect(reads).toBe(before); count++; }
  expect(count).toBe(height); expect(live).toBe(false); await image.close(); await f.close();
});
it("bounds recursive masks", async () => {
  const f = await open(new Uint8Array(12), cosDict(), (doc, dict) => {
    const mask = cosStream(cosDict({ Width: cosNumber(2), Height: cosNumber(2), ColorSpace: cosName("DeviceGray") }), new Uint8Array(4));
    const reference = doc.cos.allocateObject(mask); dictSet(mask.dict, "SMask", reference); dictSet(dict, "SMask", reference);
  }, "", false);
  const baseline = await f.storage.fs.readdir("/scratch");
  await expect(PdfRetainedDecodedImage.open(f.document, f.image, f.storage, { maxDepth: 3 })).rejects.toThrow("depth limit");
  expect(await f.storage.fs.readdir("/scratch")).toEqual(baseline); await f.close();
});
it("admits transport codec and predictor state before decoding", async () => {
  const { encodeFlate } = await import("../cos/filters.js");
  const f = await open(encodeFlate(new Uint8Array(12)), cosDict({ Filter: cosName("FlateDecode") }));
  await expect(PdfRetainedDecodedImage.open(f.document, f.image, f.storage, { chunkBytes: 64, maxWorkingBytes: 1024 })).rejects.toThrow("working byte limit");
  await f.close();
});
it("propagates retained backend parse errors through native transport recovery", async () => {
  const { encodeAsciiHex } = await import("../cos/filters.js"); const { PdfError } = await import("../errors.js");
  const f = await open(encodeAsciiHex(fixture("jpeg-RGB-0-0-17.jpg")), cosDict({ Filter: cosArray([cosName("ASCIIHexDecode"), cosName("DCTDecode")]) }));
  const failure = new PdfError("E_PARSE", "retained read failure"); const stage = PdfFileSource.fromStream.bind(PdfFileSource);
  const spy = vi.spyOn(PdfFileSource, "fromStream").mockImplementation(async (...args) => { const source = await stage(...args); vi.spyOn(source, "read").mockRejectedValue(failure); return source; });
  await expect(PdfRetainedDecodedImage.open(f.document, f.image, f.storage)).rejects.toBe(failure); spy.mockRestore(); await f.close();
});
it("decodes CCITT packed sample rows through the combined owner", async () => {
  const f = await open(new Uint8Array([0xff]), cosDict({ Filter: cosName("CCITTFaxDecode"), ColorSpace: cosName("DeviceGray"), Width: cosNumber(8), Height: cosNumber(2), BitsPerComponent: cosNumber(1), DecodeParms: cosDict({ K: cosNumber(-1), Columns: cosNumber(8), Rows: cosNumber(2) }) }));
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage, { chunkBytes: 3 });
  expect(await collect(image.rows())).toEqual(f.expected.rgba); await image.close(); await f.close();
});
it.each(["CalRGB", "Lab", "Separation"])("preserves combined %s color resolution and conversion", async name => {
  const space = name === "Separation" ? cosArray([cosName(name), cosName("Spot"), cosName("DeviceRGB"), cosDict({ FunctionType: cosNumber(2), C0: cosArray([0,0,0].map(n => cosNumber(n))), C1: cosArray([1,0.5,0.2].map(n => cosNumber(n))), N: cosNumber(1) })]) : cosArray([cosName(name), cosDict()]);
  const f = await open(new Uint8Array([10,20,30,40,50,60,70,80,90,100,110,120]), cosDict({ ColorSpace: space }));
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage, { chunkBytes: 3 });
  expect(await collect(image.rows())).toEqual(f.expected.rgba); await image.close(); await f.close();
});
it("retains native payloads independently of decoded sample rows", async () => {
  const { encodeAsciiHex } = await import("../cos/filters.js");
  const bytes = new Uint8Array([0xff]);
  const f = await open(encodeAsciiHex(bytes), cosDict({ Filter: cosArray([cosName("ASCIIHexDecode"), cosName("CCITTFaxDecode")]), ColorSpace: cosName("DeviceGray"), Width: cosNumber(8), Height: cosNumber(2), BitsPerComponent: cosNumber(1), DecodeParms: cosArray([cosDict(), cosDict({ K: cosNumber(-1), Columns: cosNumber(8), Rows: cosNumber(2) })]) }));
  const image = await PdfRetainedDecodedImage.open(f.document, f.image, f.storage, { chunkBytes: 3 });
  expect(image.nativeByteLength).toBe(1); expect(await collect(image.nativeContents())).toEqual(bytes);
  expect(await collect(image.rows())).toEqual(f.expected.rgba);
  await expect(collect(image.nativeContents())).rejects.toThrow("closed"); await image.close(); await f.close();
});

it("reports image allocation to a containing owner before payload reads", async () => {
  const f = await open(new Uint8Array(12).fill(37), cosDict()); const before = await f.storage.fs.readdir("/scratch");
  const contents = vi.spyOn(f.image, "contents"); const rejection = { rejected: true };
  await expect(PdfRetainedDecodedImage.open(f.document, f.image, f.storage, { onAllocation() { throw rejection; } })).rejects.toBe(rejection);
  expect(contents).not.toHaveBeenCalled(); expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});
