import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosString, dictSet, type PdfCosNode } from "../ast.js";
import { walkRetainedPageLabels } from "./retained-page-labels.js";

it("preserves label tree order, duplicates, defaults and cycles", async () => {
  const original = PdfDocument.create(); original.addPage();
  const child = original.cos.allocateObject(cosDict({ Nums: cosArray([cosNumber(7), cosDict({ P: cosString("π"), S: cosName("r"), St: cosNumber(-2) }), cosString("bad"), cosDict({})]) }));
  const root = original.cos.allocateObject(cosDict({ Nums: cosArray([cosNumber(4), cosDict({}), cosNumber(4), cosDict({ St: cosNumber(9) }), cosNumber(99)]), Kids: cosArray([child, child]) }));
  dictSet(original.cos.resolveDict(child)!, "Kids", cosArray([root]));
  dictSet(original.cos.resolveDict(original.cos.rootRef)!, "PageLabels", root);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" });
  try {
    const labels = []; for await (const label of document.pageLabels()) labels.push(label);
    expect(labels).toEqual([{ index: 4, start: 1 }, { index: 4, start: 9 }, { index: 7, start: -2, prefix: "π", style: "r" }, { index: 4, start: 1 }, { index: 4, start: 9 }]);
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([1024, 4096])("streams %i labels with bounded caller-backed traversal", async count => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let peak = 0, pending = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole label I/O forbidden"); };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args);
      return new Proxy(handle, { get(owner, key) {
        if (key === "write") return async (bytes: Uint8Array, ...args: unknown[]) => {
          expect(pending++).toBe(0); peak = Math.max(peak, bytes.buffer.byteLength); expect(peak).toBeLessThanOrEqual(16384);
          try { await Promise.resolve(); return await Reflect.apply(handle.write!, handle, [bytes, ...args]); } finally { pending--; }
        };
        const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const document = { crossReference: { rootRef: cosRef(1) }, async lookup(node: PdfCosNode | undefined) {
    if (node?.kind !== "ref") return node ? { value: node } : undefined;
    const i = node.objectNumber - 2;
    return { value: node.objectNumber === 1 ? cosDict({ PageLabels: cosRef(2) }) : cosDict({ Nums: cosArray([cosNumber(i), cosDict({})]), ...(i + 1 < count ? { Kids: cosArray([cosRef(node.objectNumber + 1)]) } : {}) }) };
  } } as unknown as PdfRetainedDocument;
  let seen = 0;
  for await (const label of walkRetainedPageLabels(document, { fs: guarded, directory: "/scratch" })) { expect(label).toEqual({ index: seen++, start: 1 }); await Promise.resolve(); }
  expect(seen).toBe(count); expect(peak).toBeGreaterThan(0); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["return", "cancel", "limit", "read"])("cleans label backing on %s", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController();
  const document = { crossReference: { rootRef: cosRef(1) }, async lookup(node: PdfCosNode | undefined) {
    if (node?.kind !== "ref") return node ? { value: node } : undefined;
    if (node.objectNumber === 3 && mode === "read") throw new Error("injected read");
    return { value: node.objectNumber === 1 ? cosDict({ PageLabels: cosRef(2) }) : cosDict({ Nums: cosArray([cosNumber(0), cosDict({})]), Kids: cosArray([cosRef(3)]) }) };
  } } as unknown as PdfRetainedDocument;
  const walk = walkRetainedPageLabels(document, { fs, directory: "/scratch" }, { signal: controller.signal, ...(mode === "limit" ? { maxStagingBytes: 1 } : {}) });
  expect((await walk.next()).value).toEqual({ index: 0, start: 1 });
  if (mode === "return") await walk.return(undefined);
  else {
    if (mode === "cancel") controller.abort(new Error("injected cancel"));
    await expect(walk.next()).rejects.toThrow(mode === "limit" ? "limit" : `injected ${mode}`);
  }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("closes a suspended label iterator with its document", async () => {
  const original = PdfDocument.create(); original.addPage();
  dictSet(original.cos.resolveDict(original.cos.rootRef)!, "PageLabels", cosDict({ Kids: cosArray([cosDict({ Nums: cosArray([cosNumber(0), cosDict({})]) }), cosDict({ Nums: cosArray([cosNumber(1), cosDict({})]) })]) }));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" });
  const labels = document.pageLabels(); expect((await labels.next()).value).toEqual({ index: 0, start: 1 });
  await document.close(); expect((await labels.next()).done).toBe(true); await source.close();
  expect(await fs.readdir("/scratch")).toEqual([]);
});
