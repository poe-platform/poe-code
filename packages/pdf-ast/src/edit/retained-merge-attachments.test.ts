import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { cosArray, cosDict, cosName, cosStream, cosString, dictSet, type PdfCosNode } from "../ast.js";
import { copyRetainedPagesChunks } from "./retained-page-copy.js";

const attachments = [[{ name: "shared.txt", text: "first wins" }, { name: "large.bin", text: "content".repeat(20000) }], [{ name: "shared.txt", text: "second loses" }, { name: "日本語.txt", text: "third" }]];
function attach(document: PdfDocument, rows: readonly { name: string; text: string }[]) {
  const pairs: PdfCosNode[] = [];
  for (const row of rows) {
    const stream = document.cos.allocateObject(cosStream(new TextEncoder().encode(row.text), { dict: cosDict({ Type: cosName("EmbeddedFile") }), compress: true }));
    const spec = document.cos.allocateObject(cosDict({ Type: cosName("Filespec"), F: cosString(row.name), UF: cosString(row.name), EF: cosDict({ F: stream, UF: stream }) }));
    pairs.push(cosString(row.name), spec);
  }
  const tree = document.cos.allocateObject(cosDict({ Names: cosArray(pairs) }));
  dictSet(document.cos.resolveDict(document.cos.rootRef)!, "Names", document.cos.allocateObject(cosDict({ EmbeddedFiles: tree })));
}
it.each([false, true])("merges attachments with exact bytes and first-name precedence (encrypted=%s)", async encrypted => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }, expected = PdfDocument.create(); let closed = 0;
  async function* sources() {
    for (const rows of attachments) {
      const original = PdfDocument.create(); original.addPage([100, 100]).drawText("Page", { x: 10, y: 10 }); attach(original, rows);
      const bytes = original.save(encrypted ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : {}); expected.copyPagesFrom(PdfDocument.load(bytes, { password: "reader" }), [0]); await fs.writeFile("/input", bytes);
      const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage, { password: "reader" });
      try { yield { document, indices: [0] }; } finally { await document.close(); await source.close(); closed++; }
    }
  }
  const chunks = []; for await (const bytes of copyRetainedPagesChunks(sources(), storage, { includeAttachments: true, chunkBytes: 4096 })) { expect(closed).toBe(2); expect(bytes.byteLength).toBeLessThanOrEqual(4096); chunks.push(bytes); }
  attach(expected, [...attachments[0]!, attachments[1]![1]!]);
  expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected.save()); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("yields to cancellation while collecting many small attachments", async () => {
  const { PdfMergeAttachments } = await import("./retained-merge-attachments.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel attachments");
  let closed = false, produced = 0;
  const document = { async *attachments() { try { for (let i = 0; i < 1000; i++) { produced++; yield { index: i, name: `${i}.txt`, contents: async function* () { yield Uint8Array.of(65); } }; } } finally { closed = true; } } } as unknown as PdfRetainedDocument;
  const pending = new PdfMergeAttachments({ fs, directory: "/scratch" }, controller.signal), timer = setTimeout(() => controller.abort(reason), 0);
  try { await expect(pending.append(document)).rejects.toBe(reason); }
  finally { clearTimeout(timer); await pending.close(); }
  expect(closed).toBe(true); expect(produced).toBeLessThan(1000); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("cancels final attachment allocation without leaking backing", async () => {
  const { PdfMergeAttachments } = await import("./retained-merge-attachments.js"), { PdfMutableObjectStore } = await import("../cos/mutable-object-store.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }, controller = new AbortController(), reason = new Error("cancel final attachments");
  const document = { async *attachments() { for (let i = 0; i < 200; i++) yield { index: i, name: `${i}.txt`, contents: async function* () { yield Uint8Array.of(65); } }; } } as unknown as PdfRetainedDocument;
  const pending = new PdfMergeAttachments(storage, controller.signal), target = new PdfMutableObjectStore(storage, { signal: controller.signal });
  let allocated = 0; const allocate = target.allocate.bind(target); target.allocate = async value => { allocated++; return allocate(value); };
  try {
    await pending.append(document); const timer = setTimeout(() => controller.abort(reason), 0);
    try { await expect(pending.finish(target, cosDict({}))).rejects.toBe(reason); expect(allocated).toBeLessThan(400); } finally { clearTimeout(timer); }
  } finally { await pending.close(); await target.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["producer", "write"])("preserves %s errors and closes suspended attachment contents", async mode => {
  const { PdfMergeAttachments } = await import("./retained-merge-attachments.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const reason = new Error("attachment failure"); let closed = false;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "open" && mode === "write") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const descriptor = await fs.open!(...args);
      return new Proxy(descriptor, { get(handle, property) {
        if (property === "write") return async () => { throw reason; };
        const value = Reflect.get(handle, property); return typeof value === "function" ? value.bind(handle) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const document = { async *attachments() { yield { index: 0, name: "generated", contents: async function* () {
    try { const bytes = new Uint8Array(4096); let state = 13; for (let i = 0; i < 100; i++) { for (let at = 0; at < bytes.length; at++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; bytes[at] = state >>> 24; } yield bytes; if (mode === "producer") throw reason; } }
    finally { closed = true; }
  } }; } } as unknown as PdfRetainedDocument;
  const pending = new PdfMergeAttachments({ fs: guarded, directory: "/scratch" }, new AbortController().signal);
  try { await expect(pending.append(document)).rejects.toBe(reason); } finally { await pending.close(); }
  expect(closed).toBe(true); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([65536, 262144])("streams %i generated attachment bytes through bounded storage writes", async length => {
  const { PdfMergeAttachments } = await import("./retained-merge-attachments.js"), { PdfMutableObjectStore } = await import("../cos/mutable-object-store.js"), { createCompressionCodec } = await import("@poe-code/compression");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let outstanding = 0, peak = 0, started = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole payload operation forbidden"); };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const descriptor = await fs.open!(...args);
      return new Proxy(descriptor, { get(handle, property) {
        if (property === "write") return async (bytes: Uint8Array, ...args: unknown[]) => {
          expect(outstanding).toBe(0); outstanding += bytes.length; peak = Math.max(peak, outstanding); expect(bytes.buffer.byteLength).toBeLessThanOrEqual(16384);
          try { await Promise.resolve(); return await Reflect.apply(handle.write!, handle, [bytes, ...args]); } finally { outstanding -= bytes.length; }
        };
        const value = Reflect.get(handle, property); return typeof value === "function" ? value.bind(handle) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const storage = { fs: guarded, directory: "/scratch" }, signal = new AbortController().signal, pending = new PdfMergeAttachments(storage, signal), target = new PdfMutableObjectStore(storage);
  const document = { async *attachments() {
    for (let duplicate = 0; duplicate < 2; duplicate++) yield { index: duplicate, name: "reused", contents: async function* () {
      started++; const bytes = new Uint8Array(1024); let state = 17;
      for (let at = 0; at < length; at += bytes.length) { for (let i = 0; i < bytes.length; i++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; bytes[i] = state >>> 24; } yield bytes; }
    } };
  } } as unknown as PdfRetainedDocument;
  try {
    await pending.append(document); await pending.finish(target, cosDict({})); expect(started).toBe(1);
    const object = (await target.get(1))!, { CodecReader, codec } = createCompressionCodec();
    async function* encoded() { yield* object.stream!.chunks; }
    const reader = new CodecReader(encoded(), signal); let total = 0, state = 17;
    try { for await (const bytes of codec(reader, { mode: "inflate-zlib", chunkSize: 4096 }, signal)) {
      for (const byte of bytes) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; if (byte !== state >>> 24) throw new Error("payload changed"); }
      total += bytes.length; await Promise.resolve();
    } } finally { await reader.close(); }
    expect(total).toBe(length); expect(peak).toBeLessThanOrEqual(16384); expect(peak).toBeGreaterThan(0);
  } finally { await pending.close(); await target.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
