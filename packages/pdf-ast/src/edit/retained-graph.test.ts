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
