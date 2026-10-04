import { PagedStorage } from "@poe-code/safe-fs/storage";
import { serializeCosDocument } from "../cos/writer.js";
import { expect, it, vi } from "vitest";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosString, dictGet, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { extractPageAnnotations } from "./evaluator.js";

async function fixture(options: { nameTreeDepth?: number; backedAnnots?: "inline" | "indirect"; backedKids?: "inline" | "indirect"; malformed?: boolean; cycle?: boolean; malformedTree?: boolean; extraPages?: number; signal?: AbortSignal; maxTraversalStagingBytes?: number } = {}) {
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
  if (options.nameTreeDepth) {
    let tree = original.cos.allocateObject(cosDict({ Names: cosArray([cosString("named"), destination]) }));
    for(let i=0;i<options.nameTreeDepth;i++) tree=original.cos.allocateObject(cosDict({Kids:cosArray([cosDict({}),tree])}));
    dictSet(catalog,"Names",cosDict({Dests:tree}));
  }
  if (options.backedKids === "indirect") {
    for (const object of original.cos.objects.values()) if (object.value.kind === "dict") {
      const kids = object.value.entries.find(entry => entry.key.decoded === "Kids");
      if (kids?.value.kind === "array") dictSet(object.value,"Kids",original.cos.allocateObject(kids.value));
    }
  }
  if(options.backedAnnots==="indirect"){
    const annots=first.pageDict.entries.find(entry=>entry.key.decoded==="Annots")!.value;
    dictSet(first.pageDict,"Annots",original.cos.allocateObject(annots));
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
  const backing = (options.backedKids||options.backedAnnots) ? new PagedStorage({fs,cwd:"/scratch",env:{},signal:options.signal ?? new AbortController().signal},2) : undefined;
  const document = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { ...(options.nameTreeDepth ? {maxPageTreeDepth:Infinity} : {}), ...(backing ? {valueArrays:{arrayStorage:backing,storedArrayKeys:[...(options.backedKids?["Kids"]:[]),...(options.backedAnnots?["Annots"]:[])]}} : {}), ...(options.signal ? { signal: options.signal } : {}), ...(options.maxTraversalStagingBytes !== undefined ? { maxTraversalStagingBytes: options.maxTraversalStagingBytes } : {}) });
  const page = (await document.pages().next()).value!;
  return { document, page, expected, fs, readFile, second, backing, namedRoot:dictGet(original.cos.resolveDict(dictGet(catalog,"Names"))!,"Dests"), async close() {
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

it.each(["inline","indirect"] as const)("extracts annotations from %s caller-backed lists",async backedAnnots=>{
 const f=await fixture({backedAnnots});
 try{
  const list=await f.document.lookup(dictGet(f.page.dict,"Annots"),undefined,["Annots"]);
  expect(list?.value).toMatchObject({kind:"array",items:[],storedItems:{length:6}});
  const annotations=[];for await(const item of f.page.annotations())annotations.push(item);expect(annotations).toEqual(f.expected);
 }
 finally{await f.close();}
});


it("bounds generator and identity state in a deep named destination tree", async () => {
  const f = await fixture({backedKids:"inline",nameTreeDepth:256});
  const prototype=Object.getPrototypeOf(Object.getPrototypeOf((function*(){})())),next=prototype.next;
  const add=Set.prototype.add;let active=0,peak=0,peakSet=0;
  prototype.next=function(...args:unknown[]){peak=Math.max(peak,++active);try{return next.apply(this,args);}finally{active--;}};
  Set.prototype.add=function<T>(this:Set<T>,value:T){const result=add.call(this,value);peakSet=Math.max(peakSet,this.size);return result;};
  try{const annotations=[];for await(const annotation of f.page.annotations())annotations.push(annotation);expect(annotations).toEqual(f.expected);expect(peak).toBeLessThan(32);expect(peakSet).toBeLessThanOrEqual(64);}
  finally{prototype.next=next;Set.prototype.add=add;await f.close();}
});


it("cleans named destination indexes after misses and backing failure", async () => {
  const f=await fixture({backedKids:"inline",nameTreeDepth:128});
  try {
    const before=await f.fs.readdir("/scratch");
    expect(await f.document.annotationNamedDestination(f.namedRoot,"missing")).toBeUndefined();
    expect(await f.document.annotationNamedDestination(f.namedRoot,"named")).toMatchObject({kind:"array"});
    expect(await f.fs.readdir("/scratch")).toEqual(before);
    const failure=new Error("name backing failed"),create=vi.spyOn(f.backing!,"write").mockRejectedValue(failure);
    try{await expect(f.document.annotationNamedDestination(f.namedRoot,"named")).rejects.toBe(failure);}
    finally{create.mockRestore();}
    expect(await f.fs.readdir("/scratch")).toEqual(before);
  }finally{await f.close();}
});

it("cancels named destination traversal and cleans its owned indexes", async () => {
  const controller=new AbortController(),f=await fixture({backedKids:"inline",nameTreeDepth:128,signal:controller.signal});
  const failure=new Error("cancel named destination"),timer=setTimeout(()=>controller.abort(failure),0);
  try{await expect(f.document.annotationNamedDestination(f.namedRoot,"named")).rejects.toBe(failure);}
  finally{clearTimeout(timer);await f.close();}
});


it("revisits completed name branches and preserves unusual reference identities", async () => {
  const f=await fixture({backedKids:"inline",nameTreeDepth:1});
  try {
    const lookup=vi.spyOn(f.document,"lookup");
    expect(await f.document.annotationNamedDestination(cosDict({Kids:cosArray([f.namedRoot!,f.namedRoot!])}),"absent")).toBeUndefined();
    expect(lookup.mock.calls.filter(([node])=>node?.kind==="ref"&&f.namedRoot?.kind==="ref"&&node.objectNumber===f.namedRoot.objectNumber)).toHaveLength(2);
    lookup.mockRestore();
    const first=cosRef(2**49,70000),second=cosRef(2**49,70001),target=cosArray([cosNumber(7)]);
    const original=f.document.lookup.bind(f.document);
    const read=vi.spyOn(f.document,"lookup").mockImplementation(async(node,...args)=>node?.kind==="ref"&&node.objectNumber===first.objectNumber
      ? {value:node.generationNumber===first.generationNumber?cosDict({Kids:cosArray([first])}):cosDict({Names:cosArray([cosString("target"),target])})}
      : original(node,...args));
    try{expect(await f.document.annotationNamedDestination(cosDict({Kids:cosArray([first,second])}),"target")).toEqual(target);}
    finally{read.mockRestore();}
  }finally{await f.close();}
});
