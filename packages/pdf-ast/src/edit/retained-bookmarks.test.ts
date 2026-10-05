import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { cosArray, cosDict, cosName, cosString, dictGet, dictSet, type PdfCosDict } from "../ast.js";
import { editRetainedDocument } from "./retained-graph.js";

it.each([256, 512])("stages %i generated nested bookmarks with bounded caller writes", async count => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const original = PdfDocument.create(); original.addPage(); await fs.writeFile("/input", original.save());
  let outstanding = 0, writes = 0;
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
  try {
    async function* bookmarks() { for (let i = 0; i < count; i++) yield { title: `Title ${i}`, level: i + 1, pageNumber: i + 1 }; }
    const edited = await editRetainedDocument(document, storage, { bookmarks: bookmarks() });
    try {
      const catalog = await edited.document.lookup(edited.document.crossReference.rootRef);
      const outlines = await edited.document.lookup(dictGet(catalog!.value as PdfCosDict, "Outlines"));
      let cursor = dictGet(outlines!.value as PdfCosDict, "First");
      for (let index = 0; index < count; index++) {
        const item = await edited.document.lookup(cursor);
        expect(dictGet(item!.value as PdfCosDict, "Title")).toMatchObject({ kind: "string" });
        expect(dictGet(item!.value as PdfCosDict, "Dest")).toMatchObject({ kind: "array", items: [{ kind: "ref", objectNumber: (await edited.getPage(0)).reference!.objectNumber }, { kind: "name" }, { kind: "null" }, { kind: "null" }, { kind: "null" }] });
        cursor = dictGet(item!.value as PdfCosDict, "First");
      }
      expect(cursor).toBeUndefined(); expect(writes).toBeGreaterThan(0); expect(outstanding).toBe(0);
    } finally { await edited.close(); }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["producer", "cancel", "depth", "invalid", "write"])("closes bookmark backing after %s failure", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const original = PdfDocument.create(); original.addPage(); await fs.writeFile("/input", original.save());
  const controller = new AbortController(), reason = new Error("bookmark failure"); let failWrites = false, finalized = false;
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
  async function* bookmarks() {
    try {
      yield { title: "First", level: 1, pageNumber: 1 };
      if (mode === "producer") throw reason;
      if (mode === "cancel") controller.abort(reason);
      if (mode === "write") failWrites = true;
      for (let index = 0; index < 512; index++) yield { title: "Next", level: mode === "invalid" ? NaN : index + 2, pageNumber: 1 };
    } finally { finalized = true; }
  }
  try {
    const promise = editRetainedDocument(document, storage, { bookmarks: bookmarks(), signal: controller.signal, ...(mode === "depth" ? { maxRecursionDepth: 8 } : {}) });
    if (mode === "depth") await expect(promise).rejects.toMatchObject({ code: "E_LIMIT" });
    else if (mode === "invalid") await expect(promise).rejects.toBeInstanceOf(RangeError);
    else await expect(promise).rejects.toBe(reason);
    expect(finalized).toBe(true); expect(await fs.readdir("/scratch")).toEqual(baseline);
  } finally { failWrites = false; await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["empty", "no-pages", "inline-page"])("preserves %s bookmark editing semantics", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const original = PdfDocument.create();
  if (mode !== "no-pages") original.addPage();
  const catalog = original.cos.resolveDict(original.cos.rootRef)!;
  dictSet(catalog, "Outlines", original.cos.allocateObject(cosDict({ Type: cosName("Outlines"), Marker: cosString("existing") })));
  if (mode === "inline-page") {
    const pages = original.cos.resolveDict(dictGet(catalog, "Pages"))!;
    dictSet(pages, "Kids", cosArray([original.getPage(0).pageDict]));
  }
  const { serializeCosDocument } = await import("../cos/writer.js");
  await fs.writeFile("/input", serializeCosDocument({ objects: [...original.cos.objects.values()], rootRef: original.cos.rootRef, infoRef: original.cos.infoRef }));
  const source = await PdfFileSource.open(fs, "/input"), storage = { fs, directory: "/scratch" }, document = await PdfRetainedDocument.open(source, storage);
  try {
    const edited = await editRetainedDocument(document, storage, { ...(mode === "inline-page" ? { pageLabels: [{ index: 0, style: "D" as const }] } : {}), bookmarks: mode === "empty" ? [] : [{ title: "New", level: 1, pageNumber: 1 }] });
    try {
      const root = await edited.document.lookup(edited.document.crossReference.rootRef), outlines = await edited.document.lookup(dictGet(root!.value as PdfCosDict, "Outlines"));
      if (mode === "inline-page") {
        expect(dictGet(root!.value as PdfCosDict, "PageLabels")).toBeDefined();
        const first = await edited.document.lookup(dictGet(outlines!.value as PdfCosDict, "First"));
        expect(dictGet(first!.value as PdfCosDict, "Dest")).toMatchObject({ kind: "array", items: [{ kind: "ref", objectNumber: (await edited.getPage(0)).reference!.objectNumber }, { kind: "name" }, { kind: "null" }, { kind: "null" }, { kind: "null" }] });
      } else expect(dictGet(outlines!.value as PdfCosDict, "Marker")).toMatchObject({ kind: "string" });
    } finally { await edited.close(); }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
