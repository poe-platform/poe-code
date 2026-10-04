import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { cosArray, cosDict, cosName, cosNumber, cosString, dictSet } from "../ast.js";
import { copyRetainedPagesChunks } from "./retained-page-copy.js";

it("merges nested page labels with source offsets and exact serialization", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }, expected = PdfDocument.create();
  const label = cosDict({ S: cosName("r"), St: cosNumber(3), P: cosString("日本語") });
  async function* sources() {
    for (let i = 0; i < 2; i++) {
      const original = PdfDocument.create(); original.addPage([100, 100]); original.addPage([200, 200]);
      const leaf = original.cos.allocateObject(cosDict({ Nums: cosArray([cosNumber(1), label]) }));
      const root = original.cos.allocateObject(cosDict({ Kids: cosArray([leaf, leaf]) }));
      dictSet(original.cos.resolveDict(original.cos.rootRef)!, "PageLabels", root);
      const bytes = original.save(); expected.copyPagesFrom(PdfDocument.load(bytes), [0, 1]); await fs.writeFile("/input", bytes);
      const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage);
      try { yield { document, indices: [0, 1] }; } finally { await document.close(); await source.close(); }
    }
  }
  const chunks = []; for await (const bytes of copyRetainedPagesChunks(sources(), storage, { includePageLabels: true })) chunks.push(bytes);
  // The buffered merger copies parsed prefix.format (undefined), hence literal output.
  dictSet(label, "P", { ...cosString("日本語"), format: undefined });
  dictSet(expected.cos.resolveDict(expected.cos.rootRef)!, "PageLabels", expected.cos.allocateObject(cosDict({ Nums: cosArray([cosNumber(1), label, cosNumber(3), label]) })));
  expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected.save()); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("bounds generated label staging and cancels replay without whole-file I/O", async () => {
  const { PdfMergeLabels } = await import("./retained-merge-labels.js"), { PdfMutableObjectStore } = await import("../cos/mutable-object-store.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel labels"); let outstanding = 0, peak = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole file operation forbidden"); };
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
  const storage = { fs: guarded, directory: "/scratch" }, labels = new PdfMergeLabels(storage, controller.signal), target = new PdfMutableObjectStore(storage);
  const rootRef = cosNumber(0);
  const document = { crossReference: { rootRef }, async lookup(node: unknown) {
    return { value: node === rootRef ? cosDict({ PageLabels: cosDict({ Nums: cosArray([cosNumber(0), cosDict({ S: cosName("D") })]) }) }) : node };
  } } as unknown as PdfRetainedDocument;
  try {
    for (let i = 0; i < 2048; i++) await labels.append(document, i);
    const output = await labels.finish(target, cosDict({})); let total = 0;
    for await (const bytes of output!.body.chunks) { total += bytes.length; await Promise.resolve(); }
    expect(total).toBe(output!.body.length); expect(peak).toBeLessThanOrEqual(16384); expect(peak).toBeGreaterThan(0);
    const timer = setTimeout(() => controller.abort(reason), 0);
    try { await expect(labels.finish(target, cosDict({}))).rejects.toBe(reason); } finally { clearTimeout(timer); }
  } finally { await labels.close(); await target.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("stops cyclic label trees and preserves depth/lookup failures while cleaning backing", async () => {
  const { PdfMergeLabels } = await import("./retained-merge-labels.js"), { cosRef } = await import("../ast.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }, reason = new Error("lookup failed");
  for (const mode of ["cycle", "depth", "lookup"]) {
    let lookups = 0;
    const document = { crossReference: { rootRef: cosRef(1) }, async lookup(node: ReturnType<typeof cosRef>) {
      lookups++; if (mode === "lookup" && lookups === 4) throw reason;
      if (node?.kind !== "ref") return { value: node };
      return { value: node.objectNumber === 1 ? cosDict({ PageLabels: cosRef(2) }) : cosDict({ Kids: cosArray([cosRef(mode === "cycle" ? 2 : node.objectNumber + 1)]) }) };
    } } as unknown as PdfRetainedDocument;
    const labels = new PdfMergeLabels(storage, new AbortController().signal, 4);
    try {
      if (mode === "cycle") await labels.append(document, 0);
      else if (mode === "lookup") await expect(labels.append(document, 0)).rejects.toBe(reason);
      else await expect(labels.append(document, 0)).rejects.toThrow("depth limit");
    } finally { await labels.close(); }
    expect(lookups).toBeLessThan(30); expect(await fs.readdir("/scratch")).toEqual([]);
  }
});
