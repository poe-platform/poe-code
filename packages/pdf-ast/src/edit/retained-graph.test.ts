import { it, expect } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { editRetainedDocument } from "./retained-graph.js";

it("drops the information reference after removing information without ModDate", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" };
  const input = PdfDocument.create(); input.addPage(); input.setTitle("Removed"); await fs.writeFile("/input", input.save());
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage);
  const edited = await editRetainedDocument(document, storage, { removeInfo: true });
  try { expect(edited.document.crossReference.infoRef).toBeUndefined(); expect(await edited.document.info()).toEqual({}); }
  finally { await edited.close(); await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

for (const mode of ["write", "cancel"]) it(`cleans editable graph backing after ${mode} failure`, async () => {
  const { cosStream } = await import("../ast.js");
  const base = createMemoryFileSystem(); await base.mkdir("/scratch");
  const input = PdfDocument.create(); input.addPage(); input.cos.allocateObject(cosStream(new Uint8Array(262144).fill(65), { compress: false })); await base.writeFile("/input", input.save());
  const controller = new AbortController(), reason = new Error("graph backing failure"); let active = false, opened = 0, closed = 0;
  const fs = new Proxy(base, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file graph I/O forbidden"); };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof base.open>>) => {
      const handle = await base.open!(...args); if (!active) return handle; opened++;
      return new Proxy(handle, { get(owner, key) {
        if (key === "write") return async (...args: Parameters<typeof handle.write>) => { if (mode === "cancel") controller.abort(reason); else throw reason; return handle.write(...args); };
        if (key === "close") return async () => { closed++; await handle.close(); };
        const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const storage = { fs, directory: "/scratch" }, source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage);
  const before = await base.readdir("/scratch"); active = true;
  try { await expect(editRetainedDocument(document, storage, { signal: controller.signal })).rejects.toBe(reason); expect(opened).toBeGreaterThan(0); expect(closed).toBe(opened); expect(await base.readdir("/scratch")).toEqual(before); }
  finally { await document.close(); await source.close(); }
  expect(await base.readdir("/scratch")).toEqual([]);
});

it.each([false, true])("appends a linearization marker while preserving trailer identity (existing=%s)", async existing => {
  const { cosArray, cosDict, cosNumber, cosString, dictGet } = await import("../ast.js");
  const { serializeCosDocument } = await import("../cos/writer.js");
  const { saveRetainedDocumentChunks } = await import("./retained-save.js");
  const original = PdfDocument.create(); original.addPage(); original.addPage();
  const idArray = cosArray([cosString("retained identifier"), cosString("retained revision")]);
  const input = serializeCosDocument({ objects: [...original.cos.objects.values()], rootRef: original.cos.rootRef, infoRef: original.cos.infoRef, idArray, linearize: existing });
  const expected = PdfDocument.load(input); expected.cos.allocateObject(cosDict({ Linearized: cosNumber(1), N: cosNumber(2) }));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", input); const storage = { fs, directory: "/scratch" };
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage), edited = await editRetainedDocument(document, storage, { linearize: true });
  try {
    expect(edited.document.crossReference.idArray).toEqual(document.crossReference.idArray);
    expect(dictGet(edited.document.crossReference.trailer, "ID")).toEqual(document.crossReference.idArray);
    const chunks = []; for await (const bytes of saveRetainedDocumentChunks(edited.document, storage)) chunks.push(bytes);
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected.save());
  } finally { await edited.close(); await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
