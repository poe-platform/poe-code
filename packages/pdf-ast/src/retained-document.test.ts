import { PagedStorage } from "@poe-code/safe-fs/storage";
import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosStream, dictGet, dictSet, type PdfIndirectObject } from "./ast.js";
import { PdfDocument } from "./document.js";
import { PdfFileSource } from "./source.js";
import { serializeCosDocument } from "./cos/writer.js";
import { PdfRetainedDocument, type PdfRetainedDocumentOptions } from "./retained-document.js";
const text = (s: string) => new TextEncoder().encode(s);

async function fixture(bytes: Uint8Array, options: PdfRetainedDocumentOptions & {backedArrays?:readonly string[]; trackReads?:boolean} = {}) {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const reads = vi.fn(async (position: number, length: number) => bytes.slice(position, position + length));
  const readFile = vi.fn(async () => { throw new Error("full read forbidden"); });
  const input = { capabilities: { retainedRead: true }, readFile, openReadFile: async () => ({
    stat: async () => ({ type: "file", size: bytes.length }), read: options.trackReads===false ? async(position:number,length:number)=>bytes.slice(position,position+length) : reads, close: async () => {},
  }) } as unknown as FileSystem;
  const source = await PdfFileSource.open(input, "/input", { chunkBytes: 64, cacheBytes: 128 });
  const backing=options.backedArrays?new PagedStorage({fs,cwd:"/scratch",env:{},signal:options.signal??new AbortController().signal},2):undefined;
  const doc = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { chunkBytes: 64, cacheBytes: 128, ...options, ...(backing?{valueArrays:{arrayStorage:backing,storedArrayKeys:options.backedArrays!}}:{}) });
  return { fs, source, reads, readFile, doc, backing, async close() { await doc.close(); await backing?.close(); expect(await fs.readdir("/scratch")).toEqual([]); expect((await source.read(0, 1))[0]).toBe(37); await source.close(); } };
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

it.each([false,true])("streams backed content lists in source order with separators (indirect=%s)",async indirect=>{
 const original=PdfDocument.load(inheritedPdf());
 if(indirect){const page=original.getPage(0);dictSet(page.pageDict,"Contents",original.cos.allocateObject(dictGet(page.pageDict,"Contents")!));}
 const bytes=serializeCosDocument({rootRef:original.cos.rootRef,objects:[...original.cos.objects.values()]});
 const f=await fixture(bytes,{backedArrays:["Contents"]});
 try{
  const page=(await f.doc.pages().next()).value!;
  const list=await f.doc.lookup(dictGet(page.dict,"Contents"),undefined,["Contents"]);
  expect(list?.value).toMatchObject({kind:"array",items:[],storedItems:{length:2}});
  expect(new TextDecoder().decode(await contents(page))).toBe("BT /F1 12 Tf \n(Retained) Tj ET\n");
 }finally{await f.close();}
});

it("does not decode later backed content entries after consumer return",async()=>{
 const f=await fixture(inheritedPdf(),{backedArrays:["Contents"]});
 try{
  const page=(await f.doc.pages().next()).value!,decode=vi.spyOn(f.doc.objects,"decodeStream"),stream=page.streamContents();
  expect((await stream.next()).done).toBe(false);await stream.return();expect(decode).toHaveBeenCalledTimes(1);
 }finally{await f.close();}
});
it.each([false,true])("preserves content-list backing failure and cancellation (cancel=%s)",async cancel=>{
 const controller=new AbortController(),failure=new Error("content record failure"),f=await fixture(inheritedPdf(),{backedArrays:["Contents"],signal:controller.signal});
 const page=(await f.doc.pages().next()).value!;
 const read=vi.spyOn(f.backing!,"read").mockImplementation(async()=>{if(cancel){controller.abort(failure);return new Uint8Array(8);}throw failure;});
 try{await expect(page.streamContents().next()).rejects.toBe(failure);}
 finally{read.mockRestore();await f.close();}
});

it("bounds simultaneous generator pulls while visiting a deep branching page tree",async()=>{
 const depth=2048,objects:PdfIndirectObject[]=[{objectNumber:1,generationNumber:0,value:cosDict({Type:cosName("Catalog"),Pages:cosRef(2)})}];
 for(let i=0;i<depth;i++)objects.push({objectNumber:i+2,generationNumber:0,value:cosDict({Type:cosName("Pages"),Kids:cosArray([cosRef(i+3),cosRef(depth+3)]),Count:cosNumber(2)})});
 for(const number of [depth+2,depth+3])objects.push({objectNumber:number,generationNumber:0,value:cosDict({Type:cosName("Page"),MediaBox:cosArray([0,0,10,10].map(value=>cosNumber(value)))})});
 const f=await fixture(serializeCosDocument({rootRef:cosRef(1),objects}),{backedArrays:["Kids"],maxPageTreeDepth:Infinity,trackReads:false});
 const pages=f.doc.pages();
 const prototype=Object.getPrototypeOf(Object.getPrototypeOf((async function*(){yield 0;})())) as AsyncGenerator;
 const original=prototype.next,push=Array.prototype.push;let active=0,peak=0,peakArray=0;
 Array.prototype.push=function(this:unknown[],...items:unknown[]){const length=push.apply(this,items);peakArray=Math.max(peakArray,length);return length;};
 prototype.next=function(this:AsyncGenerator,...args:Parameters<AsyncGenerator["next"]>){
  peak=Math.max(peak,++active);return original.apply(this,args).finally(()=>{active--;});
 };
 try{expect((await pages.next()).value?.reference?.objectNumber).toBe(depth+2);expect(peak).toBeLessThan(128);expect(peakArray).toBeLessThanOrEqual(128);
  expect((await pages.next()).value?.reference?.objectNumber).toBe(depth+3);
  expect((await pages.next()).done).toBe(true);
 }
 finally{prototype.next=original;Array.prototype.push=push;await pages.return();await f.close();}
});

it.each([false,true])("preserves pending page-cursor read failure and cancellation (cancel=%s)",async cancel=>{
 const controller=new AbortController(),failure=new Error("pending cursor failed"),f=await fixture(inheritedPdf(),{backedArrays:["Kids"],signal:controller.signal});
 const pages=f.doc.pages();expect((await pages.next()).done).toBe(false);
 const read=vi.spyOn(f.backing!,"read").mockImplementation(async()=>{if(cancel){controller.abort(failure);return new Uint8Array(16);}throw failure;});
 try{await expect(pages.next()).rejects.toBe(failure);}
 finally{read.mockRestore();await pages.return();await f.close();}
});

function referenceChainPdf(indirect: boolean, depth = 256) {
  const objects: PdfIndirectObject[] = [
    { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
    { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Page"), ...(indirect ? { MediaBox: cosRef(3) } : { Parent: cosRef(3) }) }) },
  ];
  for (let i = 3; i < depth + 3; i++) objects.push({ objectNumber: i, generationNumber: 0,
    value: indirect ? cosRef(i + 1) : cosDict({ Parent: cosRef(i + 1) }) });
  const box = cosArray([0, 0, 123, 456].map(value => cosNumber(value)));
  objects.push({ objectNumber: depth + 3, generationNumber: 0, value: indirect ? box : cosDict({ MediaBox: box, Parent: cosRef(3) }) });
  return serializeCosDocument({ rootRef: cosRef(1), objects });
}

it.each([false, true])("bounds reference membership for deep %s inheritance chains", async indirect => {
  const f = await fixture(referenceChainPdf(indirect), { maxRecursionDepth: 1024, maxPageTreeDepth: 1024, trackReads: false });
  const pages = f.doc.pages(), page = (await pages.next()).value!;
  const before = await f.fs.readdir("/scratch");
  const original = Set.prototype.add;
  let peak = 0;
  Set.prototype.add = function<T>(this: Set<T>, value: T) { const result = original.call(this, value); peak = Math.max(peak, this.size); return result; };
  try {
    expect((await page.attributes()).mediaBox).toEqual([0, 0, 123, 456]);
    expect(peak).toBeLessThanOrEqual(64);
  } finally { Set.prototype.add = original; }
  expect(await f.fs.readdir("/scratch")).toEqual(before);
  await pages.return(); await f.close();
});


it.each([false, true])("cleans backed membership after inheritance storage failure (indirect=%s)", async indirect => {
  const f = await fixture(referenceChainPdf(indirect), { maxRecursionDepth: 1024, maxPageTreeDepth: 1024 });
  const pages = f.doc.pages(), page = (await pages.next()).value!;
  const before = await f.fs.readdir("/scratch"), failure = new Error("membership write failed");
  const create = vi.spyOn(f.fs, "createStagedFile").mockRejectedValue(failure);
  try { await expect(page.attributes()).rejects.toBe(failure); }
  finally { create.mockRestore(); }
  expect(await f.fs.readdir("/scratch")).toEqual(before);
  await pages.return(); await f.close();
});

it.each([false, true])("allows timer cancellation of long inheritance (indirect=%s)", async indirect => {
  const controller = new AbortController();
  const f = await fixture(referenceChainPdf(indirect), { maxRecursionDepth: 1024, maxPageTreeDepth: 1024, signal: controller.signal });
  const pages = f.doc.pages(), page = (await pages.next()).value!, failure = new Error("cancel inheritance");
  const timer = setTimeout(() => controller.abort(failure), 0);
  try { await expect(page.attributes()).rejects.toBe(failure); }
  finally { clearTimeout(timer); }
  await pages.return(); await f.close();
});

it("preserves reference cycle and depth errors with backed membership", async () => {
  const f = await fixture(referenceChainPdf(true), { maxRecursionDepth: 70 });
  await expect(f.doc.lookup(cosRef(3))).rejects.toThrow("reference depth limit");
  const object = (await f.doc.objects.get(3))!;
  const get = vi.spyOn(f.doc.objects, "get").mockResolvedValue({ ...object, value: cosRef(3) });
  await expect(f.doc.lookup(cosRef(3))).rejects.toThrow("Circular PDF indirect reference");
  get.mockRestore(); await f.close();
});

it("bounds generator depth while resolving annotation page numbers", async () => {
  const depth = 256, objects: PdfIndirectObject[] = [
    {objectNumber:1,generationNumber:0,value:cosDict({Type:cosName("Catalog"),Pages:cosRef(2)})},
  ];
  for(let i=0;i<depth;i++) objects.push({objectNumber:i+2,generationNumber:0,value:cosDict({Type:cosName("Pages"),Kids:cosArray([cosRef(i+3),cosRef(depth+3)])})});
  for(const n of [depth+2,depth+3]) objects.push({objectNumber:n,generationNumber:0,value:cosDict({Type:cosName("Page")})});
  const f=await fixture(serializeCosDocument({rootRef:cosRef(1),objects}),{backedArrays:["Kids"],maxPageTreeDepth:1024,trackReads:false});
  const prototype=Object.getPrototypeOf(Object.getPrototypeOf((function*(){})())),next=prototype.next;
  const push=Array.prototype.push;let active=0,peak=0,peakArray=0;
  prototype.next=function(...args:unknown[]){peak=Math.max(peak,++active);try{return next.apply(this,args);}finally{active--;}};
  Array.prototype.push=function<T>(this:T[],...values:T[]){const result=push.apply(this,values);peakArray=Math.max(peakArray,this.length);return result;};
  try{expect(await f.doc.annotationPageNumber(cosRef(depth+3))).toBe(2);expect(await f.doc.annotationPageNumber(cosRef(9999))).toBeUndefined();expect(peak).toBeLessThan(32);expect(peakArray).toBeLessThanOrEqual(128);}
  finally{prototype.next=next;Array.prototype.push=push;await f.close();}
});
