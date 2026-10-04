import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { cosArray, cosDict, cosName, cosNumber, cosString, dictGet, dictSet, dictDelete } from "../ast.js";
import { serializeCosDocument } from "../cos/writer.js";
import { copyRetainedPageChunks, copyRetainedPagesChunks } from "./retained-page-copy.js";

function input(inherited: boolean, encrypted: boolean) {
  const document = PdfDocument.create(); document.setTitle("Copied title");
  const first = document.addPage([100, 80]), second = document.addPage([100, 80]);
  first.drawText("First", { x: 10, y: 30, size: 12 }); second.drawText("Second", { x: 10, y: 30, size: 12 });
  const field = document.cos.allocateObject(cosDict({ FT: cosName("Tx"), T: cosString("Field"), V: cosString("Value") }));
  const widget = document.cos.allocateObject(cosDict({ Type: cosName("Annot"), Subtype: cosName("Widget"), Parent: field, P: first.ref,
    Rect: cosArray([1, 1, 30, 20].map(value => cosNumber(value))) }));
  dictSet(document.cos.resolveDict(field)!, "Kids", cosArray([widget]));
  dictSet(first.dict, "Annots", cosArray([widget, cosDict({ Subtype: cosName("Link"), Dest: cosArray([second.ref, cosName("Fit")]) })]));
  const catalog = document.cos.resolveDict(document.cos.rootRef)!;
  dictSet(catalog, "AcroForm", cosDict({ Fields: cosArray([field, field]), DA: cosString("/F1 12 Tf") }));
  dictSet(catalog, "OCProperties", cosDict({ OCGs: cosArray([document.cos.allocateObject(cosDict({ Type: cosName("OCG"), Name: cosString("Layer") }))]) }));
  if (inherited) {
    const parent = document.cos.resolveDict(dictGet(first.dict, "Parent"))!;
    for (const key of ["Resources", "MediaBox"]) { dictSet(parent, key, dictGet(first.dict, key)!); dictDelete(first.dict, key); }
    dictSet(parent, "CropBox", cosArray([1, 2, 80, 60].map(value => cosNumber(value)))); dictSet(parent, "Rotate", cosNumber(90));
  }
  return encrypted ? document.save({ encrypt: { userPassword: "reader", ownerPassword: "owner" } })
    : serializeCosDocument({ objects: [...document.cos.objects.values()], rootRef: document.cos.rootRef, infoRef: document.cos.infoRef });
}
for (const inherited of [false, true]) for (const encrypted of [false, true]) for (const index of [0, 1]) {
  it(`copies exact page bytes with forms, links and inherited resources (${inherited}, ${encrypted}, ${index})`, async () => {
    const bytes = input(inherited, encrypted), sourceDocument = PdfDocument.load(bytes, { password: "reader" }), expected = PdfDocument.create();
    const metadata = sourceDocument.getMetadata(), info = expected.cos.resolveDict(expected.cos.infoRef)!;
    for (const [key, name] of [["Title", "title"], ["Author", "author"], ["Subject", "subject"], ["Keywords", "keywords"], ["Creator", "creator"], ["Producer", "producer"]] as const) {
      if (metadata[name]) dictSet(info, key, cosString(metadata[name]!));
    }
    expected.copyPagesFrom(sourceDocument, [index]);
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", bytes);
    const source = await PdfFileSource.open(fs, "/input"), storage = { fs, directory: "/scratch" };
    const retained = await PdfRetainedDocument.open(source, storage, { password: "reader" });
    try {
      const chunks = []; for await (const bytes of copyRetainedPageChunks(retained, index, storage)) chunks.push(bytes);
      expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected.save());
    } finally { await retained.close(); await source.close(); }
    expect(await fs.readdir("/scratch")).toEqual([]);
  });
}

for (const failure of ["cancel", "limit", "return"] as const) {
  it(`cleans page-copy backing after ${failure}`, async () => {
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", input(false, false));
    const source = await PdfFileSource.open(fs, "/input"), storage = { fs, directory: "/scratch" };
    const retained = await PdfRetainedDocument.open(source, storage);
    const controller = new AbortController(), reason = new Error("cancel page copy");
    const before = await fs.readdir("/scratch");
    const iterator = copyRetainedPageChunks(retained, 0, storage, { signal: controller.signal, chunkBytes: 32,
      ...(failure === "limit" ? { maxOutputBytes: 16 } : {}) });
    try {
      if (failure === "limit") await expect(iterator.next()).rejects.toThrow();
      else {
        expect((await iterator.next()).done).toBe(false);
        if (failure === "cancel") { controller.abort(reason); await expect(iterator.next()).rejects.toBe(reason); }
        else await iterator.return();
      }
      expect(await fs.readdir("/scratch")).toEqual(before);
    } finally { await iterator.return(); await retained.close(); await source.close(); }
    expect(await fs.readdir("/scratch")).toEqual([]);
  });
}

for (const indices of [[0, 1], [1, 0], [0, 0, 1], []]) it(`copies streamed page selection ${indices.join(",")}`, async () => {
  const bytes = input(true, true), sourceDocument = PdfDocument.load(bytes, { password: "reader" }), expected = PdfDocument.create();
  const metadata = sourceDocument.getMetadata(), info = expected.cos.resolveDict(expected.cos.infoRef)!;
  for (const [key, name] of [["Title", "title"], ["Author", "author"], ["Subject", "subject"], ["Keywords", "keywords"], ["Creator", "creator"], ["Producer", "producer"]] as const) if (metadata[name]) dictSet(info, key, cosString(metadata[name]!));
  expected.copyPagesFrom(sourceDocument, indices);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", bytes);
  const storage = { fs, directory: "/scratch" }, source = await PdfFileSource.open(fs, "/input"), retained = await PdfRetainedDocument.open(source, storage, { password: "reader" });
  async function* selection() { yield* indices; }
  try {
    const chunks = []; for await (const bytes of copyRetainedPagesChunks(retained, selection(), storage)) chunks.push(bytes);
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected.save());
  } finally { await retained.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

for (const mode of ["limit", "cancel", "source-failure", "invalid", "missing"] as const) it(`retires page selections and all backing after ${mode}`, async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", input(false, false));
  const storage = { fs, directory: "/scratch" }, source = await PdfFileSource.open(fs, "/input"), retained = await PdfRetainedDocument.open(source, storage);
  const before = await fs.readdir("/scratch"), controller = new AbortController(), reason = new Error("selection failed"); let closed = false, produced = 0;
  async function* selection() {
    try {
      for (let i = 0; i < 10000; i++) {
        if (mode === "source-failure" && i === 2) throw reason;
        produced++; yield mode === "invalid" ? -1 : mode === "missing" ? 99 : 0;
        if (mode === "missing") return;
      }
    } finally { closed = true; }
  }
  const timer = mode === "cancel" ? setTimeout(() => controller.abort(reason), 0) : undefined;
  try {
    await expect((async () => { for await (const ignored of copyRetainedPagesChunks(retained, selection(), storage, { signal: controller.signal, ...(mode === "limit" ? { maxPages: 2 } : {}) })) void ignored; })()).rejects.toThrow();
    expect(closed).toBe(true); expect(produced).toBeLessThan(10000); expect(await fs.readdir("/scratch")).toEqual(before);
  } finally { clearTimeout(timer); await retained.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("copies a generated repeated selection without collecting input pages or output bytes", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", input(false, false));
  const storage = { fs, directory: "/scratch" }, source = await PdfFileSource.open(fs, "/input"), retained = await PdfRetainedDocument.open(source, storage);
  let produced = 0, total = 0, chunks = 0;
  async function* selection() { for (let i = 0; i < 1024; i++) { produced++; yield i % 2; } }
  try {
    for await (const bytes of copyRetainedPagesChunks(retained, selection(), storage, { maxPages: 1024, chunkBytes: 4096 })) {
      expect(bytes.buffer.byteLength).toBeLessThanOrEqual(4096); total += bytes.length; chunks++; await Promise.resolve();
    }
    expect(produced).toBe(1024); expect(total).toBeGreaterThan(100000); expect(chunks).toBeGreaterThan(1024);
  } finally { await retained.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
