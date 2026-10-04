import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosStream, dictSet, type PdfIndirectObject } from "./ast.js";
import { PdfDocument } from "./document.js";
import { PdfFileSource } from "./source.js";
import { serializeCosDocument } from "./cos/writer.js";
import { PdfRetainedDocument } from "./retained-document.js";
const text = (s: string) => new TextEncoder().encode(s);

async function fixture(bytes: Uint8Array, options = {}) {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const reads = vi.fn(async (position: number, length: number) => bytes.slice(position, position + length));
  const readFile = vi.fn(async () => { throw new Error("full read forbidden"); });
  const input = { capabilities: { retainedRead: true }, readFile, openReadFile: async () => ({
    stat: async () => ({ type: "file", size: bytes.length }), read: reads, close: async () => {},
  }) } as unknown as FileSystem;
  const source = await PdfFileSource.open(input, "/input", { chunkBytes: 64, cacheBytes: 128 });
  const doc = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { chunkBytes: 64, cacheBytes: 128, ...options });
  return { fs, source, reads, readFile, doc, async close() { await doc.close(); expect(await fs.readdir("/scratch")).toEqual([]); expect((await source.read(0, 1))[0]).toBe(37); await source.close(); } };
}
function inheritedPdf(malformed = false) {
  return serializeCosDocument({ rootRef: cosRef(1), objects: [
    { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
    { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Kids: cosArray([cosRef(3)]), Count: cosNumber(1) }) },
    { objectNumber: 3, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Parent: cosRef(2), Kids: cosArray([cosRef(4)]), Count: cosNumber(1),
      MediaBox: cosArray([10, 20, 210, 120].map(value => cosNumber(value))), CropBox: cosArray([20, 30, 200, 110].map(value => cosNumber(value))), Rotate: cosNumber(-90), Resources: cosDict({ Font: cosDict({ F1: cosRef(7) }) }) }) },
    { objectNumber: 4, generationNumber: 0, value: cosDict({ Type: cosName("Page"), Parent: cosRef(3), Contents: cosArray([cosRef(5), cosRef(6)]), ...(malformed ? { MediaBox: cosArray([cosNumber(1)]), CropBox: cosArray([cosNumber(0), cosName("invalid"), cosNumber(100), cosNumber(100)]) } : {}) }) },
    { objectNumber: 5, generationNumber: 0, value: cosStream(text("BT /F1 12 Tf "), { compress: true }) },
    { objectNumber: 6, generationNumber: 0, value: cosStream(text("(Retained) Tj ET"), { compress: true }) },
    { objectNumber: 7, generationNumber: 0, value: cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier") }) },
  ] });
}
async function contents(page: { streamContents(): AsyncIterable<Uint8Array> }) {
  const chunks: number[] = [];
  for await (const chunk of page.streamContents()) { expect(chunk.length).toBeLessThanOrEqual(64); chunks.push(...chunk); }
  return new Uint8Array(chunks);
}

describe("retained document pages", () => {
  it("preserves page inheritance and content-array separators without collecting the document", async () => {
    const bytes = inheritedPdf(); const expected = PdfDocument.load(bytes).getPage(0);
    const f = await fixture(bytes);
    const iterator = f.doc.pages();
    const page = (await iterator.next()).value!;
    expect(page.index).toBe(0); expect(page.reference).toMatchObject({ objectNumber: 4 });
    const attributes = await page.attributes();
    expect(attributes.mediaBox).toEqual(expected.getMediaBox()); expect(attributes.cropBox).toEqual(expected.getCropBox());
    expect(attributes.rotation).toBe(expected.getRotation()); expect(attributes.resources?.kind).toBe("dict");
    expect(await contents(page)).toEqual(expected.getRawContentStream());
    expect((await iterator.next()).done).toBe(true); expect(f.readFile).not.toHaveBeenCalled();
    await f.close();
  });

  it("defaults production boxes to the inherited CropBox", async () => {
    const f = await fixture(inheritedPdf());
    for await (const page of f.doc.pages()) {
      const attributes = await page.attributes();
      for (const key of ["bleedBox", "trimBox", "artBox"] as const)
        expect(attributes[key]).toEqual([20, 30, 200, 110]);
    }
    await f.close();
  });

  it("continues box inheritance past malformed child values", async () => {
    const f = await fixture(inheritedPdf(true));
    for await (const retained of f.doc.pages()) {
      const attributes = await retained.attributes();
      expect(attributes.mediaBox).toEqual([10, 20, 210, 120]);
      expect(attributes.cropBox).toEqual([20, 30, 200, 110]);
    }
    await f.close();
  });

  it("does not read later page objects before the consumer advances", async () => {
    const doc = PdfDocument.create(); for (let i = 0; i < 200; i++) doc.addPage().drawText(String(i), { x: 20, y: 30 });
    const f = await fixture(doc.save());
    const get = vi.spyOn(f.doc.objects, "get");
    const iterator = f.doc.pages(); expect((await iterator.next()).value?.index).toBe(0);
    expect(get.mock.calls.length).toBeLessThan(10);
    await iterator.return(); await f.close();
  });

  it("preserves duplicate-page and cycle handling with caller-backed visited state", async () => {
    const pages = Array.from({ length: 140 }, (ignored, i) => cosRef(i + 3));
    const objects: PdfIndirectObject[] = [
      { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
      { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Kids: cosArray([...pages, cosRef(2), ...pages]), Count: cosNumber(999) }) },
      ...pages.map(ref => ({ objectNumber: ref.objectNumber, generationNumber: 0, value: cosDict({ Type: cosName("Page"), Parent: cosRef(2) }) })),
    ];
    const f = await fixture(serializeCosDocument({ rootRef: cosRef(1), objects }));
    let count = 0; let maximumFiles = 0;
    for await (const page of f.doc.pages()) { expect(page.index).toBe(count++); maximumFiles = Math.max(maximumFiles, (await f.fs.readdir("/scratch")).length); }
    expect(count).toBe(140); expect(maximumFiles).toBeGreaterThan(1); expect(maximumFiles).toBeLessThan(10);
    expect(await f.fs.readdir("/scratch")).toHaveLength(1); // Only the document xref remains.
    await f.close();
  });

  it("supports direct page dictionaries and inherited reference chains", async () => {
    const bytes = serializeCosDocument({ rootRef: cosRef(1), objects: [
      { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
      { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), MediaBox: cosRef(3), Kids: cosArray([cosDict({ Type: cosName("Page"), Parent: cosRef(2) })]) }) },
      { objectNumber: 3, generationNumber: 0, value: cosRef(4) },
      { objectNumber: 4, generationNumber: 0, value: cosArray([0, 0, 100, 200].map(value => cosNumber(value))) },
    ] });
    const f = await fixture(bytes);
    for await (const page of f.doc.pages()) { expect(page.reference).toBeUndefined(); expect((await page.attributes()).mediaBox).toEqual([0, 0, 100, 200]); }
    await f.close();
  });

  it("streams encrypted page contents through the authenticated owner", async () => {
    const original = PdfDocument.create(); original.addPage().drawText("encrypted", { x: 20, y: 30 });
    const bytes = original.save({ encrypt: { revision: 3, userPassword: "secret" }, objectStreams: "generate" });
    const expected = PdfDocument.load(bytes, { password: "secret" }).getPage(0);
    const f = await fixture(bytes, { password: "secret" });
    for await (const page of f.doc.pages()) expect(await contents(page)).toEqual(expected.getRawContentStream());
    await f.close();
  });

  it("cleans suspended page walks and refuses new work after closing", async () => {
    const original = PdfDocument.create(); for (let i = 0; i < 70; i++) original.addPage();
    const f = await fixture(original.save()); const pages = f.doc.pages();
    for (let i = 0; i < 66; i++) await pages.next();
    expect((await f.fs.readdir("/scratch")).length).toBeGreaterThan(1);
    await f.doc.close(); expect(await f.fs.readdir("/scratch")).toEqual([]);
    await expect(f.doc.pages().next()).rejects.toThrow("closed");
    await f.close();
  });

  it("enforces page/depth admission and cleans traversal staging on failure", async () => {
    const doc = PdfDocument.create(); for (let i = 0; i < 70; i++) doc.addPage();
    const f = await fixture(doc.save(), { maxPages: 66 });
    await expect((async () => { for await (const ignored of f.doc.pages()) { /* Consume pages. */ } })()).rejects.toThrow("limit");
    expect(await f.fs.readdir("/scratch")).toHaveLength(1); await f.close();
    const deep = await fixture(inheritedPdf(), { maxPageTreeDepth: 1 });
    await expect(deep.doc.pages().next()).rejects.toThrow("depth"); await deep.close();
  });
  it.each([45, 90, 450, -90])("matches buffered rotation normalization for %i degrees", async rotation => {
    const doc = PdfDocument.create(); const page = doc.addPage(); dictSet(page.dict, "Rotate", cosNumber(rotation));
    const bytes = doc.save(); const expected = PdfDocument.load(bytes).getPage(0).getRotation();
    const f = await fixture(bytes);
    for await (const retained of f.doc.pages()) expect((await retained.attributes()).rotation).toBe(expected);
    await f.close();
  });

  it("decodes encrypted metadata and cancels content consumers", async () => {
    const doc = PdfDocument.create(); doc.addPage().setRawContentStream("x".repeat(5000)); doc.setMetadata({ title: "Résumé" });
    const abort = new AbortController();
    const f = await fixture(doc.save({ encrypt: { revision: 3, userPassword: "secret" } }), { password: "secret", signal: abort.signal });
    expect((await f.doc.info()).Title).toBe("Résumé");
    const pages = f.doc.pages(); const page = (await pages.next()).value!;
    const stream = page.streamContents(); expect((await stream.next()).value?.length).toBeGreaterThan(0);
    const failure = new Error("cancel page"); abort.abort(failure);
    await expect(stream.next()).rejects.toBe(failure);
    await pages.return(); await f.close();
  });

  it("charges visited-index staging before writes and cleans it on error", async () => {
    const doc = PdfDocument.create(); for (let i = 0; i < 70; i++) doc.addPage();
    const f = await fixture(doc.save(), { maxTraversalStagingBytes: 0 });
    const create = vi.spyOn(f.fs, "createStagedFile");
    await expect((async () => { for await (const ignored of f.doc.pages()) { /* Consume. */ } })()).rejects.toThrow("limit");
    // The index stage can be acquired, but admission must prevent payload writes.
    expect(await f.fs.readdir("/scratch")).toHaveLength(1); expect(create).toHaveBeenCalled();
    await f.close();
  });

});

it("backs inline font tables before page attributes reach font resolution", async () => {
  const original = PdfDocument.create(), page = original.addPage();
  dictSet(page.pageDict,"Resources",cosDict({Font:cosDict({F:cosDict({Subtype:cosName("Type1"),Widths:cosArray(Array.from({length:2048},()=>cosNumber(500)))})})}));
  const data = new Uint8Array(2_000_000); let end=0;
  const backing = {allocate(n:number){const at=end;end+=n;return at;},async read(at:number,n:number){return data.subarray(at,at+n);},async write(at:number,bytes:Uint8Array){data.set(bytes,at);}};
  const f = await fixture(original.save(),{valueArrays:{arrayStorage:backing,storedArrayKeys:["Widths","W"]}});
  try {
    const pages=f.doc.pages(), page=(await pages.next()).value!;
    const attributes=await page.attributes();
    const {dictGet}=await import("./ast.js");
    const fonts=dictGet(attributes.resources,"Font");
    if(fonts?.kind!=="dict")throw Error("font dictionary expected");
    const font=dictGet(fonts,"F");if(font?.kind!=="dict")throw Error("font expected");
    const widths=dictGet(font,"Widths");if(widths?.kind!=="array")throw Error("widths expected");
    expect(widths.items).toHaveLength(0);expect(widths.storedItems?.length).toBe(2048);
    await pages.return();
  } finally {await f.close();}
});
