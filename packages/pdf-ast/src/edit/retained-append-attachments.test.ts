import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { editRetainedDocument } from "./retained-graph.js";
import { saveRetainedDocumentChunks } from "./retained-save.js";
import { dictGet } from "../ast.js";

it.each(["success", "producer", "write", "cancel"])("appends reused payload chunks with bounded writes and %s cleanup", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const original = PdfDocument.create(); original.addPage(); await fs.writeFile("/in", original.save());
  const controller = new AbortController(), reason = new Error("append failed"); let peak = 0, outstanding = 0, closed = false, injecting = false;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file operation forbidden"); };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const file = await fs.createStagedFile!(...args), writer = file.writer!;
      return { ...file, writer: { ...writer, write: async (bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) => {
        if (mode === "write" && injecting) throw reason;
        expect(outstanding).toBe(0); outstanding += bytes.length; peak = Math.max(peak, bytes.buffer.byteLength);
        try { await Promise.resolve(); return await writer.write(bytes, options); } finally { outstanding -= bytes.length; }
      }, finish: writer.finish.bind(writer) } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const storage = { fs: guarded, directory: "/scratch" }, source = await PdfFileSource.open(guarded, "/in"), document = await PdfRetainedDocument.open(source, storage);
  let edited: Awaited<ReturnType<typeof editRetainedDocument>> | undefined;
  async function* payload() {
    try { injecting = true; const bytes = new Uint8Array(1024); for (let i = 0; i < 256; i++) { bytes.fill(i); yield bytes; if (mode === "producer") throw reason; if (mode === "cancel") controller.abort(reason); } }
    finally { closed = true; }
  }
  async function* attachments() { yield { filename: "binary", chunks: payload() }; }
  try {
    const result = editRetainedDocument(document, storage, { appendAttachments: attachments(), ...(mode === "success" ? { attachments: [{ key: "existing", filename: "first", length: 1, chunks: [Uint8Array.of(7)] }] } : {}), attachmentPageIndex: 0, signal: controller.signal });
    if (mode !== "success") await expect(result).rejects.toBe(reason);
    else {
      edited = await result; const chunks = []; for await (const bytes of saveRetainedDocumentChunks(edited.document, storage)) chunks.push(bytes);
      const loaded = PdfDocument.load(new Uint8Array(Buffer.concat(chunks)));
      const embeddedObjects = [...loaded.cos.objects.values()].filter(object => object.value.kind === "stream" && dictGet(object.value.dict, "Type")?.kind === "name" && (dictGet(object.value.dict, "Type") as { decoded: string }).decoded === "EmbeddedFile");
      expect(embeddedObjects.length).toBe(2); const embedded = embeddedObjects.at(-1)!;
      if (embedded.value.kind !== "stream") throw new Error("missing attachment");
      const bytes = loaded.cos.decodeStream(embedded.value); expect(bytes.length).toBe(256 * 1024);
      for (let i = 0; i < bytes.length; i++) if (bytes[i] !== Math.floor(i / 1024)) throw new Error("attachment bytes changed");
      expect(peak).toBeLessThanOrEqual(16384); expect(peak).toBeGreaterThan(0);
    }
  } finally { await edited?.close(); await document.close(); await source.close(); }
  expect(closed).toBe(true); expect(await fs.readdir("/scratch")).toEqual([]);
});
