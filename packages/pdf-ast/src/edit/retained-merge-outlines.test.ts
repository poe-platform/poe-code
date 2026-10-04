import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { cosArray, cosDict, cosName, cosNumber, cosString, dictSet } from "../ast.js";
import { copyRetainedPagesChunks } from "./retained-page-copy.js";

it("flattens nested outlines and resolves named destinations with exact merged bytes", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }, expected = PdfDocument.create();
  async function* sources() {
    for (let i = 0; i < 2; i++) {
      const original = PdfDocument.create(); original.addPage([100, 100]); original.addPage([200, 200]);
      const catalog = original.cos.resolveDict(original.cos.rootRef)!;
      dictSet(catalog, "Dests", cosDict({ chapter: cosArray([original.getPage(1).ref, cosName("Fit")]) }));
      const child = original.cos.allocateObject(cosDict({ Title: cosString("fallback"), Dest: cosName("missing") }));
      const first = original.cos.allocateObject(cosDict({ Title: cosString("日本語"), A: cosDict({ D: cosString("chapter") }), First: child }));
      dictSet(catalog, "Outlines", original.cos.allocateObject(cosDict({ First: first })));
      const bytes = original.save(); expected.copyPagesFrom(PdfDocument.load(bytes), [0, 1]); await fs.writeFile("/input", bytes);
      const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage);
      try { yield { document, indices: [0, 1] }; } finally { await document.close(); await source.close(); }
    }
  }
  const chunks = []; for await (const bytes of copyRetainedPagesChunks(sources(), storage, { includeOutlines: true })) chunks.push(bytes);
  const root = cosDict({}), rootRef = expected.cos.allocateObject(root), items: { dict: ReturnType<typeof cosDict>; ref: typeof rootRef }[] = [];
  for (let i = 0; i < 4; i++) {
    const dict = cosDict({ Title: cosString(i % 2 ? "fallback" : "日本語"), Parent: rootRef, Dest: cosArray([expected.getPage(i ^ 1).ref, cosName("Fit")]) });
    const ref = expected.cos.allocateObject(dict), previous = items.at(-1);
    if (previous) { dictSet(previous.dict, "Next", ref); dictSet(dict, "Prev", previous.ref); } else dictSet(root, "First", ref);
    items.push({ dict, ref });
  }
  dictSet(root, "Last", items.at(-1)!.ref); dictSet(root, "Count", cosNumber(items.length)); dictSet(expected.cos.resolveDict(expected.cos.rootRef)!, "Outlines", rootRef);
  expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected.save()); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["direct", "round", "outside", "missing", "legacy", "tree", "action"])("preserves %s outline destination semantics", async mode => {
  const { PdfMergeOutlines } = await import("./retained-merge-outlines.js"), { PdfMutableObjectStore } = await import("../cos/mutable-object-store.js"), { cosRef, dictGet } = await import("../ast.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }, original = PdfDocument.create();
  for (let i = 0; i < 3; i++) original.addPage([100, 100]);
  const catalog = original.cos.resolveDict(original.cos.rootRef)!, direct = cosArray([original.getPage(2).ref, cosName("Fit")]);
  let dest = direct as import("../ast.js").PdfCosNode;
  if (mode === "round") dest = cosArray([cosNumber(1.6)]);
  if (mode === "outside") dest = cosArray([cosNumber(3)]);
  if (mode === "missing") dest = cosName("absent");
  if (mode === "legacy") { dictSet(catalog, "Dests", cosDict({ chapter: cosDict({ D: direct }) })); dest = cosString("chapter"); }
  if (mode === "tree") {
    const leaf = original.cos.allocateObject(cosDict({ Names: cosArray([cosName("chapter"), direct, cosString("chapter"), cosArray([cosNumber(0)])]) }));
    const tree = original.cos.allocateObject(cosDict({ Kids: cosArray([leaf]) }));
    dictSet(catalog, "Names", cosDict({ Dests: tree })); dest = cosName("chapter");
  }
  if (mode === "action") dest = cosDict({ Dest: direct });
  const item = original.cos.allocateObject(cosDict({ Title: cosString("target"), Dest: dest }));
  dictSet(original.cos.resolveDict(item)!, "Next", item);
  dictSet(catalog, "Outlines", cosDict({ First: item })); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage), outlines = new PdfMergeOutlines(storage, new AbortController().signal), target = new PdfMutableObjectStore(storage);
  try {
    await outlines.append(document, 0); await document.close(); await source.close();
    await outlines.finish(target, cosDict({}), 3, async index => cosRef(50 + index));
    const item = (await target.get(2))!.value, dest = item.kind === "dict" ? dictGet(item, "Dest") : undefined;
    expect(dest?.kind === "array" && dest.items[0]).toMatchObject({ kind: "ref", objectNumber: mode === "missing" || mode === "outside" ? 50 : 52, generationNumber: 0 });
  } finally { await document.close(); await source.close(); await outlines.close(); await target.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([1024, 2048])("stages %i generated outlines with bounded writes and cooperative final cancellation", async count => {
  const { PdfMergeOutlines } = await import("./retained-merge-outlines.js"), { PdfMutableObjectStore } = await import("../cos/mutable-object-store.js"), { cosRef } = await import("../ast.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel outlines"); let outstanding = 0, peak = 0;
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
  const storage = { fs: guarded, directory: "/scratch" }, outlines = new PdfMergeOutlines(storage, controller.signal), target = new PdfMutableObjectStore(storage);
  const document = { crossReference: { rootRef: cosRef(1) }, async lookup(node: import("../ast.js").PdfCosNode | undefined) {
    if (node?.kind !== "ref") return node ? { value: node } : undefined;
    if (node.objectNumber === 1) return { value: cosDict({ Outlines: cosDict({ First: cosRef(2) }) }) };
    return { value: cosDict({ Title: cosString("reused title"), ...(node.objectNumber <= count ? { Next: cosRef(node.objectNumber + 1) } : {}) }) };
  } } as unknown as PdfRetainedDocument;
  try {
    await outlines.append(document, 0); expect(peak).toBeGreaterThan(0); expect(peak).toBeLessThanOrEqual(16384);
    let allocated = 0;
    const timer = setTimeout(() => controller.abort(reason), 0);
    try { await expect(outlines.finish(target, cosDict({}), 1, async () => { allocated++; return cosRef(50000); })).rejects.toBe(reason); }
    finally { clearTimeout(timer); }
    expect(allocated).toBeLessThan(count);
  } finally { await outlines.close(); await target.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["lookup", "write"])("preserves %s failures and releases outline backing", async mode => {
  const { PdfMergeOutlines } = await import("./retained-merge-outlines.js"), { cosRef } = await import("../ast.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const reason = new Error("outline failure");
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
  const document = { crossReference: { rootRef: cosRef(1) }, async lookup(node: import("../ast.js").PdfCosNode | undefined) {
    if (node?.kind !== "ref") return node ? { value: node } : undefined;
    if (node.objectNumber === 1) return { value: cosDict({ Outlines: cosDict({ First: cosRef(2) }) }) };
    if (node.objectNumber === 1500) throw reason;
    return { value: cosDict({ Title: cosString("generated"), Next: cosRef(node.objectNumber + 1) }) };
  } } as unknown as PdfRetainedDocument;
  const outlines = new PdfMergeOutlines({ fs: guarded, directory: "/scratch" }, new AbortController().signal);
  try { await expect(outlines.append(document, 0)).rejects.toBe(reason); } finally { await outlines.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["complete", "return", "close", "limit", "cancel"])("owns retained outline summary traversal through %s", async mode => {
  const original = PdfDocument.create(); original.addPage(); original.addPage();
  const catalog = original.cos.resolveDict(original.cos.rootRef)!;
  dictSet(catalog, "Dests", cosDict({ target: cosArray([original.getPage(1).ref, cosName("Fit")]) }));
  const second = original.cos.allocateObject(cosDict({ Title: cosString("child"), Dest: cosNumber(0) }));
  const first = original.cos.allocateObject(cosDict({ Title: cosString("parent"), Dest: cosName("target"), First: second }));
  dictSet(original.cos.resolveDict(second)!, "Next", first);
  dictSet(catalog, "Outlines", cosDict({ First: first }));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const controller = new AbortController(), source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { signal: controller.signal, ...(mode === "limit" ? { maxTraversalStagingBytes: 0 } : {}) });
  const walk = document.outlines();
  try {
    if (mode === "limit") await expect(walk.next()).rejects.toThrow("limit");
    else {
      expect((await walk.next()).value).toEqual({ title: "parent", pageIndex: 1 });
      if (mode === "complete") { expect((await walk.next()).value).toEqual({ title: "child", pageIndex: 0 }); expect((await walk.next()).done).toBe(true); }
      else if (mode === "close") { await document.close(); expect((await walk.next()).done).toBe(true); }
      else if (mode === "return") await walk.return(undefined);
      else { controller.abort(new Error("cancel outline")); await expect(walk.next()).rejects.toThrow("cancel outline"); }
    }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
