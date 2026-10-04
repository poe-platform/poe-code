import { PagedStorage } from "@poe-code/safe-fs/storage";
import { serializeCosDocument } from "../cos/writer.js";
import { expect, it, vi } from "vitest";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosString, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { extractPageAnnotations } from "./evaluator.js";

async function fixture(options: { backedKids?: "inline" | "indirect"; malformed?: boolean; cycle?: boolean; malformedTree?: boolean; extraPages?: number; signal?: AbortSignal; maxTraversalStagingBytes?: number } = {}) {
  const original = PdfDocument.create(); const first = original.addPage();
  for (let i = 0; i < (options.extraPages ?? 0); i++) original.addPage();
  const second = original.addPage();
  const destination = cosArray([second.pageRef, cosName("Fit")]);
  const rectangle = cosArray([1, 2, 30, 40].map(value => cosNumber(value)));
  const link = (entries: Parameters<typeof cosDict>[0]) => original.cos.allocateObject(cosDict({ Rect: rectangle, ...entries }));
  dictSet(first.pageDict, "Annots", cosArray([
    link({ A: cosDict({ URI: cosString("https://example.test") }), Contents: cosString("external") }),
    link({ Dest: destination }),
    link({ A: cosDict({ S: cosName("GoTo"), D: cosString("named") }) }),
    link({ Dest: cosName("legacy") }),
    link({ Dest: cosArray([cosNumber(2), cosName("Fit")]) }),
    link({ Contents: cosString("plain") }),
  ]));
  const catalog = original.cos.resolveDict(original.cos.rootRef)!;
  dictSet(catalog, "Dests", cosDict({ legacy: cosDict({ D: destination }) }));
  dictSet(catalog, "Names", cosDict({ Dests: cosDict({ Kids: cosArray([original.cos.allocateObject(cosDict({ Names: cosArray([cosString("named"), destination]) }))]) }) }));
  if (options.malformed) dictSet(first.pageDict, "Annots", cosArray([
    cosNumber(42), cosDict({ Rect: cosArray([cosNumber(1)]) }),
    link({ Rect: cosArray([cosName("invalid"), cosNumber(2), cosNumber(3), cosNumber(4)]), A: cosDict({ S: cosName("Launch"), D: destination }) }),
  ]));
  if (options.cycle) {
    const tree = original.cos.allocateObject(cosDict({}));
    original.cos.setObject(tree.objectNumber, cosDict({ Kids: cosArray([tree, cosDict({ Names: cosArray([cosString("named"), destination]) })]) }), 0);
    dictSet(catalog, "Names", cosDict({ Dests: tree }));
  }
  if (options.malformedTree) {
    const pages = original.cos.resolveDict(catalog.entries.find(entry => entry.key.decoded === "Pages")?.value)!;
    dictSet(pages, "Kids", cosArray([first.pageRef, original.cos.allocateObject(cosDict({})), second.pageRef]));
  }
  if (options.backedKids === "indirect") {
    for (const object of original.cos.objects.values()) if (object.value.kind === "dict") {
      const kids = object.value.entries.find(entry => entry.key.decoded === "Kids");
      if (kids?.value.kind === "array") dictSet(object.value,"Kids",original.cos.allocateObject(kids.value));
    }
  }
  const expected = options.cycle ? undefined : extractPageAnnotations(original.cos, first.pageDict);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); 
  const bytes = serializeCosDocument({ rootRef: original.cos.rootRef, objects: [...original.cos.objects.values()] });
  const readFile = vi.fn(async () => { throw new Error("whole reads forbidden"); });
  const input = { capabilities: { retainedRead: true }, readFile, openReadFile: async () => ({
    stat: async () => ({ type: "file", size: bytes.length }),
    read: async (position: number, length: number) => bytes.slice(position, position + length), close: async () => {},
  }) } as unknown as FileSystem;
  const source = await PdfFileSource.open(input, "/input", { chunkBytes: 32, cacheBytes: 64 });
  const backing = options.backedKids ? new PagedStorage({fs,cwd:"/scratch",env:{},signal:options.signal ?? new AbortController().signal},2) : undefined;
  const document = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { ...(backing ? {valueArrays:{arrayStorage:backing,storedArrayKeys:["Kids"]}} : {}), ...(options.signal ? { signal: options.signal } : {}), ...(options.maxTraversalStagingBytes !== undefined ? { maxTraversalStagingBytes: options.maxTraversalStagingBytes } : {}) });
  const page = (await document.pages().next()).value!;
  return { document, page, expected, fs, readFile, second, backing, async close() {
    await document.close(); await source.close(); await backing?.close(); expect(await fs.readdir("/scratch")).toEqual([]);
  } };
}
it("streams annotations with external, direct, named and legacy destinations", async () => {
  const f = await fixture(); const annotations = [];
  for await (const annotation of f.page.annotations()) annotations.push(annotation);
  expect(annotations).toEqual(f.expected);
  expect(annotations.map(item => item.uri)).toEqual(["https://example.test", "#page2", "#page2", "#page2", "#page3", undefined]);
  expect(f.readFile).not.toHaveBeenCalled(); await f.close();
});
it("does not traverse destinations while the consumer holds an earlier annotation", async () => {
  const f = await fixture(); const pages = vi.spyOn(f.document, "annotationPageNumber"); const lookup = vi.spyOn(f.document, "lookup");
  const work = f.page.annotations(); expect((await work.next()).value?.uri).toBe("https://example.test");
  const count = lookup.mock.calls.length; await Promise.resolve();
  expect(lookup.mock.calls.length).toBe(count); expect(pages).not.toHaveBeenCalled();
  await work.return(); await f.close();
});
it("cleans destination traversal on lookup failure and preserves error identity", async () => {
  const f = await fixture(); const work = f.page.annotations(); await work.next();
  const rejection = { reason: "lookup failed" }; vi.spyOn(f.document, "lookup").mockRejectedValueOnce(rejection);
  await expect(work.next()).rejects.toBe(rejection); await f.close();
});

it("preserves malformed annotation fallback and skips invalid rectangles", async () => {
  const f = await fixture({ malformed: true }); const actual = [];
  for await (const annotation of f.page.annotations()) actual.push(annotation);
  expect(actual).toEqual(f.expected); expect(actual).toEqual([{ rect: [0, 2, 3, 4], uri: undefined, contents: undefined }]);
  await f.close();
});
it("closes destination page traversal before yielding and after a traversal failure", async () => {
  const f = await fixture(); const before = await f.fs.readdir("/scratch"); const work = f.page.annotations();
  await work.next(); expect((await work.next()).value?.uri).toBe("#page2");
  expect(await f.fs.readdir("/scratch")).toEqual(before);
  const lookup = f.document.lookup.bind(f.document); const rejection = { reason: "destination page read" };
  vi.spyOn(f.document, "lookup").mockImplementation(async node => {
    if (node?.kind === "ref" && node.objectNumber === f.second.pageRef.objectNumber) throw rejection;
    return lookup(node);
  });
  await expect(work.next()).rejects.toBe(rejection);
  expect(await f.fs.readdir("/scratch")).toEqual(before); await f.close();
});
it("skips a cyclic name-tree branch and continues to later matching entries", async () => {
  const f = await fixture({ cycle: true }); const work = f.page.annotations();
  const lookup = f.document.lookup.bind(f.document); let reads = 0;
  vi.spyOn(f.document, "lookup").mockImplementation(async node => {
    if (++reads > 150) throw new Error("cyclic name tree did not terminate");
    return lookup(node);
  });
  await work.next(); await work.next(); expect((await work.next()).value?.uri).toBe("#page2");
  await work.return(); await f.close();
});

it("preserves destination numbering through malformed page-tree leaves", async () => {
  const f = await fixture({ malformedTree: true }); const actual = [];
  for await (const annotation of f.page.annotations()) actual.push(annotation);
  expect(actual).toEqual(f.expected); expect(actual[1]?.uri).toBe("#page3"); await f.close();
});

it("spills exact destination traversal membership to caller storage and cleans it", async () => {
  const f = await fixture({ extraPages: 160 }); const before = await f.fs.readdir("/scratch");
  const work = f.page.annotations(); await work.next();
  const lookup = f.document.lookup.bind(f.document); let sawSpill = false;
  vi.spyOn(f.document, "lookup").mockImplementation(async node => {
    if ((await f.fs.readdir("/scratch")).length > before.length) sawSpill = true;
    return lookup(node);
  });
  expect((await work.next()).value?.uri).toBe("#page162"); expect(sawSpill).toBe(true);
  expect(await f.fs.readdir("/scratch")).toEqual(before); await work.return(); await f.close();
});

it("rejects destination spill before exceeding the caller's traversal budget", async () => {
  const f = await fixture({ extraPages: 160, maxTraversalStagingBytes: 0 });
  const work = f.page.annotations(); await work.next(); const before = await f.fs.readdir("/scratch");
  await expect(work.next()).rejects.toThrow("limit");
  expect(await f.fs.readdir("/scratch")).toEqual(before); await f.close();
});
it("preserves cancellation during spilled destination traversal and removes its scratch", async () => {
  const controller = new AbortController(); const rejection = { reason: "cancel annotations" };
  const f = await fixture({ extraPages: 160, signal: controller.signal });
  const work = f.page.annotations(); await work.next(); const before = await f.fs.readdir("/scratch");
  const lookup = f.document.lookup.bind(f.document);
  vi.spyOn(f.document, "lookup").mockImplementation(async node => {
    if ((await f.fs.readdir("/scratch")).length > before.length) controller.abort(rejection);
    return lookup(node);
  });
  await expect(work.next()).rejects.toBe(rejection);
  expect(await f.fs.readdir("/scratch")).toEqual(before); await f.close();
});

it.each(["inline","indirect"] as const)("preserves pages and destination numbering with %s backed Kids",async backedKids=>{
 const f=await fixture({backedKids,extraPages:32});
 try{
  const indices=[];for await(const page of f.document.pages())indices.push(page.index);
  expect(indices).toEqual(Array.from({length:34},(_,i)=>i));
  expect(await f.document.annotationPageNumber(f.second.pageRef)).toBe(34);
  const annotations=[];for await(const annotation of f.page.annotations())annotations.push(annotation);
  expect(annotations).toEqual(f.expected);
 }finally{await f.close();}
});

it.each(["inline","indirect"] as const)("preserves malformed leaves and cyclic name branches with %s backed Kids",async backedKids=>{
 for(const options of [{malformedTree:true},{cycle:true}]){
  const f=await fixture({backedKids,...options});
  try{
   const annotations=[];for await(const annotation of f.page.annotations())annotations.push(annotation);
   if(f.expected)expect(annotations).toEqual(f.expected);
   else expect(annotations[2]?.uri).toBe("#page2");
  }finally{await f.close();}
 }
});

it("preserves backed page-list read errors and caller cancellation",async()=>{
 for(const cancel of [false,true]){
  const controller=new AbortController(),failure=new Error("page backing failed");
  const f=await fixture({backedKids:"inline",signal:controller.signal,extraPages:4});
  const read=vi.spyOn(f.backing!,"read").mockImplementation(async()=>{if(cancel){controller.abort(failure);return new Uint8Array(8);}throw failure;});
  try{await expect(f.document.annotationPageNumber(f.second.pageRef)).rejects.toBe(failure);}
  finally{read.mockRestore();await f.close();}
 }
});
