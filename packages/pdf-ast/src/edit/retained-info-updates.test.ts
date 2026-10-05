import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { editRetainedDocument } from "./retained-graph.js";
import { saveRetainedDocumentChunks } from "./retained-save.js";
import type { RetainedInfoUpdate } from "./retained-info-updates.js";

it.each([256, 512])("stages %i generated metadata edits with bounded writes", async count => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const original = PdfDocument.create(); original.addPage(); await fs.writeFile("/input", original.save());
  let writes = 0, outstanding = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args); return new Proxy(handle, { get(target, prop) {
        if (prop === "write") return async (...args: Parameters<NonNullable<typeof handle.write>>) => {
          expect(outstanding).toBe(0); expect(args[0].buffer.byteLength).toBeLessThanOrEqual(65536); outstanding += args[0].length; writes++;
          try { await Promise.resolve(); return await handle.write!(...args); } finally { outstanding -= args[0].length; }
        };
        const value = Reflect.get(target, prop); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const source = await PdfFileSource.open(guarded, "/input"), storage = { fs: guarded, directory: "/scratch" }, document = await PdfRetainedDocument.open(source, storage);
  async function* updates(): AsyncGenerator<RetainedInfoUpdate> {
    const bytes = new Uint8Array(2);
    for (let index = 0; index < count; index++) {
      bytes.fill(index % 256); yield { kind: "id", index: 0, bytes };
      yield { kind: "info", key: "Title", value: `Title ${index}` };
      yield { kind: "page", pageNumber: 1, property: "dimensions", values: [index + 1, index + 2] };
      yield { kind: "label", index, start: 1, prefix: `${index}`, style: "D" };
      yield { kind: "bookmark", title: `Title ${index}`, level: 1, pageNumber: 1 };
    }
    bytes.fill(0);
  }
  try {
    const edited = await editRetainedDocument(document, storage, { infoUpdates: updates() });
    try {
      const page = await edited.getPage(0); expect((await page.attributes()).mediaBox).toEqual([0, 0, count, count + 1]);
      expect(edited.document.crossReference.idArray?.items[0]).toMatchObject({ kind: "string", bytes: Uint8Array.of(255, 255) });
      let outputBytes = 0; for await (const bytes of saveRetainedDocumentChunks(edited.document, storage)) { expect(bytes.buffer.byteLength).toBeLessThanOrEqual(65536); outputBytes += bytes.length; await Promise.resolve(); }
      expect(outputBytes).toBeGreaterThan(count * 40); expect(writes).toBeGreaterThan(0); expect(outstanding).toBe(0);
    } finally { await edited.close(); }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["producer", "cancel", "write"])("cleans metadata staging after %s failure", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const original = PdfDocument.create(); original.addPage(); await fs.writeFile("/input", original.save());
  const reason = new Error("metadata failed"), controller = new AbortController(); let failWrites = false, finalized = false;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args); return new Proxy(handle, { get(target, prop) {
        if (prop === "write") return async (...args: Parameters<NonNullable<typeof handle.write>>) => { if (failWrites) throw reason; return handle.write!(...args); };
        const value = Reflect.get(target, prop); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const source = await PdfFileSource.open(guarded, "/input"), storage = { fs: guarded, directory: "/scratch" }, document = await PdfRetainedDocument.open(source, storage);
  const baseline = await fs.readdir("/scratch");
  async function* updates(): AsyncGenerator<RetainedInfoUpdate> {
    try {
      yield { kind: "label", index: 0, start: 1 };
      if (mode === "producer") throw reason;
      if (mode === "cancel") controller.abort(reason);
      if (mode === "write") failWrites = true;
      for (let index = 0; index < 512; index++) yield { kind: "bookmark", title: `Title ${index}`, level: 1, pageNumber: 1 };
    } finally { finalized = true; }
  }
  try {
    await expect(editRetainedDocument(document, storage, { infoUpdates: updates(), signal: controller.signal })).rejects.toBe(reason);
    expect(finalized).toBe(true); expect(await fs.readdir("/scratch")).toEqual(baseline);
  } finally { failWrites = false; await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
