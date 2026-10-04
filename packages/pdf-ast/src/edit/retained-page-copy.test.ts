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

it("copies sequential retained documents and releases each before requesting the next", async () => {
  const inputs = [input(true, true), input(false, false)], selections = [[1, 0, 1], [0, 1]];
  const expected = PdfDocument.create(), info = expected.cos.resolveDict(expected.cos.infoRef)!;
  for (let i = 0; i < inputs.length; i++) {
    const source = PdfDocument.load(inputs[i]!, { password: "reader" });
    if (i === 0) {
      const metadata = source.getMetadata();
      for (const [key, name] of [["Title", "title"], ["Author", "author"], ["Subject", "subject"], ["Keywords", "keywords"], ["Creator", "creator"], ["Producer", "producer"]] as const) if (metadata[name]) dictSet(info, key, cosString(metadata[name]!));
    }
    expected.copyPagesFrom(source, selections[i]!);
  }
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }; let live = 0, closed = 0;
  async function* documents() {
    for (let i = 0; i < inputs.length; i++) {
      expect(live).toBe(0); await fs.writeFile("/input", inputs[i]!);
      const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage, { password: "reader" }); live++;
      try { yield { document, indices: selections[i]! }; }
      finally { await document.close(); await source.close(); live--; closed++; }
    }
  }
  const chunks = [];
  for await (const bytes of copyRetainedPagesChunks(documents(), storage)) { expect(live).toBe(0); expect(closed).toBe(2); chunks.push(bytes); }
  expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected.save()); expect(await fs.readdir("/scratch")).toEqual([]);
});

for (const mode of ["cumulative-limit", "source-error"] as const) it(`closes sequential sources and backing after ${mode}`, async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", input(false, false));
  const storage = { fs, directory: "/scratch" }, reason = new Error("next source failed"); let closed = 0, outputs = 0;
  async function* sources() {
    for (let i = 0; i < 2; i++) {
      const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage);
      try { yield { document, indices: [0, 1] }; }
      finally { await document.close(); await source.close(); closed++; }
      if (mode === "source-error") throw reason;
    }
  }
  const operation = (async () => { for await (const ignored of copyRetainedPagesChunks(sources(), storage, { maxPages: 3 })) { void ignored; outputs++; } })();
  if (mode === "source-error") await expect(operation).rejects.toBe(reason); else await expect(operation).rejects.toThrow("limit");
  expect(outputs).toBe(0); expect(closed).toBe(mode === "source-error" ? 1 : 2); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("serializes an empty source sequence like a newly created document", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const chunks = [];
  for await (const bytes of copyRetainedPagesChunks([], { fs, directory: "/scratch" })) chunks.push(bytes);
  expect(new Uint8Array(Buffer.concat(chunks))).toEqual(PdfDocument.create().save()); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["direct", "indirect", "inherited"])("overrides %s source rotation before copying indirect objects", async mode => {
  let bytes = input(mode === "inherited", false);
  if (mode === "indirect") { const doc = PdfDocument.load(bytes); dictSet(doc.getPage(0).dict, "Rotate", doc.cos.allocateObject(cosNumber(90))); bytes = serializeCosDocument({ objects: [...doc.cos.objects.values()], rootRef: doc.cos.rootRef, infoRef: doc.cos.infoRef }); }
  const buffered = PdfDocument.load(bytes); buffered.getPage(0).setRotation(270);
  const expected = PdfDocument.create(); expected.setTitle("Copied title"); expected.copyPagesFrom(buffered, [0, 1, 0]);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", bytes);
  const storage = { fs, directory: "/scratch" }, source = await PdfFileSource.open(fs, "/input"), retained = await PdfRetainedDocument.open(source, storage);
  try {
    const chunks = []; for await (const chunk of copyRetainedPagesChunks(retained, [0, 1, 0], storage, { pageRotation: async (document: PdfRetainedDocument, index: number) => { expect(document).toBe(retained); return index === 0 ? 270 : undefined; } })) chunks.push(chunk);
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected.save());
  } finally { await retained.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("composes page copies through an unsaved retained graph", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRetainedPageCopy } = await import("./retained-page-copy.js");
  const bytes = new Uint8Array(readFileSync(new URL("../fixtures/qpdf-shared-images.pdf", import.meta.url)));
  const buffered = PdfDocument.load(bytes), first = PdfDocument.create(), expected = PdfDocument.create();
  first.copyPagesFrom(buffered, [2, 0, 2]); expected.copyPagesFrom(first, [2, 0]);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", bytes);
  const storage = { fs, directory: "/scratch" }, source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage);
  const copy = await createRetainedPageCopy(document, [2, 0, 2], storage, { metadata: {} });
  try {
    const graph = await copy.openDocument(), chunks = [];
    for await (const bytes of copyRetainedPagesChunks(graph, [2, 0], storage, { metadata: {} })) chunks.push(bytes);
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected.save());
    const saved = []; for await (const bytes of copy.chunks()) saved.push(bytes);
    expect(new Uint8Array(Buffer.concat(saved))).toEqual(first.save());
  } finally { await copy.close(); await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("preserves linearized copied-object layout without mutating the copy graph", async () => {
  const { serializeRetainedCosDocumentChunks } = await import("../cos/retained-writer.js");
  const { createRetainedPageCopy } = await import("./retained-page-copy.js");
  const input = PdfDocument.create(); input.addPage([100, 200]); dictSet(input.getPage(0).dict, "Linearized", cosNumber(1));
  const expected = PdfDocument.create(); expected.copyPagesFrom(input, [0]);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" };
  const chunks = []; for await (const chunk of serializeRetainedCosDocumentChunks({ objects: input.cos.objects.values(), rootRef: input.cos.rootRef, infoRef: input.cos.infoRef }, storage)) chunks.push(chunk);
  await fs.writeFile("/input", new Uint8Array(Buffer.concat(chunks)));
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage), copy = await createRetainedPageCopy(document, [0], storage, { metadata: {} });
  try {
    const graph = await copy.openDocument();
    for (let attempt = 0; attempt < 2; attempt++) { const output = []; for await (const chunk of copy.chunks()) output.push(chunk); expect(new Uint8Array(Buffer.concat(output))).toEqual(expected.save()); }
    const pages = []; for await (const page of graph.pages()) pages.push(page); expect(pages).toHaveLength(1); expect(dictGet(pages[0]!.dict, "Type")).toMatchObject({ kind: "name", decoded: "Page" });
  } finally { await copy.close(); await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
