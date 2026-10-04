import { createByteCodec } from "@poe-code/compression";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { parseCosDocument } from "./parser.js";
import { serializeCosDocument } from "./writer.js";
import { serializeRetainedCosDocumentChunks } from "./retained-writer.js";
import { saveRetainedDocumentChunks } from "../edit/retained-save.js";
import { retainedCosObjects } from "./retained-objects.js";
import { prepareEncryptedCosDocumentSteps } from "./security.js";
import { encodeAsciiHex } from "./filters.js";
import { cosArray, cosDict, cosName, cosNull, cosNumber, cosStream, cosString, dictGet, dictSet } from "../ast.js";

it.each(["ordinary", "encrypted", "explicit-crypt", "object-stream"])("rewrites all %s COS objects with exact serializer bytes", async mode => {
  const original = PdfDocument.create(); original.addPage([100, 200]).drawText("Retained rewrite", { x: 10, y: 20 });
  original.cos.allocateObject(cosStream(new TextEncoder().encode("unreachable payload".repeat(20000)), { dict: cosDict({ Type: cosName("Unused"), Value: cosNumber(17) }), compress: true }));
  original.cos.objects.set(900, { objectNumber: 900, generationNumber: 4, value: cosString("sparse generation") });
  let input = original.save(mode === "encrypted" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : mode === "object-stream" ? { objectStreams: "generate" } : {});
  if (mode === "explicit-crypt") {
    const root = original.cos.resolveDict(original.cos.rootRef)!;
    for (const ref of [original.cos.rootRef, dictGet(root, "Pages")!, original.getPage(0).ref]) {
      if (ref.kind !== "ref") throw new Error("Missing structural reference");
      const object = original.cos.objects.get(ref.objectNumber)!;
      original.cos.objects.set(ref.objectNumber, { ...object, value: cosStream(new TextEncoder().encode("structural payload"), { dict: object.value as ReturnType<typeof cosDict>, compress: true }) });
    }
    const work = prepareEncryptedCosDocumentSteps(original.cos, { userPassword: "reader", ownerPassword: "owner" }); let step = work.next(); while (!step.done) step = work.next();
    const prepared = step.value;
    const objects = prepared.objects.map(object => {
      if (object.value.kind !== "stream") return object;
      const stream = object.value, filter = dictGet(stream.dict, "Filter");
      dictSet(stream.dict, "Filter", cosArray([cosName("ASCIIHexDecode"), cosName("Crypt"), ...(filter?.kind === "array" ? filter.items : filter ? [filter] : [])]));
      dictSet(stream.dict, "DecodeParms", cosArray([cosNull(), cosDict({ Name: cosName("StdCF") }), ...(filter ? [cosNull()] : [])]));
      return { ...object, value: cosStream(encodeAsciiHex(stream.rawBytes), { dict: stream.dict, compress: false }) };
    });
    input = serializeCosDocument({ ...prepared, objects });
  }
  const parsed = parseCosDocument(input, { password: "reader" });
  const expected = serializeCosDocument({ objects: [...parsed.objects.values()], rootRef: parsed.rootRef, infoRef: parsed.infoRef, idArray: parsed.idArray, version: parsed.version });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", input); const storage = { fs, directory: "/scratch" };
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage, { password: "reader" });
  try {
    const ref = document.crossReference, chunks = [];
    for await (const bytes of serializeRetainedCosDocumentChunks({ objects: retainedCosObjects(document, storage), rootRef: ref.rootRef, infoRef: ref.infoRef, idArray: ref.idArray, version: ref.version, chunkBytes: 4096 }, storage)) { expect(bytes.length).toBeLessThanOrEqual(4096); chunks.push(bytes); }
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected);
    if (mode === "explicit-crypt") {
      const saved = []; for await (const bytes of saveRetainedDocumentChunks(document, storage)) saved.push(bytes);
      expect(new Uint8Array(Buffer.concat(saved))).toEqual(PdfDocument.load(input, { password: "reader" }).save());
    }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("admits object and stream budgets before parsing or pulling payloads", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let parsed = 0, pulled = 0;
  const document = { crossReference: { index: { async *entries() { yield { objectNumber: 1, type: "uncompressed" }; } } }, objects: {
    async get() { parsed++; return { value: cosDict({}), stream: { start: 0, end: 100 } }; },
    async *decodeStream() { pulled++; yield new Uint8Array(100); },
  } } as unknown as PdfRetainedDocument;
  const objects = retainedCosObjects(document, { fs, directory: "/scratch" }, { maxObjects: 0 });
  await expect(objects.next()).rejects.toThrow("count limit"); expect(parsed).toBe(0); expect(pulled).toBe(0);
  await expect(retainedCosObjects(document, { fs, directory: "/scratch" }, { maxStreamBytes: 99 }).next()).rejects.toThrow("stream byte limit"); expect(parsed).toBe(1); expect(pulled).toBe(0);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("cancels raw payload iteration cooperatively and closes the producer", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel raw rewrite"); let pulled = 0, closed = false;
  const document = { crossReference: { index: { async *entries() { yield { objectNumber: 1, type: "uncompressed" }; } } }, objects: {
    async get() { return { value: cosDict({}), stream: { start: 0, end: 10000 } }; },
    async *decodeStream() { try { const bytes = Uint8Array.of(1); for (let i = 0; i < 10000; i++) { pulled++; yield bytes; } } finally { closed = true; } },
  } } as unknown as PdfRetainedDocument;
  const objects = retainedCosObjects(document, { fs, directory: "/scratch" }, { signal: controller.signal }), timer = setTimeout(() => controller.abort(reason), 0);
  try { await expect((async () => { for await (const object of objects) for await (const ignored of object.stream!.chunks) void ignored; })()).rejects.toBe(reason); }
  finally { clearTimeout(timer); await objects.return(); }
  expect(pulled).toBeLessThan(10000); expect(closed).toBe(true);
});

it.each([65536, 262144].flatMap(length => (["preserve", "compress", "uncompress"] as const).map(streamMode => ({ length, streamMode } as const))))("stages $length bytes in $streamMode mode with bounded writes and releases early-return backing", async ({ length, streamMode }) => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let outstanding = 0, peak = 0, writes = 0, closed = false, pulled = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole file operation forbidden"); };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer!;
      return { ...staged, writer: { ...writer, write: async (bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) => {
        expect(outstanding).toBe(0); outstanding += bytes.length; peak = Math.max(peak, outstanding); writes++; expect(bytes.buffer.byteLength).toBeLessThanOrEqual(65536);
        try { await Promise.resolve(); return await writer.write(bytes, options); } finally { outstanding -= bytes.length; }
      }, finish: writer.finish.bind(writer) } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const document = { encryption: {}, crossReference: { index: { async *entries() { yield { objectNumber: 1, type: "uncompressed" }; pulled++; yield { objectNumber: 2, type: "uncompressed" }; } } }, objects: {
    async get() { return { value: cosDict({}), stream: { start: 0, end: length + 32 } }; },
    async *decodeStream() { try { const bytes = new Uint8Array(1024); for (let at = 0; at < length; at += bytes.length) { bytes.fill(at / bytes.length % 251); yield bytes; } } finally { closed = true; } },
  } } as unknown as PdfRetainedDocument;
  const objects = retainedCosObjects(document, { fs: guarded, directory: "/scratch" }, { streamMode });
  try {
    const first = await objects.next(); if (first.done) throw new Error("missing object"); if (streamMode !== "compress") expect(first.value.stream!.length).toBe(length);
    let read = 0; const payload = streamMode === "compress" ? inflateChunks(first.value.stream!.chunks) : first.value.stream!.chunks; for await (const bytes of payload) { for (const byte of bytes) if (byte !== Math.floor(read++ / 1024) % 251) throw new Error("Decrypted bytes changed"); await Promise.resolve(); }
    expect(read).toBe(length); expect(writes).toBeGreaterThan(0); expect(peak).toBeLessThanOrEqual(65536); expect(pulled).toBe(0); expect(closed).toBe(true);
  } finally { await objects.return(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["producer", "write", "cancel"].flatMap(mode => (["preserve", "compress", "uncompress"] as const).map(streamMode => ({ mode, streamMode } as const))))("cleans staged objects and preserves $mode failure in $streamMode mode", async ({ mode, streamMode }) => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("rewrite failure"); let closed = false;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "createStagedFile" && mode === "write") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args); return { ...staged, writer: { ...staged.writer!, write: async () => { throw reason; } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const document = { encryption: {}, crossReference: { index: { async *entries() { yield { objectNumber: 1, type: "uncompressed" }; } } }, objects: {
    async get() { return { value: cosDict({}), stream: { start: 0, end: 1 } }; },
    async *decodeStream() { try { yield Uint8Array.of(1); if (mode === "producer") throw reason; if (mode === "cancel") controller.abort(reason); yield Uint8Array.of(2); } finally { closed = true; } },
  } } as unknown as PdfRetainedDocument;
  const objects = retainedCosObjects(document, { fs: guarded, directory: "/scratch" }, { signal: controller.signal, streamMode });
  try { await expect(objects.next()).rejects.toBe(reason); } finally { await objects.return(); }
  expect(closed).toBe(true); expect(await fs.readdir("/scratch")).toEqual([]);
});

async function* inflateChunks(chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) {
  const codec = createByteCodec({ direction: "decode", format: "zlib", chunkSize: 4096 });
  try { for await (const chunk of chunks) yield* codec.push(chunk); }
  finally { codec.close(); }
}
