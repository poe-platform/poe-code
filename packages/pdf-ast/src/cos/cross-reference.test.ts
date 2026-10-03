import { describe, expect, it, vi } from "vitest";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createByteCodec } from "@poe-code/compression";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { dictGet } from "../ast.js";
import { openPdfCrossReference } from "./cross-reference.js";

const text = (value: string) => new TextEncoder().encode(value);
const indexOptions = { runEntries: 2, chunkBytes: 64, cacheBytes: 128 };
async function fixture(bytes: Uint8Array, chunkBytes = 7) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  const readFile = vi.fn(async () => { throw new Error("whole read forbidden"); });
  const scratch = new Uint8Array(chunkBytes);
  const input = {
    capabilities: { retainedRead: true }, readFile,
    openReadFile: async () => ({
      stat: async () => ({ type: "file", size: bytes.length }), close: async () => {},
      read: async (offset: number, length: number) => {
        const slice = bytes.subarray(offset, offset + length);
        scratch.set(slice); return scratch.subarray(0, slice.length);
      },
    }),
  } as unknown as FileSystem;
  const source = await PdfFileSource.open(input, "/input.pdf", { chunkBytes, cacheBytes: chunkBytes * 2 });
  return { source, storage: { fs, directory: "/scratch" }, readFile };
}
function revisions() {
  const head = "%PDF-1.7\n";
  const old = head.length;
  const first = head + "xref\n0 3\n0 65535 f\n11 0 n\n22 0 n\ntrailer << /Size 3 /Root 1 0 R /Info 2 0 R /ID [(a)(b)] >>\n";
  const latest = first.length;
  return text(first + `xref\n1 1\n100 1 n\n1 2\n101 2 n\n0 1 f\ntrailer << /Size 3 /Prev ${old} >>\nstartxref\n${latest}\n%%EOF\n`);
}

describe("retained document cross-reference index", () => {
  it.each([1, 7, 64])("discovers real document indexes with %i-byte windows", async chunkBytes => {
    const doc = PdfDocument.create(); doc.addPage().drawText("bounded index", { x: 10, y: 20 });
    const bytes = doc.save();
    const expected = PdfDocument.load(bytes).cos;
    const { source, storage, readFile } = await fixture(bytes, chunkBytes);
    const result = await openPdfCrossReference(source, storage, { index: indexOptions });
    expect(result.version).toBe(expected.version);
    expect(result.rootRef).toEqual(expected.rootRef);
    expect(result.revisionCount).toBe(1);
    for (const [key, entry] of expected.revisions[0]!.entries) expect(await result.index.get(key)).toEqual(entry);
    expect(readFile).not.toHaveBeenCalled();
    await result.index.close();
    expect(await storage.fs.readdir("/scratch")).toEqual([]);
    expect((await source.read(0, 1))[0]).toBe(37);
    await source.close();
  });

  it("combines revisions newest first, resolves duplicate rows last and inherits security metadata", async () => {
    const { source, storage } = await fixture(revisions());
    const result = await openPdfCrossReference(source, storage, { index: indexOptions });
    expect(result.revisionCount).toBe(2);
    expect(await result.index.get(1)).toMatchObject({ offset: 101, generationNumber: 2 });
    expect(await result.index.get(2)).toMatchObject({ type: "free", generationNumber: 1 });
    expect(result.rootRef).toMatchObject({ objectNumber: 1 });
    expect(result.infoRef).toMatchObject({ objectNumber: 2 });
    expect(result.idArray?.items).toHaveLength(2);
    expect(dictGet(result.trailer, "Prev")).toBeDefined();
    await result.index.close();
    expect(await storage.fs.readdir("/scratch")).toEqual([]);
    await source.close();
  });

  it("stops cyclic Prev links using caller-backed visited offsets", async () => {
    const head = "%PDF-1.7\n";
    const first = head + `xref\n1 1\n11 0 n\ntrailer << /Root 1 0 R /Prev ${head.length} >>\nstartxref\n${head.length}\n%%EOF`;
    const { source, storage } = await fixture(text(first));
    const result = await openPdfCrossReference(source, storage, { index: indexOptions, maxRevisions: 1 });
    expect(result.revisionCount).toBe(1);
    await result.index.close();
    expect(await storage.fs.readdir("/scratch")).toEqual([]);
    await source.close();
  });

  it("cleans all indexes when revision admission or parsing fails", async () => {
    for (const bytes of [revisions(), text("%PDF-1.7\nxref\n1 1\n9 0 n\ntrailer << /Prev 1 >>\nstartxref\n9\n%%EOF")]) {
      const { source, storage } = await fixture(bytes);
      await expect(openPdfCrossReference(source, storage, { index: indexOptions, maxRevisions: 1 })).rejects.toBeDefined();
      expect(await storage.fs.readdir("/scratch")).toEqual([]);
      await source.close();
    }
  });
  it("opens generated compressed revisions with a bounded streaming decoder", async () => {
    const doc = PdfDocument.create(); doc.addPage();
    const bytes = doc.save({ objectStreams: "generate" });
    const expected = PdfDocument.load(bytes).cos;
    const { source, storage } = await fixture(bytes);
    const result = await openPdfCrossReference(source, storage, {
      index: indexOptions,
      async *decodeStream(object, chunks) {
        expect(dictGet(object.value as import("../ast.js").PdfCosDict, "Filter")).toMatchObject({ decoded: "FlateDecode" });
        const codec = createByteCodec({ direction: "decode", format: "zlib", chunkSize: 7 });
        try {
          for await (const chunk of chunks) yield* codec.push(chunk);
          if (!codec.complete) yield* codec.push(new Uint8Array(0), true);
        } finally { codec.close(); }
      },
    });
    for (const [key, entry] of expected.revisions[0]!.entries) expect(await result.index.get(key)).toEqual(entry);
    await result.index.close();
    expect(await storage.fs.readdir("/scratch")).toEqual([]);
    await source.close();
  });

  it("lets hybrid xref streams supersede classic free rows", async () => {
    const header = "%PDF-1.7\n";
    const binary = "3 0 obj << /Type /XRef /Size 4 /W [1 1 1] /Index [1 1] /Length 3 >> stream\n" + String.fromCharCode(2, 7, 3) + "\nendstream endobj\n";
    const table = header.length + binary.length;
    const bytes = text(header + binary + `xref\n1 1\n0 0 f\ntrailer << /Size 4 /Root 1 0 R /XRefStm ${header.length} >>\nstartxref\n${table}\n%%EOF`);
    const { source, storage } = await fixture(bytes);
    const result = await openPdfCrossReference(source, storage, { index: indexOptions });
    expect(await result.index.get(1)).toEqual({ objectNumber: 1, type: "compressed", objectStreamNumber: 7, indexInStream: 3 });
    await result.index.close();
    await source.close();
  });

  it("cleans caller-backed indexes after cancellation inside a pending decoder", async () => {
    const doc = PdfDocument.create(); doc.addPage();
    const { source, storage } = await fixture(doc.save({ objectStreams: "generate" }));
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    const operation = openPdfCrossReference(source, storage, {
      index: indexOptions, signal: controller.signal,
      decodeStream: () => ({ [Symbol.asyncIterator]: () => ({
        next: () => { started(); return new Promise<IteratorResult<Uint8Array>>(() => {}); }, return: returned,
      }) }),
    });
    await ready;
    controller.abort(new Error("cancel xref"));
    await expect(operation).rejects.toThrow("cancel xref");
    await vi.waitFor(async () => {
      expect(returned).toHaveBeenCalledOnce();
      expect(await storage.fs.readdir("/scratch")).toEqual([]);
    });
    await source.close();
  });

  it("uses the shared streaming Flate decoder by default", async () => {
    const doc = PdfDocument.create(); doc.addPage();
    const bytes = doc.save({ objectStreams: "generate" });
    const expected = PdfDocument.load(bytes).cos;
    const { source, storage } = await fixture(bytes);
    const result = await openPdfCrossReference(source, storage, { index: indexOptions });
    for (const [key, entry] of expected.revisions[0]!.entries) expect(await result.index.get(key)).toEqual(entry);
    await result.index.close();
    expect(await storage.fs.readdir("/scratch")).toEqual([]);
    await source.close();
  });

});
