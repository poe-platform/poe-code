import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { FileReadHandle, FileSystem } from "@poe-code/safe-fs/contracts";
import { createByteCodec } from "@poe-code/compression";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { dictGet, type PdfXRefEntry } from "../ast.js";
import { PdfObjectIndex } from "./object-index.js";
import { readCosXrefRevision } from "./range-xref.js";

function input(bytes: Uint8Array, chunkBytes = 16) {
  const scratch = new Uint8Array(chunkBytes);
  const read = vi.fn(async (offset: number, length: number) => {
    const count = Math.min(length, bytes.length - offset);
    scratch.set(bytes.subarray(offset, offset + count));
    return scratch.subarray(0, count);
  });
  const close = vi.fn(async () => {});
  const handle = { read, close, stat: async () => ({ type: "file", size: bytes.length }) } as unknown as FileReadHandle;
  const fs = { capabilities: { retainedRead: true }, openReadFile: async () => handle,
    readFile: () => { throw new Error("full read forbidden"); } } as unknown as FileSystem;
  return { read, close, open: () => PdfFileSource.open(fs, "/input.pdf", { chunkBytes, cacheBytes: chunkBytes * 2 }) };
}
const text = (value: string) => new TextEncoder().encode(value);
function stream(widths: string, index: string, data: readonly number[], size = "3") {
  const head = text(`1 0 obj << /Type /XRef /W ${widths} /Index ${index} /Size ${size} /Root 2 0 R /Length ${data.length} >> stream\n`);
  const tail = text("\nendstream endobj");
  const bytes = new Uint8Array(head.length + data.length + tail.length);
  bytes.set(head); bytes.set(data, head.length); bytes.set(tail, head.length + data.length);
  return bytes;
}

async function collect(source: PdfFileSource, offset: number, options: Parameters<typeof readCosXrefRevision>[2] = {}) {
  const iterator = readCosXrefRevision(source, offset, options);
  const entries: PdfXRefEntry[] = [];
  let step = await iterator.next();
  while (!step.done) { entries.push(step.value); step = await iterator.next(); }
  return { entries, trailer: step.value };
}

describe("range cross-reference revisions", () => {
  it("feeds classic entries directly into external index storage", async () => {
    const doc = PdfDocument.create();
    doc.addPage().drawText("xref parity", { x: 20, y: 20 });
    const bytes = doc.save();
    const expected = PdfDocument.load(bytes).cos.revisions[0]!;
    const file = input(bytes);
    const source = await file.open();
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    const index = await PdfObjectIndex.build(readCosXrefRevision(source, expected.xrefOffset), { fs, directory: "/scratch" }, { runEntries: 2, chunkBytes: 32, cacheBytes: 64 });
    for (const [key, entry] of expected.entries) expect(await index.get(key)).toEqual(entry);
    await index.close();
    expect(await fs.readdir("/scratch")).toEqual([]);
    expect(file.close).not.toHaveBeenCalled();
    await source.close();
  });

  it("returns the trailer and preserves incremental metadata", async () => {
    const file = input(text("xref\n0 2\n0000000000 65535 f\n0000000017 00002 n\ntrailer << /Size 2 /Root 1 2 R /Prev 9 /ID [<0102> <0304>] >>"));
    const source = await file.open();
    const result = await collect(source, 0);
    expect(result.entries).toEqual([
      { type: "free", objectNumber: 0, nextFreeObjectNumber: 0, generationNumber: 65535 },
      { type: "uncompressed", objectNumber: 1, offset: 17, generationNumber: 2 },
    ]);
    expect(dictGet(result.trailer, "Prev")).toMatchObject({ value: 9 });
    expect(dictGet(result.trailer, "Root")).toMatchObject({ objectNumber: 1, generationNumber: 2 });
    await source.close();
  });

  it("preserves every binary entry type across byte-sized source chunks", async () => {
    const file = input(stream("[1 2 1]", "[0 3]", [0, 0, 0, 255, 1, 1, 2, 3, 2, 0, 7, 4]), 1);
    const source = await file.open();
    const result = await collect(source, 0);
    expect(result.entries).toEqual([
      { type: "free", objectNumber: 0, nextFreeObjectNumber: 0, generationNumber: 255 },
      { type: "uncompressed", objectNumber: 1, offset: 258, generationNumber: 3 },
      { type: "compressed", objectNumber: 2, objectStreamNumber: 7, indexInStream: 4 },
    ]);
    await source.close();
  });

  it("decodes generated compressed xrefs through bounded codec chunks", async () => {
    const doc = PdfDocument.create(); doc.addPage();
    const bytes = doc.save({ objectStreams: "generate" });
    const expected = PdfDocument.load(bytes).cos.revisions[0]!;
    const file = input(bytes);
    const source = await file.open();
    const result = await collect(source, expected.xrefOffset, {
      async *decodeStream(object, input, signal) {
        expect(dictGet(object.value as import("../ast.js").PdfCosDict, "Filter")).toMatchObject({ decoded: "FlateDecode" });
        const codec = createByteCodec({ direction: "decode", format: "zlib", chunkSize: 7 });
        try {
          for await (const chunk of input) { signal?.throwIfAborted(); yield* codec.push(chunk, false); }
          if (!codec.complete) yield* codec.push(new Uint8Array(0), true);
        } finally { codec.close(); }
      },
    });
    expect(result.entries).toEqual([...expected.entries.values()]);
    await source.close();
  });

  it.each(["[0 0 0]", "[1 -1 1]", "[1 0.5 1]", "[1 /Unknown 1]", "[1 1]"])("rejects invalid widths %s before asking for decoded bytes", async widths => {
    const file = input(stream(widths, "[0 1]", [1]));
    const source = await file.open();
    const decodeStream = vi.fn(async function* () { yield new Uint8Array([1]); });
    await expect(collect(source, 0, { decodeStream })).rejects.toMatchObject({ code: "E_PARSE" });
    expect(decodeStream).not.toHaveBeenCalled();
    await source.close();
  });

  it("rejects truncated records, unknown types and object-budget overflow", async () => {
    for (const [bytes, code] of [
      [stream("[1 1 0]", "[0 2]", [1, 9]), "E_PARSE"],
      [stream("[1 1 0]", "[0 1]", [3, 9]), "E_PARSE"],
      [stream("[0 1 0]", "[0 20]", new Array<number>(20).fill(9)), "E_LIMIT"],
    ] as const) {
      const source = await input(bytes).open();
      await expect(collect(source, 0, { maxEntries: 3 })).rejects.toMatchObject({ code });
      await source.close();
    }
  });
  it("pulls decoded rows on demand and closes the decoder on early return", async () => {
    const file = input(stream("[1 1 0]", "[0 3]", [1, 9, 1, 10, 1, 11]));
    const source = await file.open();
    let pulls = 0;
    const closed = vi.fn();
    const iterator = readCosXrefRevision(source, 0, {
      async *decodeStream() {
        try { for (let i = 0; i < 3; i++) { pulls++; yield new Uint8Array([1, 9 + i]); } }
        finally { closed(); }
      },
    });
    expect((await iterator.next()).value).toMatchObject({ offset: 9 });
    expect(pulls).toBe(1);
    await iterator.return(undefined as never);
    expect(closed).toHaveBeenCalledOnce();
    expect(file.close).not.toHaveBeenCalled();
    await source.close();
  });

  it("charges trailing decoded bytes and retains the primary decoder error", async () => {
    const source = await input(stream("[1 1 0]", "[0 1]", [1, 9])).open();
    const closed = vi.fn(() => { throw new Error("cleanup"); });
    await expect(collect(source, 0, {
      maxDecodedBytes: 2,
      async *decodeStream() {
        try { yield new Uint8Array([1, 9]); yield new Uint8Array([0]); }
        finally { closed(); }
      },
    })).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(closed).toHaveBeenCalledOnce();
    await source.close();
  });

  it("preserves sparse ranges and zero-width defaults", async () => {
    const source = await input(stream("[0 1 0]", "[7 1 20 1]", [45, 99], "21")).open();
    expect((await collect(source, 0)).entries).toEqual([
      { type: "uncompressed", objectNumber: 7, offset: 45, generationNumber: 0 },
      { type: "uncompressed", objectNumber: 20, offset: 99, generationNumber: 0 },
    ]);
    await source.close();
  });

  it("aborts a pending decoder pull without closing the retained source", async () => {
    const file = input(stream("[1 1 0]", "[0 1]", [1, 9]));
    const source = await file.open();
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const operation = collect(source, 0, {
      signal: controller.signal,
      decodeStream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => { started(); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
          return: close,
        }),
      }),
    });
    await ready;
    controller.abort(new Error("stop decoding"));
    await expect(operation).rejects.toThrow("stop decoding");
    expect(close).toHaveBeenCalledOnce();
    expect(file.close).not.toHaveBeenCalled();
    await source.close();
  });

  it("rejects declared decoded records before starting the decoder", async () => {
    const source = await input(stream("[1 1 0]", "[0 3]", [1, 9, 1, 10, 1, 11])).open();
    const decodeStream = vi.fn(async function* () { yield new Uint8Array([1, 9]); });
    await expect(collect(source, 0, { maxDecodedBytes: 5, decodeStream })).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(decodeStream).not.toHaveBeenCalled();
    await source.close();
  });

  it("uses retained replayable input for CCITT xref streams", async () => {
    const head = text("1 0 obj << /Type /XRef /W [0 1 0] /Index [1 8] /Size 9 /Root 1 0 R /Filter /CCF /DecodeParms << /K -1 /Columns 8 >> /Length 1 >> stream\n");
    const tail = text("\nendstream endobj");
    const bytes = new Uint8Array(head.length + 1 + tail.length);
    bytes.set(head); bytes[head.length] = 255; bytes.set(tail, head.length + 1);
    const source = await input(bytes, 1).open();
    const result = await collect(source, 0);
    expect(result.entries).toHaveLength(8);
    expect(result.entries[7]).toEqual({ type: "uncompressed", objectNumber: 8, offset: 255, generationNumber: 0 });
    await source.close();
  });

});
