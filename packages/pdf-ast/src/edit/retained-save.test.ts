import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { serializeCosDocument } from "../cos/writer.js";
import { parseCosDocument } from "../cos/parser.js";
import { encryptCosDocument } from "../cos/security.js";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictDelete, dictGet, dictSet } from "../ast.js";
import { saveRetainedDocumentChunks } from "./retained-save.js";

it.each(["nested", "duplicate-kids", "encrypted", "decrypted-trailer", "inline", "missing", "stream-page", "stream-root", "stream-catalog", "linearized", "linearized-encrypted", "force-linearized", "generate-objects", "generate-linearized", "generate-normalized"])("preserves %s document-save page-tree semantics and exact bytes", async mode => {
  const original = PdfDocument.create(); original.addPage([100, 200]).drawText("First", { x: 10, y: 20 }); original.addPage([200, 300]).drawText("Second", { x: 10, y: 20 });
  const catalog = original.cos.resolveDict(original.cos.rootRef)!, rootRef = dictGet(catalog, "Pages")!, root = original.cos.resolveDict(rootRef)!;
  if (mode === "missing") dictDelete(catalog, "Pages");
  else if (mode === "inline") dictSet(catalog, "Pages", cosDict({ Type: cosName("Pages"), Kids: cosArray([cosDict({ Type: cosName("Page"), MediaBox: cosArray([0, 0, 100, 200].map(value => cosNumber(value))) })]), Count: cosNumber(1) }));
  else {
    const subgroup = original.cos.allocateObject(cosDict({ Type: cosName("Pages"), Parent: rootRef, Kids: cosArray([original.getPage(0).ref, original.getPage(1).ref]), Count: cosNumber(2),
      MediaBox: cosArray([5, 10, 110, 220].map(value => cosNumber(value))), CropBox: cosArray([10, 20, 100, 200].map(value => cosNumber(value))), Rotate: cosNumber(90), Resources: dictGet(original.getPage(0).pageDict, "Resources")! }));
    dictSet(root, "Kids", cosArray([subgroup]));
    for (const page of original.getPages()) { for (const key of ["MediaBox", "Resources", "CropBox", "Rotate"]) dictDelete(page.pageDict, key); dictSet(page.pageDict, "Parent", subgroup); }
  }
  if (mode === "duplicate-kids") root.entries.unshift({ key: cosName("Kids"), value: cosArray([]) });
  if (mode.startsWith("stream-")) {
    const ref = mode === "stream-page" ? original.getPage(0).ref : mode === "stream-catalog" ? original.cos.rootRef : rootRef;
    if (ref.kind !== "ref") throw new Error("Missing reference");
    const object = original.cos.objects.get(ref.objectNumber)!;
    original.cos.objects.set(ref.objectNumber, { ...object, value: cosStream(new TextEncoder().encode("retained structural payload"), { dict: object.value as ReturnType<typeof cosDict>, compress: false }) });
  }
  let input = serializeCosDocument({ objects: [...original.cos.objects.values()], rootRef: original.cos.rootRef, infoRef: original.cos.infoRef, version: mode === "generate-normalized" ? "1.3" : mode === "decrypted-trailer" ? "1.4" : "1.7", linearize: mode.startsWith("linearized") || mode === "generate-linearized" });
  if (mode === "encrypted" || mode === "decrypted-trailer" || mode === "linearized-encrypted") input = encryptCosDocument(parseCosDocument(input), { userPassword: "reader", ownerPassword: "owner" });
  const buffered = PdfDocument.load(input, { password: "reader" }); let expected = buffered.save({ linearize: mode === "force-linearized", objectStreams: mode.startsWith("generate") ? "generate" : "preserve", normalizeContent: mode === "generate-normalized" });
  if (mode === "decrypted-trailer") expected = serializeCosDocument({ objects: [...buffered.cos.objects.values()], rootRef: buffered.cos.rootRef, infoRef: buffered.cos.infoRef });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", input); const storage = { fs, directory: "/scratch" };
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage, { password: "reader" });
  try { const chunks = []; for await (const bytes of saveRetainedDocumentChunks(document, storage, { chunkBytes: 4096, linearize: mode === "force-linearized", objectStreams: mode.startsWith("generate") ? "generate" : "preserve", normalizeContent: mode === "generate-normalized", ...(mode === "decrypted-trailer" ? { version: "1.7", omitId: true } : {}) })) { expect(bytes.length).toBeLessThanOrEqual(4096); chunks.push(bytes); } expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected); }
  finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

function generatedDocument(count: number): PdfRetainedDocument {
  const root = cosDict({ Type: cosName("Catalog"), Pages: { kind: "ref", objectNumber: 2, generationNumber: 0 } });
  const page = () => cosDict({ Type: cosName("Page"), Parent: { kind: "ref", objectNumber: 2, generationNumber: 0 }, MediaBox: cosArray([0, 0, 100, 100].map(value => cosNumber(value))), Resources: cosDict({}) });
  const value = (number: number) => number === 1 ? root : number === 2 ? cosDict({ Type: cosName("Pages"), Count: cosNumber(count), Kids: cosArray([]) }) : page();
  return { crossReference: { rootRef: { kind: "ref", objectNumber: 1, generationNumber: 0 }, version: "1.7", index: { async *entries() { for (let i = 1; i <= count + 2; i++) yield { objectNumber: i, type: "uncompressed" }; } } },
    objects: { async get(number: number) { return { value: value(number) }; } },
    async lookup(node: import("../ast.js").PdfCosNode | undefined) { return node ? { value: node.kind === "ref" ? value(node.objectNumber) : node } : undefined; },
    async *pages() { for (let i = 0; i < count; i++) yield { index: i, reference: { kind: "ref", objectNumber: i + 3, generationNumber: 0 }, dict: page() }; },
  } as unknown as PdfRetainedDocument;
}
it.each([256, 1024].flatMap(count => [false, true, "objects"].map(linearize => ({ count, linearize }))))("saves $count generated pages through bounded caller-backed writes (linearize=$linearize)", async ({ count, linearize }) => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let outstanding = 0, peak = 0, writes = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole file operation forbidden"); };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args);
      return new Proxy(handle, { get(target, property) {
        if (property === "write") return async (bytes: Uint8Array, ...args: unknown[]) => {
          expect(outstanding).toBe(0); outstanding += bytes.length; peak = Math.max(peak, outstanding); writes++; expect(bytes.buffer.byteLength).toBeLessThanOrEqual(16384);
          try { await Promise.resolve(); return await Reflect.apply(handle.write!, handle, [bytes, ...args]); } finally { outstanding -= bytes.length; }
        };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  let total = 0;
  for await (const bytes of saveRetainedDocumentChunks(generatedDocument(count), { fs: guarded, directory: "/scratch" }, { chunkBytes: 4096, linearize: linearize === true, objectStreams: linearize === "objects" ? "generate" : "preserve" })) { expect(bytes.buffer.byteLength).toBeLessThanOrEqual(4096); total += bytes.length; await Promise.resolve(); }
  expect(total).toBeGreaterThan(count * (linearize === "objects" ? 1 : 100)); expect(peak).toBeLessThanOrEqual(16384); expect(writes).toBeGreaterThan(0); expect(await fs.readdir("/scratch")).toEqual([]);
});
it.each(["cancel", "objects", "pages", "output", "return"].flatMap(mode => [false, true, "objects"].map(linearize => ({ mode, linearize }))))("cleans retained save backing after $mode (linearize=$linearize)", async ({ mode, linearize }) => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel save");
  const producer = saveRetainedDocumentChunks(generatedDocument(200), { fs, directory: "/scratch" }, { signal: controller.signal, linearize: linearize === true, objectStreams: linearize === "objects" ? "generate" : "preserve",
    ...(mode === "objects" ? { maxObjects: 1 } : mode === "pages" ? { maxPages: 1 } : mode === "output" ? { maxOutputBytes: 1 } : {}) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (mode === "return") { expect((await producer.next()).done).toBe(false); await producer.return(); }
    else {
      if (mode === "cancel") timer = setTimeout(() => controller.abort(reason), 0);
      const consuming = (async () => { for await (const ignored of producer) void ignored; })();
      if (mode === "cancel") await expect(consuming).rejects.toBe(reason); else await expect(consuming).rejects.toThrow(/limit/i);
    }
  } finally { if (timer) clearTimeout(timer); await producer.return(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["page", "write"])("preserves %s failures and cleans save backing", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const reason = new Error("save failed"), document = generatedDocument(512);
  if (mode === "page") {
    const pages = document.pages.bind(document);
    document.pages = async function* () { let count = 0; for await (const page of pages()) { yield page; if (++count === 64) throw reason; } };
  }
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "open" && mode === "write") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args);
      return new Proxy(handle, { get(target, property) {
        if (property === "write") return async () => { throw reason; };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  await expect((async () => { for await (const ignored of saveRetainedDocumentChunks(document, { fs: guarded, directory: "/scratch" })) void ignored; })()).rejects.toBe(reason);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["plain", "inherited", "aliased", "invalid-inherited", "indirect", "root-page", "inherited-resources"])("applies ordered retained rotations with %s pages", async mode => {
  const original = PdfDocument.create(); original.addPage([100, 200]); original.addPage([200, 300]);
  const root = original.cos.resolveDict(dictGet(original.cos.resolveDict(original.cos.rootRef)!, "Pages"))!;
  if (mode === "inherited" || mode === "invalid-inherited") dictSet(root, "Rotate", cosNumber(mode === "inherited" ? -90 : 45));
  if (mode === "inherited-resources") for (let i = 0; i < 2; i++) { dictDelete(original.getPage(i).dict, "Resources"); dictDelete(original.getPage(i).dict, "MediaBox"); }
  if (mode === "inherited-resources") { dictSet(root, "Resources", cosDict({})); dictSet(root, "MediaBox", cosArray([0, 0, 200, 300].map(value => cosNumber(value)))); }
  if (mode === "indirect") dictSet(original.getPage(0).dict, "Rotate", original.cos.allocateObject(cosNumber(450)));
  if (mode === "root-page") dictSet(original.cos.resolveDict(original.cos.rootRef)!, "Pages", original.getPage(0).ref);
  if (mode === "aliased") dictSet(root, "Kids", cosArray([original.getPage(0).ref, original.getPage(0).ref]));
  const input = serializeCosDocument({ objects: [...original.cos.objects.values()], rootRef: original.cos.rootRef, infoRef: original.cos.infoRef });
  const edits = [{ pageIndex: 0, degrees: 90, relative: true }, { pageIndex: 0, degrees: -180, relative: true }, { pageIndex: 1, degrees: 180 }, { pageIndex: 1, degrees: 90, relative: true }];
  if (mode === "aliased" || mode === "root-page") for (const edit of edits) edit.pageIndex = 0;
  const buffered = PdfDocument.load(input);
  for (const edit of edits) { const page = buffered.getPage(edit.pageIndex); page.setRotation((((edit.relative ? page.getRotation() : 0) + edit.degrees) % 360 + 360) % 360 as 0 | 90 | 180 | 270); }
  const expected = buffered.save(), fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", input);
  const storage = { fs, directory: "/scratch" }, source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage);
  try { const chunks = []; for await (const bytes of saveRetainedDocumentChunks(document, storage, { rotations: (async function* () { yield* edits; })() })) chunks.push(bytes); expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected); }
  finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["index", "angle", "cancel"])("releases retained rotation edits after %s failure before output", async mode => {
  const original = PdfDocument.create(); original.addPage([100, 200]);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const storage = { fs, directory: "/scratch" }, source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage);
  const controller = new AbortController(), reason = new Error("cancel rotation edits"); let returned = false, yielded = 0;
  async function* rotations() {
    try { yield { pageIndex: 0, degrees: 90 }; if (mode === "cancel") controller.abort(reason); yield { pageIndex: mode === "index" ? 1 : 0, degrees: mode === "angle" ? 45 : 90 }; }
    finally { returned = true; }
  }
  try {
    await expect((async () => { for await (const bytes of saveRetainedDocumentChunks(document, storage, { rotations: rotations(), signal: controller.signal })) yielded += bytes.length; })())
      .rejects.toThrow(mode === "index" ? "Page index out of bounds" : mode === "angle" ? "multiple of 90" : reason.message);
    expect(returned).toBe(true); expect(yielded).toBe(0);
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([false, true])("preserves sparse nonzero generations when generating object streams (linearized=%s)", async linearized => {
  const { cosRef } = await import("../ast.js");
  const objects = [
    { objectNumber: 1, generationNumber: 1, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(4, 3) }) },
    { objectNumber: 4, generationNumber: 3, value: cosDict({ Type: cosName("Pages"), Kids: cosArray([cosRef(8, 2)]), Count: cosNumber(1) }) },
    { objectNumber: 8, generationNumber: 2, value: cosDict({ Type: cosName("Page"), Parent: cosRef(4, 3), MediaBox: cosArray([0, 0, 100, 200].map(value => cosNumber(value))) }) },
  ];
  const input = serializeCosDocument({ objects, rootRef: cosRef(1, 1), version: "1.3", linearize: linearized });
  const expected = PdfDocument.load(input).save({ objectStreams: "generate" });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", input); const storage = { fs, directory: "/scratch" };
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage);
  try {
    const chunks = []; for await (const bytes of saveRetainedDocumentChunks(document, storage, { objectStreams: "generate" })) chunks.push(bytes);
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected);
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
